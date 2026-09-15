package com.mattdev727.audeeo

import android.os.Bundle
import android.content.Intent
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    @JvmStatic external fun nativeOnOAuth(url: String)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    deliverOAuth(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    deliverOAuth(intent)
  }

  private fun deliverOAuth(intent: Intent?) {
    val url = intent?.data?.toString() ?: return
    if (url.startsWith("audeeo://auth/callback")) {
      intent.data = null
      nativeOnOAuth(url)
    }
  }
}
