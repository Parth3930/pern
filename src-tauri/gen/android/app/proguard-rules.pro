# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Preserve line number info for debugging stack traces.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep all native (JNI) methods across the app package
-keepclasseswithmembernames class com.pern.app.** {
    native <methods>;
}

# Keep WebView JS interface methods (used by Tauri IPC bridge)
-keepclassmembers class com.pern.app.** {
    @android.webkit.JavascriptInterface public *;
}

# Keep Tauri/Wry plugin infrastructure
-keep class app.tauri.** { *; }
-keep class com.pern.app.generated.** { *; }

# Keep AndroidX WebKit classes (used by the Tauri WebView)
-keep class androidx.webkit.** { *; }

# Keep Rust JNI entry points
-keepclasseswithmembers class * {
    native <methods>;
}

# Keep OkHttp (used by reqwest internally on Android via JNI)
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }