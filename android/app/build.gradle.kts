// Version: 2026-11-11
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Der feste Signaturschlüssel der echten App: lokal aus android/keystore.properties (nicht eingecheckt),
// in GitHub Actions aus den Umgebungsvariablen METERBOOK_KEYSTORE_FILE, _PASSWORD, METERBOOK_KEY_ALIAS, _PASSWORD.
// Ohne ihn signiert ein Release-Build mit dem Debug-Schlüssel dieses Rechners: läuft, lässt sich aber
// nicht über eine veröffentlichte App installieren.
val signing: Map<String, String>? = run {
    val file = rootProject.file("keystore.properties")
    val values = if (file.exists()) {
        Properties().apply { file.inputStream().use(::load) }.let { p -> p.stringPropertyNames().associateWith { p.getProperty(it) } }
    } else {
        mapOf(
            "storeFile" to System.getenv("METERBOOK_KEYSTORE_FILE"),
            "storePassword" to System.getenv("METERBOOK_KEYSTORE_PASSWORD"),
            "keyAlias" to System.getenv("METERBOOK_KEY_ALIAS"),
            "keyPassword" to System.getenv("METERBOOK_KEY_PASSWORD"),
        ).filterValues { !it.isNullOrEmpty() }.mapValues { it.value!! }
    }
    values.takeIf { v -> listOf("storeFile", "storePassword", "keyAlias", "keyPassword").all { !v[it].isNullOrEmpty() } }
}

android {
    namespace = "net.mister_k.meterbook"
    compileSdk = 37

    defaultConfig {
        applicationId = "net.mister_k.meterbook"
        minSdk = 29
        targetSdk = 36
        versionCode = 12
        versionName = "0.3.3"
    }

    signingConfigs {
        if (signing != null) {
            create("release") {
                storeFile = file(signing.getValue("storeFile"))
                storePassword = signing.getValue("storePassword")
                keyAlias = signing.getValue("keyAlias")
                keyPassword = signing.getValue("keyPassword")
            }
        }
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
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
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
