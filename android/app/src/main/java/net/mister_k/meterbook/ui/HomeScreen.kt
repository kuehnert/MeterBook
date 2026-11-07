package net.mister_k.meterbook.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import net.mister_k.meterbook.BuildConfig
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.Overview
import net.mister_k.meterbook.work.SyncWorker

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    app: MeterBookApp,
    onCapture: (String) -> Unit,
    onCaptureAuto: () -> Unit,
    onOpenMeter: (String) -> Unit,
    onSettings: () -> Unit,
    onOpenInbox: () -> Unit,
) {
    val localPhotos by app.photoInbox.local.collectAsStateWithLifecycle()
    val serverPhotos by app.photoInbox.server.collectAsStateWithLifecycle()
    var items by remember { mutableStateOf(app.repo.cachedOverview() ?: emptyList()) }
    var env by remember { mutableStateOf<String?>(null) }
    var offline by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val pending by app.queue.items.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    fun load() {
        loading = true
        scope.launch {
            try {
                val (list, cached) = app.repo.overview()
                items = list
                offline = cached
                error = null
                if (!cached && pending.isNotEmpty()) SyncWorker.enqueue(app)
            } catch (e: Exception) {
                error = e.message
            } finally {
                loading = false
            }
        }
    }
    LaunchedEffect(Unit) {
        load()
        env = runCatching { app.api.health().env }.getOrNull()
        runCatching { app.photoInbox.refresh() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("MeterBook")
                        Spacer(Modifier.width(8.dp))
                        Text(
                            BuildConfig.VERSION_NAME,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                        env?.let {
                            Spacer(Modifier.width(8.dp))
                            Badge(containerColor = MaterialTheme.colorScheme.tertiary) { Text(it, Modifier.padding(horizontal = 4.dp)) }
                        }
                    }
                },
                actions = { IconButton(onClick = onSettings) { Icon(Icons.Outlined.Settings, "Einstellungen") } },
            )
        },
        floatingActionButton = {
            // Ein Knopf für alles: Foto machen, der Zähler wird automatisch erkannt.
            if (items.isNotEmpty()) {
                FloatingActionButton(onClick = onCaptureAuto) {
                    Icon(Icons.Outlined.AddAPhoto, "Zähler fotografieren")
                }
            }
        },
    ) { pad ->
        PullToRefreshBox(isRefreshing = loading, onRefresh = ::load, modifier = Modifier.fillMaxSize().padding(pad)) {
            LazyColumn(
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 88.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                if (offline) {
                    item { Banner(Icons.Outlined.CloudOff, "Offline – zuletzt geladene Daten. Ablesungen werden später gesendet.") }
                }
                val inboxCount = localPhotos.size + serverPhotos.size
                if (inboxCount > 0) {
                    item {
                        InboxChip(
                            count = inboxCount,
                            pending = localPhotos.size + serverPhotos.count { it.ocrStatus == "PENDING" },
                            onClick = onOpenInbox,
                        )
                    }
                }
                if (pending.isNotEmpty()) {
                    item {
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.CloudUpload, null)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("${pending.size} Ablesung(en) warten auf Übertragung", style = MaterialTheme.typography.bodyMedium)
                                    pending.firstOrNull { it.lastError != null }?.let {
                                        Text("${it.meterName}: ${it.lastError}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                                    }
                                }
                                TextButton(onClick = { SyncWorker.enqueue(app) }) { Text("Senden") }
                            }
                        }
                    }
                }
                error?.let { item { Banner(Icons.Outlined.CloudOff, it) } }
                if (items.isEmpty() && !loading && error == null) {
                    item {
                        Text(
                            "Noch keine Zähler. Lege Zähler im Web-Frontend an – sie erscheinen dann hier.",
                            Modifier.padding(16.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(items, key = { it.meter.id }) { o ->
                    MeterCard(o, onCapture = { onCapture(o.meter.id) }, onOpen = { onOpenMeter(o.meter.id) })
                }
            }
        }
    }
}

@Composable
private fun Banner(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null)
            Spacer(Modifier.width(12.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** Verbrauch je nach Größe mit sinnvollen Nachkommastellen (Wasser in m³ braucht mehr) */
private fun amount(v: Double): String = num(v, if (v < 1) 2 else if (v < 100) 1 else 0)

private val RECENT_SHORT = mapOf("Woche" to "Woche", "Monat" to "Monat", "Vierteljahr" to "Quartal", "Jahr" to "Jahr")

/**
 * Kompakte Karte – vier Zähler sollen ohne Scrollen auf einen Handybildschirm passen:
 * Kopfzeile mit Foto-Knopf, der Verbrauch der letzten Woche/Monat/Quartal/Jahr und eine
 * Zeile zur laufenden Abrechnungsperiode.
 */
@Composable
private fun MeterCard(o: Overview, onCapture: () -> Unit, onOpen: () -> Unit) {
    val m = o.meter
    val p = o.currentPeriod
    val stale = (o.daysSinceLastReading ?: Int.MAX_VALUE) > 35
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val recent = o.recentConsumption.filter { it.total != null }
    Card(Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Column(Modifier.padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Icon(meterIcon(m), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.name, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text(
                        daysAgo(o.daysSinceLastReading),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (stale) MaterialTheme.colorScheme.error else muted,
                        maxLines = 1,
                    )
                }
                FilledIconButton(onClick = onCapture) {
                    Icon(Icons.Outlined.AddAPhoto, "${m.name} ablesen")
                }
            }

            if (recent.isEmpty()) {
                Text(
                    if (o.recent.isEmpty()) "Noch keine Ablesung" else "Für Verbrauchswerte werden mehr Ablesungen gebraucht.",
                    style = MaterialTheme.typography.bodySmall,
                    color = muted,
                    modifier = Modifier.padding(end = 8.dp),
                )
            } else {
                // Verbrauch der letzten Woche, des letzten Monats, Quartals und Jahres (in der Einheit des Zählers)
                Row(Modifier.padding(top = 4.dp, end = 6.dp)) {
                    recent.forEach { r ->
                        Column(Modifier.weight(1f)) {
                            Text(RECENT_SHORT[r.label] ?: r.label, style = MaterialTheme.typography.labelSmall, color = muted, maxLines = 1)
                            Text(
                                buildAnnotatedString {
                                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
                                        append((if (r.estimated) "≈" else "") + amount(r.total!!))
                                    }
                                    withStyle(SpanStyle(fontSize = MaterialTheme.typography.labelSmall.fontSize, color = muted)) { append(" ${m.unit}") }
                                },
                                style = MaterialTheme.typography.titleSmall,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }

            if (p != null && p.total != null) {
                // Kleine Tabelle: Bezeichnung | Verbrauch | Kosten – Zahlen rechtsbündig untereinander
                val hasCost = p.cost != null || p.forecastCost != null
                Column(Modifier.padding(top = 6.dp, end = 8.dp)) {
                    PeriodRow("${p.label} bisher", "${amount(p.total)} ${m.unit}", p.cost?.let { eur(it.total) }, hasCost, bold = false)
                    p.forecastTotal?.let {
                        PeriodRow("Prognose bis ${lastDay(p.end)}", "${amount(it)} ${m.unit}", p.forecastCost?.let { c -> eur(c) }, hasCost, bold = true)
                    }
                }
            }
        }
    }
}

/** Zeile der Periodentabelle; feste Spaltenbreiten, damit kWh und € genau untereinander stehen */
@Composable
private fun PeriodRow(label: String, amount: String, cost: String?, hasCost: Boolean, bold: Boolean) {
    val style = MaterialTheme.typography.bodySmall
    val weight = if (bold) FontWeight.SemiBold else null
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, modifier = Modifier.weight(1f))
        Text(amount, style = style, fontWeight = weight, textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(88.dp))
        if (hasCost) {
            Text(cost ?: "–", style = style, fontWeight = weight, textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(80.dp))
        }
    }
}
