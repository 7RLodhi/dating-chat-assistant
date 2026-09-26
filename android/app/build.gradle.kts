plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.chatassist.overlay"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.chatassist.overlay"
        minSdk = 29
        targetSdk = 35
        versionCode = 8
        versionName = "0.8.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
}

// Rename app-debug.apk to app-debug-<versionName>.apk after packaging, so
// builds are identifiable on disk and on the phone. Done as a post-build
// file rename (not an AGP output API) because AGP 8.5 exposes no supported
// rename hook — verified against the plugin's own interfaces. versionName
// stays the single source of truth in defaultConfig above.
// Build with: gradle renameDebugApk (depends on assembleDebug).
tasks.register("renameDebugApk") {
    dependsOn("assembleDebug")
    doLast {
        val version = android.defaultConfig.versionName ?: "unknown"
        val apkDir = layout.buildDirectory.dir("outputs/apk/debug").get().asFile
        apkDir.listFiles { file -> file.name == "app-debug.apk" }?.forEach { file ->
            val renamed = apkDir.resolve("app-debug-$version.apk")
            if (file.renameTo(renamed)) {
                println("Renamed APK to ${renamed.name}")
            }
        }
    }
}
