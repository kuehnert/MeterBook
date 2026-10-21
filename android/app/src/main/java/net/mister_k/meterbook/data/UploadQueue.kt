package net.mister_k.meterbook.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import java.io.File
import java.util.UUID

/**
 * Ablesungen, die ohne Netz erfasst wurden. Jede liegt in einem eigenen Ordner mit
 * job.json und optional photo.jpg und wird vom SyncWorker hochgeladen.
 */
@Serializable
data class PendingReading(
    val id: String,
    val meterId: String,
    val meterName: String,
    val readAt: String,
    val note: String? = null,
    val values: List<ReadingValueIn>,
    /** Wird gesetzt, sobald das Foto hochgeladen ist, damit es nicht doppelt hochgeht. */
    val photoId: String? = null,
    val lastError: String? = null,
)

class UploadQueue(private val context: Context, private val api: Api) {
    private val root = File(context.filesDir, "pending").apply { mkdirs() }
    private val _items = MutableStateFlow(load())
    val items: StateFlow<List<PendingReading>> = _items.asStateFlow()

    private fun load(): List<PendingReading> =
        root.listFiles()?.mapNotNull { dir ->
            runCatching { api.json.decodeFromString<PendingReading>(File(dir, "job.json").readText()) }.getOrNull()
        }?.sortedBy { it.readAt } ?: emptyList()

    private fun refresh() {
        _items.value = load()
    }

    fun add(meterId: String, meterName: String, readAt: String, values: List<ReadingValueIn>, note: String?, photo: File?) {
        val id = UUID.randomUUID().toString()
        val dir = File(root, id).apply { mkdirs() }
        photo?.copyTo(File(dir, "photo.jpg"), overwrite = true)
        write(dir, PendingReading(id, meterId, meterName, readAt, note, values))
        refresh()
    }

    private fun write(dir: File, p: PendingReading) {
        File(dir, "job.json").writeText(api.json.encodeToString(p))
    }

    /** Lädt alle wartenden Ablesungen hoch. Gibt false zurück, wenn der Server nicht erreichbar war. */
    suspend fun flush(): Boolean {
        for (p in load()) {
            val dir = File(root, p.id)
            try {
                var job = p
                val photo = File(dir, "photo.jpg")
                if (photo.exists() && job.photoId == null) {
                    val res = api.uploadPhoto(job.meterId, photo, job.readAt, recognize = false)
                    job = job.copy(photoId = res.photoId)
                    write(dir, job)
                }
                api.saveReading(job.meterId, ReadingGroupIn(job.readAt, job.photoId, if (job.photoId != null) "PHOTO" else "MANUAL", job.note, job.values))
                dir.deleteRecursively()
            } catch (e: OfflineException) {
                refresh()
                return false
            } catch (e: ApiException) {
                // Fachlicher Fehler (z. B. Zähler gelöscht): merken, nicht endlos wiederholen.
                write(dir, p.copy(lastError = e.message))
            }
        }
        refresh()
        return true
    }

    fun remove(id: String) {
        File(root, id).deleteRecursively()
        refresh()
    }
}

/** Verkleinert ein Kamerafoto auf max. 2400 px, dreht es nach EXIF und speichert es als JPEG. */
fun prepareForUpload(source: File, target: File): File {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.absolutePath, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2400) sample *= 2
    val bmp = BitmapFactory.decodeFile(source.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return source
    val rotation = when (ExifInterface(source.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    val scale = minOf(1f, 2400f / maxOf(bmp.width, bmp.height))
    val m = Matrix().apply {
        postScale(scale, scale)
        postRotate(rotation)
    }
    val out = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    target.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 88, it) }
    if (out !== bmp) out.recycle()
    bmp.recycle()
    return target
}
