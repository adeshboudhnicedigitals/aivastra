import java.util.Properties

// Test copy of virtual_tryon_android_multi_flow for building the Merchant Android integration
// (device pairing, in-store sessions, events). Firebase is dropped: the original needs a
// google-services.json that is not in the repo, and a test build must not report into the
// production Crashlytics project. See README.md.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Backend this build talks to. Defaults to a local API reached over `adb reverse tcp:4000
// tcp:4000`, never production: test sessions and try-ons create real jobs and charge credits.
// Override with -PaivastraApiBaseUrl=https://staging-app.aivastra.com/
val apiBaseUrl: String =
    (project.findProperty("aivastraApiBaseUrl") as String?) ?: "http://localhost:4000/"
require(!apiBaseUrl.contains("://app.aivastra.com")) {
    "virtual_tryon_android_merchant must not target production ($apiBaseUrl)"
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("keystore.properties")
val hasKeystoreProperties = keystorePropertiesFile.exists()

if (hasKeystoreProperties) {
    keystorePropertiesFile.inputStream().use(keystoreProperties::load)
}

fun requireKeystoreProperty(name: String): String =
    requireNotNull(keystoreProperties.getProperty(name)) {
        "Missing `$name` in ${keystorePropertiesFile.absolutePath}"
    }

android {
    namespace = "aivastra.nice.interactive"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        // Distinct id so it installs next to the production kiosk app on the same tablet.
        // namespace stays aivastra.nice.interactive so no Kotlin package has to move.
        applicationId = "aivastra.nice.interactive.merchanttest"
        minSdk = 28
        targetSdk = 36
        versionCode = 24
        versionName = "1.0.5-merchant-test"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    signingConfigs {
        if (hasKeystoreProperties) {
            create("release") {
                storeFile = rootProject.file(requireKeystoreProperty("storeFile"))
                storePassword = requireKeystoreProperty("storePassword")
                keyAlias = requireKeystoreProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                    ?: requireKeystoreProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            if (hasKeystoreProperties) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.gson)
    implementation(libs.okhttp.logging.interceptor)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.coil.compose)
    implementation(libs.zxing.core)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.androidx.camera.extensions)
    implementation(libs.androidx.compose.foundation.layout)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)
    implementation(libs.play.app.update)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
