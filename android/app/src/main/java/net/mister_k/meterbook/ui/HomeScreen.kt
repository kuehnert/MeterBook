package net.mister_k.meterbook.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.Overview
import net.mister_k.meterbook.work.SyncWorker

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(app: MeterBookApp, onCapture: (String) -> Unit, onOpenMeter: (String) -> Unit, onSettings: () -> Unit) {
    var items by remember { mutableStateOf(app.repo.cachedOverview() ?: emptyList()) }
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
    LaunchedEffect(Unit) { load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("MeterBook") },
                actions = { IconButton(onClick = onSettings) { Icon(Icons.Outlined.Settings, "Einstellungen") } },
            )
        },
    ) { pad ->
        PullToRefreshBox(isRefreshing = loading, onRefresh = ::load, modifier = Modifier.fillMaxSize().padding(pad)) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                if (offline) {
                    item {
                        Banner(Icons.Outlined.CloudOff, "Offline – zuletzt geladene Daten. Ablesungen werden gespeichert und später gesendet.")
                    }
                }
                if (pending.isNotEmpty()) {
                    item {
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.CloudUpload, null)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("${pending.size} Ablesung(en) warten auf Übertragung")
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

@Composable
private fun MeterCard(o: Overview, onCapture: () -> Unit, onOpen: () -> Unit) {
    val m = o.meter
    val p = o.currentPeriod
    val stale = (o.daysSinceLastReading ?: Int.MAX_VALUE) > 35
    Card(Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(meterIcon(m), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.name, style = MaterialTheme.typography.titleMedium)
                    Text(
                        daysAgo(o.daysSinceLastReading),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (stale) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                m.registers.forEach { r ->
                    Column {
                        Text(if (m.registers.size > 1) r.name else "Stand", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${num(r.lastReading?.value, r.decimals)} ${m.unit}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            if (p != null) {
                HorizontalDivider(Modifier.padding(vertical = 12.dp))
                Text("Periode ${p.label}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Line("Bisher", "${num(p.total, 0)} ${m.unit}" + (p.cost?.let { " · ${eur(it.total)}" } ?: ""))
                p.forecastTotal?.let { Line("Hochrechnung", "${num(it, 0)} ${m.unit}" + (p.forecastCost?.let { c -> " · ${eur(c)}" } ?: "")) }
                p.balance?.let {
                    Row(Modifier.padding(top = 4.dp)) {
                        AssistChip(onClick = {}, label = { Text(if (it > 0) "Nachzahlung ca. ${eur(it)}" else "Guthaben ca. ${eur(-it)}") })
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onCapture, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Outlined.CameraAlt, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Ablesen")
                }
                OutlinedButton(onClick = onOpen, modifier = Modifier.weight(1f)) { Text("Verlauf") }
            }
        }
    }
}

@Composable
private fun Line(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
