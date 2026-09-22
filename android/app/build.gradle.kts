plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.nafduduk.calculator"
    // compileSdk 35 needs AGP 8.6.0 or newer (see the root build file), and
    // the android-35 platform installed. This is the one setting in the
    // project that could not be verified in the environment it was changed
    // in — Google's Maven is unreachable there, so no AGP or platform
    // artifact could be resolved. Everything else here is checked by a build
    // or a test. If your SDK has no android-35, install it or drop both this
    // and targetSdk back to 34 and AGP back to 8.5.2.
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nafduduk.calculator"
        minSdk = 26
        // Google Play requires API 35 for app updates as of August 2025.
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.00"))

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")

    // Deliberately NOT declared, because nothing imports them (checked
    // against every file under src/main/java):
    //   material-icons-extended — several MB of vector assets; this app draws
    //     its own icons as text glyphs.
    //   navigation-compose — the app switches screens with its own state, so
    //     there is no NavHost.
    //   lifecycle-runtime-ktx — nothing references androidx.lifecycle, and
    //     activity-compose brings what Compose itself needs.
    //   ui-tooling / ui-tooling-preview / ui-test-manifest — there is not a
    //     single @Preview in the project.
    //   the androidTest dependencies — there is no androidTest source set.

    // 3D preview: Filament (Google's real-time PBR renderer) is the closest
    // Android equivalent to the web app's Three.js viewer. filament-utils'
    // ModelViewer + gltfio-android load and display a glTF scene with
    // built-in orbit/pan/zoom gestures, so the app doesn't have to
    // hand-roll a GL render loop. It does NOT install any lighting of its
    // own, though, so ui/viewer3d/Viewer3DView.kt adds a sun and a skybox —
    // without them a PBR glTF renders black. All three publish to Maven
    // Central (not just Google's Maven).
    implementation("com.google.android.filament:filament-android:1.51.5")
    implementation("com.google.android.filament:filament-utils-android:1.51.5")
    implementation("com.google.android.filament:gltfio-android:1.51.5")

    testImplementation("junit:junit:4.13.2")
    // The android.jar on the unit-test classpath stubs org.json out with
    // methods that throw, and library/InstrumentConfig.kt parses its saved
    // blobs with it. The real implementation on the test classpath shadows
    // the stub, so the config tests exercise the same code the app runs.
    testImplementation("org.json:json:20240303")
}
