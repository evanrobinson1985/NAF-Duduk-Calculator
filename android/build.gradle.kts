// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    // 8.6.0 is the first AGP that accepts compileSdk 35 (see app/build.gradle.kts);
    // it needs Gradle 8.7 or newer, and the wrapper here is 8.14.3.
    id("com.android.application") version "8.6.0" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
