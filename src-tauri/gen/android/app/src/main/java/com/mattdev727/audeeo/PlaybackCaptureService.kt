package com.mattdev727.audeeo

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.sqrt

class PlaybackCaptureService : Service() {
  companion object {
    const val ACTION_START = "com.mattdev727.audeeo.START_LIVE_SESSION"
    const val ACTION_STOP = "com.mattdev727.audeeo.STOP_LIVE_SESSION"
    const val ACTION_SHOW_PRESENTER = "com.mattdev727.audeeo.SHOW_PRESENTER"
    const val ACTION_HIDE_PRESENTER = "com.mattdev727.audeeo.HIDE_PRESENTER"
    const val ACTION_UPDATE_PRESENTER = "com.mattdev727.audeeo.UPDATE_PRESENTER"
    const val EXTRA_RESULT_CODE = "projectionResultCode"
    const val EXTRA_RESULT_DATA = "projectionResultData"
    const val EXTRA_SESSION = "session"
    const val EXTRA_PRESENTER = "presenter"
    private const val CHANNEL_ID = "audeeo_live_translation"
    private const val NOTIFICATION_ID = 1201
    private const val TRANSLATED_SAMPLE_RATE = 24_000
    private const val MAX_TRANSLATED_QUEUE_BYTES = 480_000 // Ten seconds of mono PCM16.

    @Volatile private var activeService: PlaybackCaptureService? = null
    @Volatile private var pendingTranslatedVolume = 1f

    @JvmStatic external fun nativeOnEvent(message: String)

    fun setTranslatedVolume(volume: Float) {
      pendingTranslatedVolume = volume.coerceIn(0f, 1f)
      activeService?.applyTranslatedVolume(pendingTranslatedVolume)
    }

    fun resetTranslatedPlayback() {
      activeService?.releaseTranslatedPlayer()
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private val capturing = AtomicBoolean(false)
  private var projection: MediaProjection? = null
  private var recorder: AudioRecord? = null
  private var socket: WebSocket? = null
  private var http: OkHttpClient? = null
  private var generation = 0
  @Volatile private var projectionStopping = false
  private var silentSince = 0L
  private var announcedSilence = false
  private var disposing = false
  private var presenter: LinearLayout? = null
  private var sourceText: TextView? = null
  private var translationText: TextView? = null
  private var presenterParams: WindowManager.LayoutParams? = null
  private var lastSource = ""
  private var lastTranslation = ""
  private val translatedQueue = LinkedBlockingQueue<ByteArray>()
  private val translatedQueuedBytes = AtomicInteger(0)
  private val translatedPlaying = AtomicBoolean(false)
  private val translatedPlayerGeneration = AtomicInteger(0)
  private var translatedTrack: AudioTrack? = null
  private var translatedThread: Thread? = null
  private var translatedFocus: AudioFocusRequest? = null
  @Volatile private var hasTranslatedFocus = false
  @Volatile private var translatedPlaybackDeadlineNanos = 0L
  @Volatile private var translatedVolume = pendingTranslatedVolume
  @Volatile private var focusVolume = 1f

  private val translatedAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_NONE)
    .build()

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    focusVolume = when (change) {
      AudioManager.AUDIOFOCUS_GAIN -> 1f
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> 0.25f
      AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> 0f
      else -> focusVolume
    }
    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
      hasTranslatedFocus = false
    }
    applyTranslatedVolume(translatedVolume)
  }

  override fun onCreate() {
    super.onCreate()
    activeService = this
    translatedVolume = pendingTranslatedVolume
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_STOP -> requestStop()
      ACTION_SHOW_PRESENTER -> showPresenter()
      ACTION_HIDE_PRESENTER -> hidePresenter()
      ACTION_UPDATE_PRESENTER -> updatePresenter(intent.getStringExtra(EXTRA_PRESENTER))
    }
    return START_NOT_STICKY
  }

  private fun start(intent: Intent) {
    generation += 1
    disposing = false
    releaseResources()
    projectionStopping = false
    val run = generation
    createNotificationChannel()
    val openApp = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("Audeeo is translating")
      .setContentText("Capturing playback audio you authorized")
      .setContentIntent(openApp)
      .setOngoing(true)
      .setSilent(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
    } else {
      @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA)
    }
    val raw = intent.getStringExtra(EXTRA_SESSION)
    if (resultData == null || raw.isNullOrBlank()) {
      fail("CaptureUnavailable", "Device playback authorization was incomplete.")
      return
    }
    try {
      val manager = getSystemService(MediaProjectionManager::class.java)
      projection = manager.getMediaProjection(intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED), resultData)
      projection?.registerCallback(object : MediaProjection.Callback() {
        override fun onStop() {
          if (run == generation && !projectionStopping) fail("CaptureEnded", "Android ended device playback capture.")
        }
      }, main)
      connect(JSONObject(raw), run)
    } catch (error: Exception) {
      fail("CaptureUnavailable", error.message ?: "Device playback capture could not start.")
    }
  }

  private fun connect(session: JSONObject, run: Int) {
    val endpoint = session.getString("endpoint")
      .replaceFirst(Regex("^https:"), "wss:")
      .replaceFirst(Regex("^http:"), "ws:")
      .trimEnd('/') + "/v1/realtime"
    http = OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).build()
    socket = http!!.newWebSocket(Request.Builder().url(endpoint).build(), object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        val start = JSONObject()
          .put("type", "start")
          .put("accessToken", session.getString("token"))
          .put("sourceLanguage", session.getString("source"))
          .put("targetLanguage", session.getString("target"))
          .put("silence", JSONObject()
            .put("timeoutSeconds", session.optInt("silenceTimeout", 30))
            .put("thresholdDbfs", session.optInt("silenceThreshold", -45)))
        val provider = session.optString("provider")
        val providerKey = session.optString("providerKey")
        if (provider.isNotBlank() && providerKey.isNotBlank()) {
          start.put("provider", provider).put("providerKey", providerKey)
        }
        val context = session.optString("context")
        if (context.isNotBlank() && context != "null") start.put("context", JSONObject(context))
        webSocket.send(start.toString())
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        if (run != generation) return
        try {
          val event = JSONObject(text)
          when (event.optString("type")) {
            "ready" -> {
              startPlaybackCapture(run, session)
              nativeOnEvent(text)
            }
            "segment" -> {
              val segment = event.optJSONObject("segment")
              if (segment != null) {
                lastSource = segment.optString("sourceText", lastSource)
                val translated = segment.optString("translatedText")
                if (translated.isNotBlank()) lastTranslation = translated
                main.post { renderPresenter() }
              }
              nativeOnEvent(text)
            }
            "audio" -> {
              enqueueTranslatedAudio(event, run)
              nativeOnEvent(text)
            }
            "finished" -> {
              nativeOnEvent(text)
              releaseCaptureAndNetwork()
              val delay = translatedDrainDelayMillis()
              if (delay == 0L) dispose(sendFinished = false)
              else main.postDelayed({ if (run == generation) dispose(sendFinished = false) }, delay)
            }
            else -> nativeOnEvent(text)
          }
        } catch (error: Exception) {
          if (text.contains("\"type\":\"ready\"")) {
            fail("CaptureUnavailable", error.message ?: "Playback audio could not start.")
          }
          // Ignore other malformed provider events; the relay owns protocol validation.
        }
      }

      override fun onMessage(webSocket: WebSocket, bytes: ByteString) = Unit

      override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
        if (run == generation) fail("NetworkError", "Caption connection ended. Check your network and retry.")
      }
    })
  }

  private fun startPlaybackCapture(run: Int, session: JSONObject) {
    val mediaProjection = projection ?: throw IllegalStateException("Device playback permission ended.")
    val captureBuilder = android.media.AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
      .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
      .addMatchingUsage(AudioAttributes.USAGE_GAME)
      .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
    val sourceId = session.optString("captureSourceId")
    if (sourceId.startsWith("android:")) {
      val packageName = sourceId.removePrefix("android:")
      val application = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.getApplicationInfo(packageName, android.content.pm.PackageManager.ApplicationInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION") packageManager.getApplicationInfo(packageName, 0)
      }
      captureBuilder.addMatchingUid(application.uid)
    }
    val capture = captureBuilder.build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(16_000)
      .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
      .build()
    val minimum = AudioRecord.getMinBufferSize(16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    recorder = AudioRecord.Builder()
      .setAudioFormat(format)
      .setBufferSizeInBytes(max(12_800, minimum * 2))
      .setAudioPlaybackCaptureConfig(capture)
      .build()
    if (recorder?.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("Playback audio is unavailable on this device.")
    recorder!!.startRecording()
    capturing.set(true)
    silentSince = System.currentTimeMillis()
    announcedSilence = false
    status("waitingForAudio", "Waiting for device audio")
    thread(name = "audeeo-playback-capture", isDaemon = true) {
      val buffer = ByteArray(3_200) // 100 ms of mono PCM16 at 16 kHz.
      while (capturing.get() && run == generation) {
        val count = recorder?.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING) ?: break
        if (count < 0) {
          fail("CaptureEnded", "Playback audio capture ended unexpectedly.")
          break
        }
        if (count == 0) continue
        observeAudio(buffer, count)
        val activeSocket = socket ?: break
        if (activeSocket.queueSize() + count > 128_000) {
          fail("NetworkError", "Network is behind. Capture stopped to keep latency bounded.")
          break
        }
        if (!activeSocket.send(buffer.toByteString(0, count))) {
          fail("NetworkError", "Audio upload failed. Reconnect to continue.")
          break
        }
      }
    }
  }

  private fun observeAudio(buffer: ByteArray, count: Int) {
    var sum = 0.0
    var samples = 0
    var index = 0
    while (index + 1 < count) {
      val value = ((buffer[index].toInt() and 0xff) or (buffer[index + 1].toInt() shl 8)).toShort().toDouble()
      sum += value * value
      samples += 1
      index += 2
    }
    val rms = if (samples == 0) 0.0 else sqrt(sum / samples) / 32768.0
    if (rms > 0.0015) {
      if (silentSince != 0L) status("audioDetected", "Device audio detected")
      silentSince = 0L
      announcedSilence = false
    } else if (silentSince == 0L) {
      silentSince = System.currentTimeMillis()
    } else if (!announcedSilence && System.currentTimeMillis() - silentSince > 8_000) {
      announcedSilence = true
      status("noAudio", "No capturable audio detected. The source may be silent, protected, or opted out.")
    }
  }

  private fun enqueueTranslatedAudio(event: JSONObject, run: Int) {
    val sampleRate = event.optInt("sampleRate", TRANSLATED_SAMPLE_RATE)
    if (sampleRate != TRANSLATED_SAMPLE_RATE) {
      fail("PlaybackUnavailable", "Translated audio used an unsupported sample rate.")
      return
    }
    val encoded = event.optString("pcm")
    if (encoded.isBlank()) return
    val bytes = try { Base64.decode(encoded, Base64.NO_WRAP) } catch (_: IllegalArgumentException) {
      fail("PlaybackUnavailable", "Translated audio data was invalid.")
      return
    }
    if (bytes.isEmpty() || bytes.size % 2 != 0) {
      fail("PlaybackUnavailable", "Translated audio data was invalid.")
      return
    }
    try {
      ensureTranslatedPlayer(run)
    } catch (error: Exception) {
      fail("PlaybackUnavailable", error.message ?: "Translated audio playback could not start.")
      return
    }
    val queued = translatedQueuedBytes.addAndGet(bytes.size)
    if (queued > MAX_TRANSLATED_QUEUE_BYTES) {
      translatedQueuedBytes.addAndGet(-bytes.size)
      fail("PlaybackUnavailable", "Translated audio fell too far behind. Restart captions.")
      return
    }
    translatedQueue.offer(bytes)
  }

  @Synchronized
  private fun ensureTranslatedPlayer(run: Int) {
    if (translatedPlaying.get() && translatedTrack?.state == AudioTrack.STATE_INITIALIZED) return
    releaseTranslatedPlayer()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(TRANSLATED_SAMPLE_RATE)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()
    val minimum = AudioTrack.getMinBufferSize(
      TRANSLATED_SAMPLE_RATE,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val track = AudioTrack.Builder()
      .setAudioAttributes(translatedAttributes)
      .setAudioFormat(format)
      .setBufferSizeInBytes(max(24_000, minimum * 2))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    if (track.state != AudioTrack.STATE_INITIALIZED) {
      track.release()
      throw IllegalStateException("Translated audio output is unavailable on this device.")
    }
    val playerRun = translatedPlayerGeneration.incrementAndGet()
    translatedFocus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      .setAudioAttributes(translatedAttributes)
      .setOnAudioFocusChangeListener(focusListener, main)
      .build()
    if (!requestTranslatedFocus()) {
      track.release()
      translatedFocus = null
      throw IllegalStateException("Android could not grant translated audio focus.")
    }
    translatedTrack = track
    applyTranslatedVolume(translatedVolume)
    track.play()
    translatedPlaying.set(true)
    translatedThread = thread(name = "audeeo-translated-playback", isDaemon = true) {
      try {
        while (translatedPlaying.get() && run == generation && playerRun == translatedPlayerGeneration.get()) {
          val chunk = translatedQueue.poll(100, TimeUnit.MILLISECONDS)
          if (chunk == null) {
            if (hasTranslatedFocus && System.nanoTime() >= translatedPlaybackDeadlineNanos) abandonTranslatedFocus()
            continue
          }
          translatedQueuedBytes.addAndGet(-chunk.size)
          if (!requestTranslatedFocus()) throw IllegalStateException("Android could not restore translated audio focus.")
          var offset = 0
          while (offset < chunk.size && translatedPlaying.get() && run == generation && playerRun == translatedPlayerGeneration.get()) {
            val written = translatedTrack?.write(chunk, offset, chunk.size - offset, AudioTrack.WRITE_BLOCKING) ?: break
            if (written < 0) throw IllegalStateException("Translated audio output stopped ($written).")
            offset += written
            val duration = (written.toLong() / 2L) * 1_000_000_000L / TRANSLATED_SAMPLE_RATE
            translatedPlaybackDeadlineNanos = max(System.nanoTime(), translatedPlaybackDeadlineNanos) + duration
          }
        }
      } catch (error: Exception) {
        if (translatedPlaying.get() && run == generation && playerRun == translatedPlayerGeneration.get()) {
          fail("PlaybackUnavailable", error.message ?: "Translated audio playback stopped.")
        }
      }
    }
  }

  @Synchronized
  private fun requestTranslatedFocus(): Boolean {
    if (hasTranslatedFocus) return true
    val request = translatedFocus ?: return false
    hasTranslatedFocus = getSystemService(AudioManager::class.java).requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    if (hasTranslatedFocus) {
      focusVolume = 1f
      applyTranslatedVolume(translatedVolume)
    }
    return hasTranslatedFocus
  }

  @Synchronized
  private fun abandonTranslatedFocus() {
    if (!hasTranslatedFocus) return
    translatedFocus?.let { getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) }
    hasTranslatedFocus = false
    focusVolume = 1f
  }

  private fun translatedDrainDelayMillis(): Long {
    val queuedMillis = translatedQueuedBytes.get().toLong() * 1_000L / (TRANSLATED_SAMPLE_RATE * 2L)
    val playingMillis = ((translatedPlaybackDeadlineNanos - System.nanoTime()).coerceAtLeast(0L) / 1_000_000L)
    return (queuedMillis + playingMillis + if (queuedMillis + playingMillis > 0L) 150L else 0L).coerceAtMost(10_500L)
  }

  @Synchronized
  private fun applyTranslatedVolume(volume: Float) {
    translatedVolume = volume.coerceIn(0f, 1f)
    translatedTrack?.setVolume((translatedVolume * focusVolume).coerceIn(0f, 1f))
  }

  @Synchronized
  private fun releaseTranslatedPlayer() {
    translatedPlaying.set(false)
    translatedPlayerGeneration.incrementAndGet()
    translatedThread?.interrupt()
    translatedThread = null
    translatedQueue.clear()
    translatedQueuedBytes.set(0)
    translatedPlaybackDeadlineNanos = 0L
    try { translatedTrack?.pause() } catch (_: Exception) {}
    try { translatedTrack?.flush() } catch (_: Exception) {}
    try { translatedTrack?.release() } catch (_: Exception) {}
    translatedTrack = null
    abandonTranslatedFocus()
    translatedFocus = null
    focusVolume = 1f
  }

  private fun requestStop() {
    capturing.set(false)
    try { recorder?.stop() } catch (_: Exception) {}
    recorder?.release()
    recorder = null
    status("stopping", "Finishing captions")
    val active = socket
    if (active == null || !active.send("{\"type\":\"stop\"}")) {
      dispose(sendFinished = true)
      return
    }
    val run = generation
    main.postDelayed({
      if (run == generation && socket != null) fail("NetworkError", "Finalization timed out; some captions may be incomplete.")
    }, 20_000)
  }

  private fun status(state: String, message: String) {
    nativeOnEvent(JSONObject().put("type", "status").put("state", state).put("message", message).toString())
  }

  private fun fail(state: String, message: String) {
    nativeOnEvent(JSONObject().put("type", "error").put("state", state).put("message", message).toString())
    dispose(sendFinished = true)
  }

  private fun dispose(sendFinished: Boolean) {
    if (disposing) return
    disposing = true
    generation += 1
    releaseResources()
    main.post { hidePresenter() }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    if (sendFinished) nativeOnEvent("{\"type\":\"finished\",\"reason\":\"Native session stopped\"}")
  }

  private fun releaseCaptureAndNetwork() {
    capturing.set(false)
    try { recorder?.stop() } catch (_: Exception) {}
    recorder?.release()
    recorder = null
    projectionStopping = true
    projection?.stop()
    projection = null
    socket?.close(1000, "Audeeo session ended")
    socket = null
    http?.dispatcher?.executorService?.shutdown()
    http = null
  }

  private fun releaseResources() {
    releaseCaptureAndNetwork()
    releaseTranslatedPlayer()
  }

  private fun createNotificationChannel() {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Live translation", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shown while Audeeo captures authorized device playback"
      setSound(null, null)
    })
  }

  private fun showPresenter() {
    if (!Settings.canDrawOverlays(this) || presenter != null) return
    val windowManager = getSystemService(WindowManager::class.java)
    val density = resources.displayMetrics.density
    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding((18 * density).toInt(), (12 * density).toInt(), (18 * density).toInt(), (12 * density).toInt())
      background = GradientDrawable().apply {
        color = android.content.res.ColorStateList.valueOf(Color.rgb(25, 25, 25))
        cornerRadius = 16 * density
        setStroke(max(1, density.toInt()), Color.rgb(59, 59, 59))
      }
    }
    sourceText = TextView(this).apply { setTextColor(Color.rgb(173, 173, 173)); textSize = 14f; maxLines = 1 }
    translationText = TextView(this).apply { setTextColor(Color.rgb(241, 241, 241)); textSize = 18f; maxLines = 2 }
    panel.addView(sourceText)
    panel.addView(translationText)
    val params = WindowManager.LayoutParams(
      resources.displayMetrics.widthPixels - (32 * density).toInt(),
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      y = (88 * density).toInt()
    }
    var downY = 0f
    var originY = 0
    panel.setOnTouchListener { _: View, event: MotionEvent ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> { downY = event.rawY; originY = params.y; true }
        MotionEvent.ACTION_MOVE -> {
          params.y = max(0, originY + (downY - event.rawY).toInt())
          windowManager.updateViewLayout(panel, params)
          true
        }
        else -> false
      }
    }
    presenter = panel
    presenterParams = params
    windowManager.addView(panel, params)
    renderPresenter()
  }

  private fun hidePresenter() {
    val panel = presenter ?: return
    try { getSystemService(WindowManager::class.java).removeView(panel) } catch (_: Exception) {}
    presenter = null
    sourceText = null
    translationText = null
    presenterParams = null
  }

  private fun updatePresenter(raw: String?) {
    if (raw.isNullOrBlank()) return
    try {
      val update = JSONObject(raw)
      lastSource = update.optString("source", lastSource)
      lastTranslation = update.optString("translation", lastTranslation)
      val size = update.optDouble("size", 18.0).toFloat().coerceIn(14f, 40f)
      sourceText?.textSize = size * 0.8f
      translationText?.textSize = size
      renderPresenter()
    } catch (_: Exception) {}
  }

  private fun renderPresenter() {
    sourceText?.text = lastSource
    translationText?.text = lastTranslation
    sourceText?.visibility = if (lastSource.isBlank()) View.GONE else View.VISIBLE
    translationText?.visibility = if (lastTranslation.isBlank()) View.GONE else View.VISIBLE
  }

  override fun onDestroy() {
    if (activeService === this) activeService = null
    dispose(sendFinished = false)
    super.onDestroy()
  }
}
