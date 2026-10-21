package net.mister_k.meterbook.data

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Legt eine Kopie des Fotos in der Galerie unter Bilder/MeterBook ab (ohne Zusatzberechtigung). */
fun saveToGallery(context: Context, photo: File, meterName: String?) {
    val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.GERMANY).format(Date())
    val safeName = meterName?.replace(Regex("[^A-Za-z0-9ÄÖÜäöüß_-]"), "_")?.take(30)
    val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, listOfNotNull("MeterBook", safeName, stamp).joinToString("_") + ".jpg")
        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        put(MediaStore.Images.Media.DATE_TAKEN, System.currentTimeMillis())
        put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/MeterBook")
        put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return
    try {
        resolver.openOutputStream(uri)?.use { out -> photo.inputStream().use { it.copyTo(out) } }
        resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
        resolver.delete(uri, null, null)
    }
}
