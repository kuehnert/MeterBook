package net.mister_k.meterbook.data

import android.content.Context
import java.io.File

/**
 * Hält die zuletzt geladene Übersicht auf dem Gerät vor, damit Zähler auch ohne Netz
 * (z. B. im Keller) ausgewählt und abgelesen werden können.
 */
class Repository(context: Context, private val api: Api) {
    private val cacheFile = File(context.filesDir, "overview.json")

    fun cachedOverview(): List<Overview>? =
        runCatching { api.json.decodeFromString<List<Overview>>(cacheFile.readText()) }.getOrNull()

    /** Lädt die Übersicht vom Server; bei fehlendem Netz kommt die gespeicherte Fassung. */
    suspend fun overview(): Pair<List<Overview>, Boolean> = try {
        val fresh = api.overview()
        cacheFile.writeText(api.json.encodeToString(fresh))
        fresh to false
    } catch (e: OfflineException) {
        (cachedOverview() ?: throw e) to true
    }

    fun meter(id: String): Meter? = cachedOverview()?.firstOrNull { it.meter.id == id }?.meter

    fun clear() {
        cacheFile.delete()
    }
}
