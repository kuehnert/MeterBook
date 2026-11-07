package net.mister_k.meterbook.ui

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.Meter
import net.mister_k.meterbook.data.ReadingGroup
import net.mister_k.meterbook.data.SeriesBucket

/** So viele Ablesungen zeigt die Zählerseite, bevor man „Alle“ antippt */
private const val READINGS_SHOWN = 5

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeterScreen(app: MeterBookApp, meterId: String, onBack: () -> Unit, onCapture: (String) -> Unit) {
    val meter: Meter? = remember { app.repo.meter(meterId) }
    // Jahre und Abrechnungsjahre sind beim Kalenderjahr dasselbe – dann nur „Jahre“, sonst nur „Abrechnung“
    val calendarYear = meter == null || (meter.billingStartMonth == 1 && meter.billingStartDay == 1)
    val yearKey = if (calendarYear) "year" else "billing"
    val options = listOf("day" to "Tage", "week" to "Wochen", "month" to "Monate", yearKey to if (calendarYear) "Jahre" else "Abrechnung")
    var granularity by remember {
        val saved = app.session.chartGranularity
        mutableStateOf(if (saved == "year" || saved == "billing") yearKey else saved)
    }
    var buckets by remember { mutableStateOf<List<SeriesBucket>>(emptyList()) }
    var readings by remember { mutableStateOf<List<ReadingGroup>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var showAll by remember { mutableStateOf(false) }
    var photo by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(granularity) {
        try {
            buckets = app.api.series(meterId, granularity).buckets.takeLast(
                when (granularity) {
                    "day" -> 21
                    "week" -> 26
                    "month" -> 25
                    else -> 10
                },
            )
            error = null
        } catch (e: Exception) {
            error = e.message
        }
    }
    LaunchedEffect(Unit) { runCatching { readings = app.api.readings(meterId) } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(meter?.name ?: "Zähler") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Zurück") } },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { onCapture(meterId) }, icon = { Icon(Icons.Outlined.CameraAlt, null) }, text = { Text("Ablesen") })
        },
    ) { pad ->
        LazyColumn(Modifier.fillMaxSize().padding(pad), contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    options.forEachIndexed { i, (key, label) ->
                        SegmentedButton(
                            selected = granularity == key,
                            onClick = {
                                granularity = key
                                app.session.chartGranularity = key
                            },
                            shape = SegmentedButtonDefaults.itemShape(i, options.size),
                            icon = {},
                        ) { Text(label, maxLines = 1, style = MaterialTheme.typography.labelMedium) }
                    }
                }
            }
            item {
                Card {
                    Column(Modifier.padding(start = 8.dp, end = 12.dp, top = 12.dp, bottom = 12.dp)) {
                        when {
                            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 8.dp))
                            buckets.isEmpty() -> Text("Für den Verlauf werden mindestens zwei Ablesungen gebraucht.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 8.dp))
                            else -> Column(Modifier.padding(start = 4.dp)) { ConsumptionChart(buckets, meter, granularity) }
                        }
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                    Text("Letzte Ablesungen", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    if (readings.size > READINGS_SHOWN) {
                        TextButton(onClick = { showAll = !showAll }) { Text(if (showAll) "Weniger" else "Alle ${readings.size}") }
                    }
                }
            }
            items(if (showAll) readings else readings.take(READINGS_SHOWN), key = { it.readAt }) { g ->
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(dateTime(g.readAt), style = MaterialTheme.typography.bodyMedium)
                            g.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                        // Mit Foto: antippen zeigt es an
                        if (g.photoId != null) {
                            IconButton(onClick = { photo = g.photoId }, modifier = Modifier.size(40.dp)) {
                                Icon(Icons.Outlined.Image, "Foto ansehen", tint = MaterialTheme.colorScheme.primary)
                            }
                        } else {
                            Spacer(Modifier.size(40.dp))
                        }
                        Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 8.dp)) {
                            meter?.registers?.forEach { r ->
                                g.values[r.id]?.let {
                                    Text((if (meter.registers.size > 1) "${r.name} " else "") + num(it.value, r.decimals), style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                    HorizontalDivider(Modifier.padding(top = 8.dp))
                }
            }
            item { Spacer(Modifier.height(8.dp)) }
        }
    }
    photo?.let { RemotePhotoDialog(app, it) { photo = null } }
}
