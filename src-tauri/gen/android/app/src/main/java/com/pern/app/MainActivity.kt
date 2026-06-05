package com.pern.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.webkit.JavascriptInterface
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.core.app.ActivityCompat
import android.app.Activity

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Write nativeLibraryDir so Rust can find the bundled libllama_server.so binary.
    // This file is read by commands::get_android_native_lib_dir() at command time.
    try {
      val pernDir = java.io.File(filesDir, "pern")
      pernDir.mkdirs()
      java.io.File(pernDir, "native_lib_dir").writeText(applicationInfo.nativeLibraryDir)
      android.util.Log.i("Pern", "nativeLibraryDir: ${applicationInfo.nativeLibraryDir}")
    } catch (e: Exception) {
      android.util.Log.e("Pern", "Failed to write nativeLibDir: ${e.message}")
    }
  }

  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    webView.webChromeClient = object : android.webkit.WebChromeClient() {
      override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
        request.grant(request.resources)
      }
    }
    webView.addJavascriptInterface(AndroidNotificationInterface(this), "AndroidNotification")
  }
}

class AndroidNotificationInterface(private val context: Context) {
  @JavascriptInterface
  fun showNotification(title: String, body: String) {
    val channelId = "pern_todo_reminders"
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        channelId,
        "Todo Reminders",
        NotificationManager.IMPORTANCE_HIGH
      )
      channel.description = "Notifications for todo reminders"
      notificationManager.createNotificationChannel(channel)
    }

    val notification = NotificationCompat.Builder(context, channelId)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()

    notificationManager.notify((System.currentTimeMillis() % 10000).toInt(), notification)
  }

  @JavascriptInterface
  fun requestPermission(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        if (context is Activity) {
          ActivityCompat.requestPermissions(
            context,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            1001
          )
        }
        return false
      }
    }
    return true
  }

  @JavascriptInterface
  fun hasPermission(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }
    return true
  }
}
