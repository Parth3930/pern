package com.pern.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

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
  }
}
