package net.mister_k.meterbook.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ZoomIn
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Lädt ein Foto verkleinert (max. ca. 2000 px), damit es flott angezeigt werden kann. */
@Composable
private fun rememberBitmap(file: File): Bitmap? {
    val bmp by produceState<Bitmap?>(null, file) {
        value = withContext(Dispatchers.IO) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2000) sample *= 2
            BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
        }
    }
    return bmp
}

/**
 * Zeigt den Ausschnitt mit den erkannten Ziffern (alle Zählwerke zusammen, mit etwas Rand).
 * Ohne Ausschnitt das ganze Foto. Antippen öffnet das Foto mit Zoom.
 */
@Composable
fun DigitsPreview(file: File, boxes: List<List<Double>>) {
    val bmp = rememberBitmap(file) ?: return
    var zoom by remember { mutableStateOf(false) }
    val crop = remember(bmp, boxes) {
        if (boxes.isEmpty()) return@remember bmp
        val left = boxes.minOf { it[0] }
        val top = boxes.minOf { it[1] }
        val right = boxes.maxOf { it[0] + it[2] }
        val bottom = boxes.maxOf { it[1] + it[3] }
        // Großzügiger Rand, weil die Lage der Ziffern nur ungefähr bekannt ist
        val padX = (right - left) * 0.25 + 0.03
        val padY = (bottom - top) * 0.6 + 0.03
        val x0 = ((left - padX).coerceAtLeast(0.0) * bmp.width).toInt()
        val y0 = ((top - padY).coerceAtLeast(0.0) * bmp.height).toInt()
        val x1 = ((right + padX).coerceAtMost(1.0) * bmp.width).toInt()
        val y1 = ((bottom + padY).coerceAtMost(1.0) * bmp.height).toInt()
        if (x1 - x0 < 20 || y1 - y0 < 20) bmp else Bitmap.createBitmap(bmp, x0, y0, x1 - x0, y1 - y0)
    }
    Box(Modifier.fillMaxWidth()) {
        Image(
            crop.asImageBitmap(),
            contentDescription = "Erkannte Ziffern",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp).clip(RoundedCornerShape(12.dp)).clickable { zoom = true },
        )
        Surface(
            Modifier.align(Alignment.BottomEnd).padding(8.dp),
            shape = RoundedCornerShape(50),
            color = Color.Black.copy(alpha = 0.55f),
        ) {
            Text(
                if (boxes.isEmpty()) "Antippen zum Vergrößern" else "Ausschnitt · antippen für ganzes Foto",
                color = Color.White,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    }
    if (zoom) ZoomDialog(bmp) { zoom = false }
}

/** Ganzes Foto im Vollbild, mit zwei Fingern zoom- und verschiebbar, Doppeltipp = Zoom. */
@Composable
private fun ZoomDialog(bmp: Bitmap, onClose: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            Image(
                bmp.asImageBitmap(),
                contentDescription = "Foto",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, gestureZoom, _ ->
                            scale = (scale * gestureZoom).coerceIn(1f, 8f)
                            offset = if (scale == 1f) Offset.Zero else offset + pan
                        }
                    }
                    .pointerInput(Unit) {
                        detectTapGestures(onDoubleTap = {
                            scale = if (scale > 1f) 1f else 3f
                            offset = Offset.Zero
                        })
                    }
                    .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
            )
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(8.dp)) {
                Icon(Icons.Outlined.Close, "Schließen", tint = Color.White)
            }
            ZoomHint(Modifier.align(Alignment.BottomCenter).padding(24.dp))
        }
    }
}

@Composable
private fun ZoomHint(modifier: Modifier) {
    Surface(modifier, shape = RoundedCornerShape(50), color = Color.Black.copy(alpha = 0.55f)) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ZoomIn, null, tint = Color.White)
            Text("  Mit zwei Fingern zoomen, Doppeltipp vergrößert", color = Color.White, style = MaterialTheme.typography.labelSmall)
        }
    }
}
