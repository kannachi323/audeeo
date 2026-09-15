package com.mattdev727.audeeo

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.os.Build
import android.provider.Settings
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "recordAudio")
  ]
)
class MobileLivePlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    private const val KEY_ALIAS = "audeeo.auth.storage"
    private const val PREFS = "audeeo_secure_auth"
  }

  @Command
  fun startSession(invoke: Invoke) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      invoke.reject("Device playback capture requires Android 10 or later.")
      return
    }
    if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      requestPermissionForAlias("recordAudio", invoke, "recordAudioResult")
      return
    }
    requestProjection(invoke)
  }

  @Command
  fun listApplications(invoke: Invoke) {
    try {
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val activities = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        activity.packageManager.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION") activity.packageManager.queryIntentActivities(launcher, 0)
      }
      val sources = JSONArray()
      val names = JSONArray()
      activities.asSequence()
        .filter { it.activityInfo.packageName != activity.packageName }
        .distinctBy { it.activityInfo.packageName }
        .map { it.activityInfo.packageName to it.loadLabel(activity.packageManager).toString() }
        .sortedBy { it.second.lowercase() }
        .forEach { (packageName, name) ->
          sources.put(JSONObject().put("id", "android:$packageName").put("name", name))
        }
      invoke.resolve(JSObject().apply {
        put("microphone", "Microphone")
        put("applications", names)
        put("captureSources", sources)
      })
    } catch (error: Exception) {
      invoke.reject("Installed applications could not be listed.")
    }
  }

  @PermissionCallback
  private fun recordAudioResult(invoke: Invoke) {
    if (getPermissionState("recordAudio") != PermissionState.GRANTED) {
      invoke.reject("Allow audio recording to capture device playback.")
      return
    }
    requestProjection(invoke)
  }

  private fun requestProjection(invoke: Invoke) {
    val manager = activity.getSystemService(MediaProjectionManager::class.java)
    startActivityForResult(invoke, manager.createScreenCaptureIntent(), "projectionResult")
  }

  @ActivityCallback
  private fun projectionResult(invoke: Invoke, result: ActivityResult) {
    val data = result.data
    if (result.resultCode != Activity.RESULT_OK || data == null) {
      invoke.reject("Device playback capture was not authorized.")
      return
    }
    val service = Intent(activity, PlaybackCaptureService::class.java).apply {
      action = PlaybackCaptureService.ACTION_START
      putExtra(PlaybackCaptureService.EXTRA_RESULT_CODE, result.resultCode)
      putExtra(PlaybackCaptureService.EXTRA_RESULT_DATA, data)
      putExtra(PlaybackCaptureService.EXTRA_SESSION, invoke.getRawArgs())
    }
    ContextCompat.startForegroundService(activity, service)
    invoke.resolve()
  }

  @Command
  fun stopSession(invoke: Invoke) {
    activity.startService(Intent(activity, PlaybackCaptureService::class.java).apply {
      action = PlaybackCaptureService.ACTION_STOP
    })
    invoke.resolve()
  }

  @Command
  fun showPresenter(invoke: Invoke) {
    if (!Settings.canDrawOverlays(activity)) {
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${activity.packageName}"))
      startActivityForResult(invoke, intent, "overlayPermissionResult")
      return
    }
    showPresenterNow()
    invoke.resolve()
  }

  @ActivityCallback
  private fun overlayPermissionResult(invoke: Invoke, result: ActivityResult) {
    if (!Settings.canDrawOverlays(activity)) {
      invoke.reject("Allow display over other apps to show floating captions.")
      return
    }
    showPresenterNow()
    invoke.resolve()
  }

  private fun showPresenterNow() {
    activity.startService(Intent(activity, PlaybackCaptureService::class.java).apply {
      action = PlaybackCaptureService.ACTION_SHOW_PRESENTER
    })
  }

  @Command
  fun hidePresenter(invoke: Invoke) {
    activity.startService(Intent(activity, PlaybackCaptureService::class.java).apply {
      action = PlaybackCaptureService.ACTION_HIDE_PRESENTER
    })
    invoke.resolve()
  }

  @Command
  fun updatePresenter(invoke: Invoke) {
    activity.startService(Intent(activity, PlaybackCaptureService::class.java).apply {
      action = PlaybackCaptureService.ACTION_UPDATE_PRESENTER
      putExtra(PlaybackCaptureService.EXTRA_PRESENTER, invoke.getRawArgs())
    })
    invoke.resolve()
  }

  @Command
  fun playback(invoke: Invoke) {
    try {
      val args = invoke.getArgs()
      if (args.optBoolean("reset") || args.optBoolean("stop")) {
        PlaybackCaptureService.resetTranslatedPlayback()
      }
      if (args.has("volume")) {
        val volume = args.getDouble("volume")
        require(volume.isFinite() && volume in 0.0..1.0) { "Invalid translated volume." }
        PlaybackCaptureService.setTranslatedVolume(volume.toFloat())
      }
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Translated playback could not be updated.")
    }
  }

  @Command
  fun beginOAuth(invoke: Invoke) {
    val url = invoke.getArgs().getString("url")
    try {
      activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject("Couldn’t open the default browser. Check Android default-app settings and try again.")
    }
  }

  @Command
  fun secretGet(invoke: Invoke) {
    try {
      val key = invoke.getArgs().getString("key")
      val stored = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE).getString(key, null)
      val result = JSObject()
      if (stored == null) {
        result.put("value", null)
      } else {
        val combined = Base64.decode(stored, Base64.NO_WRAP)
        require(combined.size > 12) { "Stored credential is invalid." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, combined.copyOfRange(0, 12)))
        result.put("value", String(cipher.doFinal(combined.copyOfRange(12, combined.size)), Charsets.UTF_8))
      }
      invoke.resolve(result)
    } catch (error: Exception) {
      invoke.reject("Secure credential storage is unavailable.")
    }
  }

  @Command
  fun secretSet(invoke: Invoke) {
    try {
      val args = invoke.getArgs()
      val key = args.getString("key")
      val value = if (args.has("value") && !args.isNull("value")) args.getString("value") else null
      val preferences = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
      val saved = if (value == null) {
        preferences.edit().remove(key).commit()
      } else {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val combined = cipher.iv + encrypted
        preferences.edit().putString(key, Base64.encodeToString(combined, Base64.NO_WRAP)).commit()
      }
      require(saved) { "Credential could not be saved." }
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject("Secure credential storage is unavailable.")
    }
  }

  private fun secretKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return generator.generateKey()
  }
}
