package net.mister_k.meterbook.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.material.icons.outlined.PhotoCamera
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
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.unit.dp
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.Meter
import net.mister_k.meterbook.data.ReadingGroup
import net.mister_k.meterbook.data.SeriesBucket

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeterScreen(app: MeterBookApp, meterId: String, onBack: () -> Unit, onCapture: (String) -> Unit) {
    val meter: Meter? = remember { app.repo.meter(meterId) }
    var granularity by remember { mutableStateOf("month") }
    var buckets by remember { mutableStateOf<List<SeriesBucket>>(emptyList()) }
    var readings by remember { mutableStateOf<List<ReadingGroup>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(granularity) {
        try {
            buckets = app.api.series(meterId, granularity).buckets.takeLast(
                when (granularity) {
                    "day" -> 31
                    "week" -> 26
                    "month" -> 24
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
                val options = listOf("day" to "Tage", "week" to "Wochen", "month" to "Monate", "year" to "Jahre", "billing" to "Abr.")
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    options.forEachIndexed { i, (key, label) ->
                        SegmentedButton(
                            selected = granularity == key,
                            onClick = { granularity = key },
                            shape = SegmentedButtonDefaults.itemShape(i, options.size),
                            icon = {},
                        ) { Text(label, maxLines = 1, style = MaterialTheme.typography.labelMedium) }
                    }
                }
            }
            item {
                Card {
                    Column(Modifier.padding(16.dp)) {
                        Text("Verbrauch in ${meter?.unit ?: ""}", style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(12.dp))
                        if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
                        else if (buckets.isEmpty()) Text("Noch zu wenige Ablesungen.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else BarChart(buckets, meter)
                    }
                }
            }
            item { Text("Ablesungen", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
            items(readings.take(50), key = { it.readAt }) { g ->
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(dateTime(g.readAt), style = MaterialTheme.typography.bodyMedium)
                            g.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                        if (g.photoId != null) Icon(Icons.Outlined.PhotoCamera, "mit Foto", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 12.dp)) {
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
        }
    }
}

/** Einfaches gestapeltes Balkendiagramm mit Vorjahreslinie. */
@Composable
private fun BarChart(buckets: List<SeriesBucket>, meter: Meter?) {
    val colors = listOf(MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.tertiary, MaterialTheme.colorScheme.secondary)
    val grid = MaterialTheme.colorScheme.outlineVariant
    val prevColor = MaterialTheme.colorScheme.onSurfaceVariant
    val regIds = meter?.registers?.map { it.id } ?: emptyList()
    val max = buckets.maxOf { maxOf(it.total ?: 0.0, it.previousYearTotal ?: 0.0) }.coerceAtLeast(1.0)

    Column {
        Canvas(Modifier.fillMaxWidth().height(180.dp)) {
            val slot = size.width / buckets.size
            val barW = slot * 0.65f
            for (i in 0..3) {
                val y = size.height * i / 4
                drawLine(grid, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
            }
            buckets.forEachIndexed { i, b ->
                var top = size.height
                val est = b.registers.values.any { it.estimated || it.partial }
                regIds.forEachIndexed { ri, id ->
                    val v = b.registers[id]?.value ?: 0.0
                    val h = (v / max * size.height).toFloat()
                    top -= h
                    drawRect(
                        colors[ri % colors.size].copy(alpha = if (est) 0.45f else 1f),
                        topLeft = Offset(slot * i + (slot - barW) / 2, top),
                        size = Size(barW, h),
                    )
                }
                b.previousYearTotal?.let {
                    val y = (size.height - it / max * size.height).toFloat()
                    drawLine(prevColor, Offset(slot * i + 2, y), Offset(slot * (i + 1) - 2, y), strokeWidth = 4f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 4f)))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Text(buckets.first().label, style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
            Text("max. ${num(max, 0)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            Text(buckets.last().label, style = MaterialTheme.typography.labelSmall)
        }
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            meter?.registers?.forEachIndexed { i, r ->
                Legend(colors[i % colors.size], r.name)
            }
            Legend(prevColor, "Vorjahr")
        }
        if (buckets.any { b -> b.registers.values.any { it.estimated || it.partial } }) {
            Text("Blasse Balken sind geschätzt.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun Legend(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Canvas(Modifier.size(10.dp)) { drawRect(color) }
        Text(" $label", style = MaterialTheme.typography.labelSmall)
    }
}
