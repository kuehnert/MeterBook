package net.mister_k.meterbook.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.FlashlightOff
import androidx.compose.material.icons.outlined.FlashlightOn
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import net.mister_k.meterbook.MeterBookApp
import android.widget.Toast
import java.io.File
import java.time.Instant
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.mister_k.meterbook.data.prepareForUpload
import net.mister_k.meterbook.data.saveToGallery
import net.mister_k.meterbook.work.PhotoWorker

/**
 * Kamera mit Ausrichtungsrahmen. Ein Foto pro Zähler – bei HT/NT beide Zählwerke ins Bild.
 * Jedes Foto geht sofort in den Eingang und wird im Hintergrund erkannt; danach geht es zurück
 * zur Übersicht, damit man den nächsten Zähler wählen kann. meterId = null: Der Server erkennt,
 * welcher Zähler es ist.
 */
@Composable
fun CaptureScreen(
    app: MeterBookApp,
    meterId: String?,
    viewModel: CaptureViewModel,
    /** Foto liegt im Eingang – zurück zur Übersicht */
    onQueued: () -> Unit,
    onManual: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val meter = meterId?.let { app.repo.meter(it) }
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) permission.launch(Manifest.permission.CAMERA) }

    var torch by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val controller = remember {
        LifecycleCameraController(context).apply {
            cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            setEnabledUseCases(LifecycleCameraController.IMAGE_CAPTURE)
            imageCaptureMode = ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY
            imageCaptureFlashMode = ImageCapture.FLASH_MODE_OFF
        }
    }
    LaunchedEffect(torch) { controller.enableTorch(torch) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (granted) {
            AndroidView(
                factory = { ctx ->
                    PreviewView(ctx).apply {
                        this.controller = controller
                        controller.bindToLifecycle(lifecycle)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            // Rahmen, in den das Zählwerk gehört
            Canvas(Modifier.fillMaxSize()) {
                val w = size.width * 0.86f
                val h = if ((meter?.registers?.size ?: 1) > 1) w * 0.62f else w * 0.36f
                val topLeft = Offset((size.width - w) / 2, (size.height - h) / 2.4f)
                drawRoundRect(Color.White, topLeft, Size(w, h), CornerRadius(24f), style = Stroke(width = 5f))
            }
        } else {
            Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Für Fotos braucht MeterBook Zugriff auf die Kamera.", color = Color.White, textAlign = TextAlign.Center)
                Button(onClick = { permission.launch(Manifest.permission.CAMERA) }, Modifier.padding(top = 16.dp)) { Text("Kamera erlauben") }
            }
        }

        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Zurück", tint = Color.White) }
            Column(Modifier.weight(1f)) {
                Text(meter?.name ?: "Zähler fotografieren", color = Color.White, style = MaterialTheme.typography.titleMedium)
                Text(
                    when {
                        meter == null -> "Der Zähler wird automatisch erkannt – Zählernummer möglichst mit ins Bild"
                        meter.registers.size > 1 -> "Alle Zählwerke (${meter.registers.joinToString(" + ") { it.name }}) in den Rahmen"
                        else -> "Zählwerk in den Rahmen"
                    },
                    color = Color.White.copy(alpha = 0.8f),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            IconButton(onClick = { torch = !torch }) {
                Icon(if (torch) Icons.Outlined.FlashlightOn else Icons.Outlined.FlashlightOff, "Licht", tint = Color.White)
            }
        }

        Column(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "Tipp: leicht schräg fotografieren, damit sich das Licht nicht im Glas spiegelt.",
                color = Color.White.copy(alpha = 0.85f),
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
            Box(Modifier.padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                FilledIconButton(
                    onClick = {
                        busy = true
                        error = null
                        val file = File(context.cacheDir, "capture_${System.currentTimeMillis()}.jpg")
                        controller.takePicture(
                            ImageCapture.OutputFileOptions.Builder(file).build(),
                            ContextCompat.getMainExecutor(context),
                            object : ImageCapture.OnImageSavedCallback {
                                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                    // Erst in den Eingang legen, dann den Bildschirm verlassen –
                                    // sonst bricht das Verlassen die Coroutine ab.
                                    scope.launch {
                                        try {
                                            withContext(Dispatchers.IO) {
                                                if (app.session.saveToGallery) runCatching { saveToGallery(app, file, meter?.name) }
                                                val prepared = prepareForUpload(file, File(context.cacheDir, "prep_${System.currentTimeMillis()}.jpg"))
                                                if (prepared != file) file.delete()
                                                app.photoInbox.add(prepared, meterId, Instant.now().toString())
                                            }
                                            PhotoWorker.enqueue(app)
                                            Toast.makeText(context, "Foto im Eingang – wird im Hintergrund erkannt", Toast.LENGTH_SHORT).show()
                                            onQueued()
                                        } catch (e: Exception) {
                                            busy = false
                                            error = "Foto konnte nicht gespeichert werden: ${e.message}"
                                        }
                                    }
                                }

                                override fun onError(e: ImageCaptureException) {
                                    busy = false
                                    error = "Foto fehlgeschlagen: ${e.message}"
                                }
                            },
                        )
                    },
                    enabled = granted && !busy,
                    modifier = Modifier.size(76.dp),
                    shape = CircleShape,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White),
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(28.dp)) else Box(Modifier.size(60.dp).background(Color.White, CircleShape))
                }
            }
            TextButton(onClick = { viewModel.startManual(meterId); onManual() }, enabled = !busy) {
                Icon(Icons.Outlined.Keyboard, null, tint = Color.White)
                Text("  Ohne Foto eingeben", color = Color.White)
            }
        }
    }
}
