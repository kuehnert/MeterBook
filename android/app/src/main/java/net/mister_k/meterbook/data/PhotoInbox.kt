package net.mister_k.meterbook.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import java.io.File
import java.util.UUID

/** Foto auf dem Gerät, das noch nicht (fertig) hochgeladen ist. */
@Serializable
data class LocalPhoto(
    val id: String,
    /** Zähler, falls aus einer Zählerkarte fotografiert; sonst erkennt ihn der Server */
    val meterId: String? = null,
    val takenAt: String,
    /** gesetzt, sobald das Foto auf dem Server liegt */
    val photoId: String? = null,
    val lastError: String? = null,
)

/**
 * Foto-Eingang: Fotos werden sofort hier abgelegt und im Hintergrund hochgeladen (auch später,
 * wenn gerade kein Netz da ist). Der Server erkennt sie und hält sie im Eingang, bis eine
 * Ablesung daraus gespeichert oder das Foto verworfen wird.
 */
class PhotoInbox(context: Context, private val api: Api) {
    private val root = File(context.filesDir, "photo-inbox").apply { mkdirs() }

    private val _local = MutableStateFlow(loadLocal())
    /** Noch nicht hochgeladene Fotos */
    val local: StateFlow<List<LocalPhoto>> = _local.asStateFlow()

    private val _server = MutableStateFlow<List<InboxItem>>(emptyList())
    /** Fotos im Eingang auf dem Server (zuletzt geladener Stand) */
    val server: StateFlow<List<InboxItem>> = _server.asStateFlow()

    private fun jobFile(id: String) = File(root, "$id.json")
    fun imageFile(id: String) = File(root, "$id.jpg")

    /** Lokale Kopie eines hochgeladenen Fotos (für Vorschau und Prüfen ohne Download) */
    fun localFileFor(photoId: String): File? =
        root.listFiles { f -> f.name == "srv_$photoId.jpg" }?.firstOrNull()

    private fun loadLocal(): List<LocalPhoto> =
        root.listFiles { f -> f.name.endsWith(".json") }?.mapNotNull {
            runCatching { api.json.decodeFromString<LocalPhoto>(it.readText()) }.getOrNull()
        }?.sortedBy { it.takenAt } ?: emptyList()

    private fun save(p: LocalPhoto) {
        jobFile(p.id).writeText(api.json.encodeToString(p))
        _local.value = loadLocal()
    }

    /** Foto in den Eingang legen (Datei wird übernommen). */
    fun add(photo: File, meterId: String?, takenAt: String) {
        val id = UUID.randomUUID().toString()
        photo.copyTo(imageFile(id), overwrite = true)
        photo.delete()
        save(LocalPhoto(id, meterId, takenAt))
    }

    /**
     * Lädt alle wartenden Fotos hoch. Gibt die neuen Server-IDs zurück; false im Paar,
     * wenn der Server nicht erreichbar war (dann später erneut versuchen).
     */
    suspend fun upload(): Pair<List<String>, Boolean> {
        val uploaded = mutableListOf<String>()
        for (p in loadLocal().filter { it.photoId == null }) {
            val file = imageFile(p.id)
            if (!file.exists()) {
                jobFile(p.id).delete()
                continue
            }
            try {
                val res = api.uploadToInbox(file, p.meterId, p.takenAt)
                // Datei behalten wir als lokale Kopie unter der Server-ID, der Auftrag ist erledigt
                file.renameTo(File(root, "srv_${res.photoId}.jpg"))
                jobFile(p.id).delete()
                uploaded += res.photoId
            } catch (e: OfflineException) {
                _local.value = loadLocal()
                return uploaded to false
            } catch (e: ApiException) {
                save(p.copy(lastError = e.message))
            }
        }
        _local.value = loadLocal()
        return uploaded to true
    }

    /** Eingang vom Server laden und lokale Kopien erledigter Fotos aufräumen. */
    suspend fun refresh(): List<InboxItem> {
        val items = api.inbox()
        _server.value = items
        val open = items.map { it.photoId }.toSet()
        root.listFiles { f -> f.name.startsWith("srv_") }?.forEach { f ->
            if (f.name.removePrefix("srv_").removeSuffix(".jpg") !in open) f.delete()
        }
        return items
    }

    fun discardLocal(id: String) {
        imageFile(id).delete()
        jobFile(id).delete()
        _local.value = loadLocal()
    }

    /** Nach dem Speichern oder Verwerfen sofort aus der Liste nehmen (ohne auf den Server zu warten) */
    fun markDone(photoId: String) {
        _server.value = _server.value.filterNot { it.photoId == photoId }
        localFileFor(photoId)?.delete()
    }

    fun clear() {
        root.listFiles()?.forEach { it.delete() }
        _local.value = emptyList()
        _server.value = emptyList()
    }
}
