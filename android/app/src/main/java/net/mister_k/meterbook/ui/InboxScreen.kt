package net.mister_k.meterbook.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.InboxItem
import net.mister_k.meterbook.work.PhotoWorker
import java.io.File

/**
 * Eingang: Fotos, die noch hochgeladen, erkannt oder geprüft werden müssen.
 * Ein erkanntes Foto antippen → prüfen und speichern.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(app: MeterBookApp, onOpen: (InboxItem) -> Unit, onCapture: () -> Unit, onBack: () -> Unit) {
    val local by app.photoInbox.local.collectAsStateWithLifecycle()
    val server by app.photoInbox.server.collectAsStateWithLifecycle()
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun load() {
        loading = true
        scope.launch {
            offline = runCatching { app.photoInbox.refresh() }.isFailure
            loading = false
        }
    }

    // Solange noch etwas hochgeladen oder erkannt wird: regelmäßig nachsehen
    LaunchedEffect(Unit) {
        if (local.isNotEmpty()) PhotoWorker.enqueue(app)
        while (true) {
            offline = runCatching { app.photoInbox.refresh() }.isFailure
            val busy = app.photoInbox.local.value.isNotEmpty() || app.photoInbox.server.value.any { it.ocrStatus == "PENDING" }
            delay(if (busy) 3_000 else 30_000)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Eingang") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Zurück") } },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onCapture) { Icon(Icons.Outlined.AddAPhoto, "Weitere Fotos") }
        },
    ) { pad ->
        PullToRefreshBox(isRefreshing = loading, onRefresh = ::load, modifier = Modifier.fillMaxSize().padding(pad)) {
            LazyColumn(
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 88.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                if (offline) {
                    item {
                        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.CloudOff, null)
                            Spacer(Modifier.width(8.dp))
                            Text("Kein Netz – Fotos werden gesendet und erkannt, sobald wieder Verbindung besteht.", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                if (local.isEmpty() && server.isEmpty() && !loading) {
                    item {
                        Text(
                            "Keine Fotos zu prüfen.",
                            Modifier.padding(24.dp).fillMaxWidth(),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                // Noch auf dem Gerät
                items(local, key = { "l-" + it.id }) { p ->
                    Row(Modifier.fillMaxWidth()) {
                        InboxRow(
                            image = app.photoInbox.imageFile(p.id),
                            title = p.meterId?.let { app.repo.meter(it)?.name } ?: "Neues Foto",
                            status = p.lastError ?: "wartet auf Netz",
                            busy = p.lastError == null,
                            warn = p.lastError != null,
                            onClick = null,
                            onDelete = { app.photoInbox.discardLocal(p.id) },
                        )
                    }
                }
                // Auf dem Server
                items(server, key = { "s-" + it.photoId }) { item ->
                    val meterName = item.meterId?.let { app.repo.meter(it)?.name }
                    val (status, warn) = when {
                        item.ocrStatus == "PENDING" -> "wird erkannt …" to false
                        item.ocrStatus == "FAILED" -> "nicht erkannt – antippen und Werte eingeben" to true
                        meterName == null -> "Zähler wählen – antippen" to true
                        else -> "erkannt – antippen zum Prüfen" to false
                    }
                    InboxRow(
                        image = app.photoInbox.localFileFor(item.photoId),
                        title = meterName ?: "Zähler unbekannt",
                        status = "${date(item.takenAt)} · $status",
                        busy = item.ocrStatus == "PENDING",
                        warn = warn,
                        onClick = if (item.ocrStatus == "PENDING") null else ({ onOpen(item) }),
                        onDelete = null,
                    )
                }
            }
        }
    }
}

@Composable
private fun InboxRow(
    image: File?,
    title: String,
    status: String,
    busy: Boolean,
    warn: Boolean,
    onClick: (() -> Unit)?,
    onDelete: (() -> Unit)?,
) {
    Card(Modifier.fillMaxWidth().let { if (onClick != null) it.clickable(onClick = onClick) else it }) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(64.dp).clip(RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                if (image?.exists() == true) {
                    AsyncImage(model = image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                } else {
                    Icon(Icons.Outlined.Image, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        status,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (warn) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (onDelete != null) {
                IconButton(onClick = onDelete) { Icon(Icons.Outlined.Delete, "Verwerfen") }
            }
        }
    }
}

/** Hinweis auf der Startseite: so viele Fotos warten im Eingang */
@Composable
fun InboxChip(count: Int, pending: Int, onClick: () -> Unit) {
    AssistChip(
        onClick = onClick,
        label = { Text(if (pending > 0) "$count im Eingang · $pending werden erkannt" else if (count == 1) "1 Foto zum Prüfen" else "$count Fotos zum Prüfen") },
        leadingIcon = { Icon(Icons.Outlined.Image, null, Modifier.size(18.dp)) },
        colors = AssistChipDefaults.assistChipColors(containerColor = MaterialTheme.colorScheme.secondaryContainer, labelColor = Color.Unspecified),
    )
}
