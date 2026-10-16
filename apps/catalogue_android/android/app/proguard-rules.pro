# Project-specific R8 rules for the release build (isMinifyEnabled in
# build.gradle.kts). Flutter's own Gradle plugin already keeps everything the
# engine and platform channels need, and most plugins this app uses
# (video_player, image_picker, share_plus, flutter_secure_storage, hive, etc.)
# ship their own consumer ProGuard rules inside their AAR, applied
# automatically.
#
# google_sign_in (v7, Credential Manager-based) is the exception: it works
# fine in debug (R8 never runs there) but Google Sign-In silently did nothing
# on a Play Store release build with no exception surfaced at all — the
# classic signature of R8 stripping a class that Credential Manager's
# Play Services fallback provider only reaches via reflection at runtime, so
# the failure isn't a GoogleSignInException the app's own catch block can see.
-keep class androidx.credentials.** { *; }
-keep class androidx.credentials.playservices.** { *; }
-keep class com.google.android.gms.auth.api.identity.** { *; }
-keep class com.google.android.libraries.identity.googleid.** { *; }
-dontwarn androidx.credentials.**
-dontwarn com.google.android.gms.auth.api.identity.**
-dontwarn com.google.android.libraries.identity.googleid.**

# Firebase Crashlytics — keep line numbers for readable stack traces; the
# Crashlytics Gradle plugin uploads mapping.txt on release builds to
# deobfuscate class/method names. Matches
# apps/virtual_tryon_android's proguard-rules.pro.
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception
-renamesourcefileattribute SourceFile
