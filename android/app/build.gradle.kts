plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "net.mister_k.meterbook"
    compileSdk = 37

    defaultConfig {
        applicationId = "net.mister_k.meterbook"
        minSdk = 29
        targetSdk = 36
        versionCode = 11
        versionName = "0.3.2"
    }

    buildTypes {
        // Testversion neben der echten App: eigene ID, eigener Name, eigene Anmeldung
        debug {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            resValue("string", "app_name", "MeterBook Dev")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Bis ein eigener Signaturschlüssel eingerichtet ist, mit dem Debug-Schlüssel signieren.
            signingConfig = signingConfigs.getByName("debug")
            resValue("string", "app_name", "MeterBook")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
        resValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.work.runtime)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.security.crypto)
    implementation(libs.exifinterface)
    implementation(libs.coil.compose)
    debugImplementation(libs.compose.ui.tooling)
}

// Fertige APKs mit sprechendem Namen nach <repo>/apk kopieren, z. B. meterbook-0.2.0.apk
// und meterbook-dev-0.2.0.apk (Testversion). Läuft automatisch nach assembleRelease/assembleDebug.
val appVersion = android.defaultConfig.versionName
listOf("release" to "meterbook", "debug" to "meterbook-dev").forEach { (type, prefix) ->
    val copy = tasks.register<Copy>("copy${type.replaceFirstChar { it.uppercase() }}Apk") {
        from(layout.buildDirectory.dir("outputs/apk/$type")) { include("*.apk") }
        into(rootProject.layout.projectDirectory.dir("../apk"))
        rename { "$prefix-$appVersion.apk" }
    }
    tasks.matching { it.name == "assemble${type.replaceFirstChar { it.uppercase() }}" }.configureEach { finalizedBy(copy) }
}

// Die echte App nach dem Kopieren in den MeterBook-Store laden (kuehnert.online/meterbook),
// siehe scripts/publish-apk.mjs. Ohne Zugangsdaten (scripts/apk-store.env oder
// METERBOOK_STORE_ENV) nur ein Hinweis; mit -PnoPublish wird nie hochgeladen.
val repoDir = rootProject.layout.projectDirectory.dir("..").asFile
val publishApk = tasks.register<Exec>("publishReleaseApk") {
    workingDir = repoDir
    commandLine("node", "scripts/publish-apk.mjs", appVersion)
    onlyIf("Zugangsdaten für den Store vorhanden") {
        val found = System.getenv("METERBOOK_STORE_ENV") != null || repoDir.resolve("scripts/apk-store.env").exists()
        if (!found) logger.lifecycle("publishReleaseApk: keine scripts/apk-store.env – APK nicht hochgeladen.")
        found && !project.hasProperty("noPublish")
    }
}
tasks.named("copyReleaseApk") { finalizedBy(publishApk) }
