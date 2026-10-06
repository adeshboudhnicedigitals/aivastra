import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Real release signing (android/key.properties, gitignored — see
// android/.gitignore's "never publicly share your keystore" block). Falls
// back to nothing if the file is missing, e.g. on a fresh checkout that
// hasn't generated a keystore yet, so `flutter build` doesn't hard-fail;
// `flutter build --release`/`--appbundle` would then produce an UNSIGNED
// release build until android/key.properties + the keystore file it points
// to exist on that machine.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.nice.aivastracatalogue"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.nice.aivastracatalogue"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        // No debug-specific block: it doesn't actually shrink debug builds
        // (Flutter's own Gradle plugin overrides buildType-level
        // `ndk.abiFilters` to match whatever `--target-platform` says, so a
        // hardcoded filter here is silently discarded), and it actively
        // breaks `flutter build apk --release --split-per-abi` ("Conflicting
        // configuration" — AGP won't allow ndk.abiFilters and splits.abi at
        // once). Use `flutter build apk --debug --target-platform
        // android-arm64` (or `flutter run`, which already targets only the
        // connected device) for a smaller one-off debug build instead.
        release {
            // Real release keystore (android/key.properties + the .jks it
            // points to, both gitignored) — was signingConfigs.getByName
            // ("debug") until now, which Google Play Console rejects outright:
            // it recognizes the well-known Android debug certificate and
            // refuses any upload signed with it.
            signingConfig = signingConfigs.getByName("release")
            // R8: strips unused code and de-identifies what's left; shrinkResources
            // additionally drops any drawable/layout/string not actually referenced.
            // Debug builds are unaffected (R8 never runs for them), so this has no
            // bearing on the day-to-day debug APKs used for on-device testing.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
