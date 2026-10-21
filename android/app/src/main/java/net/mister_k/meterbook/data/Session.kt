package net.mister_k.meterbook.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Server-Adresse und Anmeldung, verschlüsselt auf dem Gerät gespeichert. */
class Session(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val _user = MutableStateFlow(loadUser())
    val user: StateFlow<User?> = _user.asStateFlow()

    var serverUrl: String
        get() = prefs.getString("serverUrl", "") ?: ""
        set(v) = prefs.edit { putString("serverUrl", v.trimEnd('/')) }

    val accessToken: String? get() = prefs.getString("accessToken", null)
    val refreshToken: String? get() = prefs.getString("refreshToken", null)

    /** Erinnerung: 0 = aus, 7 = wöchentlich, 30 = monatlich */
    var reminderDays: Int
        get() = prefs.getInt("reminderDays", 30)
        set(v) = prefs.edit { putInt("reminderDays", v) }

    /** Fotos zusätzlich in der Galerie (Bilder/MeterBook) ablegen */
    var saveToGallery: Boolean
        get() = prefs.getBoolean("saveToGallery", true)
        set(v) = prefs.edit { putBoolean("saveToGallery", v) }

    fun store(t: TokenPair) {
        prefs.edit {
            putString("accessToken", t.accessToken)
            putString("refreshToken", t.refreshToken)
            putString("userId", t.user.id)
            putString("userName", t.user.name)
            putString("userEmail", t.user.email)
            putString("userRole", t.user.role)
        }
        _user.value = t.user
    }

    fun clear() {
        prefs.edit {
            remove("accessToken")
            remove("refreshToken")
            remove("userId")
            remove("userName")
            remove("userEmail")
            remove("userRole")
        }
        _user.value = null
    }

    private fun loadUser(): User? {
        val id = prefs.getString("userId", null) ?: return null
        if (prefs.getString("refreshToken", null) == null) return null
        return User(id, prefs.getString("userEmail", "") ?: "", prefs.getString("userName", "") ?: "", prefs.getString("userRole", "USER") ?: "USER")
    }
}
