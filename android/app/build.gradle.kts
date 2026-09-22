plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.nafduduk.calculator"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.nafduduk.calculator"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // 3D preview: Filament (Google's real-time PBR renderer) is the closest
    // Android equivalent to the web app's Three.js viewer. filament-utils'
    // ModelViewer + gltfio-android load and display a glTF scene with
    // built-in orbit/pan/zoom gestures, so the app doesn't have to
    // hand-roll a GL render loop. It does NOT install any lighting of its
    // own, though, so ui/viewer3d/Viewer3DView.kt adds a sun and a skybox —
    // without them a PBR glTF renders black. All three publish to Maven
    // Central (not just Google's Maven), version chosen to match
    // compileSdk 34 / AGP 8.5.x.
    implementation("com.google.android.filament:filament-android:1.51.5")
    implementation("com.google.android.filament:filament-utils-android:1.51.5")
    implementation("com.google.android.filament:gltfio-android:1.51.5")

    testImplementation("junit:junit:4.13.2")
    // The android.jar on the unit-test classpath stubs org.json out with
    // methods that throw, and library/InstrumentConfig.kt parses its saved
    // blobs with it. The real implementation on the test classpath shadows
    // the stub, so the config tests exercise the same code the app runs.
    testImplementation("org.json:json:20240303")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.09.00"))
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
