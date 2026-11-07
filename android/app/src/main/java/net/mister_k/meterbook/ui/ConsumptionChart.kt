package net.mister_k.meterbook.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import net.mister_k.meterbook.data.Meter
import net.mister_k.meterbook.data.SeriesBucket
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow

/** Farben wie im Web (Mantine): je Zählwerk kräftig/hell im Wechsel der übergeordneten Periode */
private val HUES = listOf(
    Color(0xFF1C7ED6) to Color(0xFF74C0FC), // blau
    Color(0xFF0CA678) to Color(0xFF63E6BE), // türkis
    Color(0xFFAE3EC9) to Color(0xFFE599F7), // lila
    Color(0xFFF76707) to Color(0xFFFFC078), // orange
)
private val GRAY = Color(0xFF868E96)
private val GRAY_LIGHT = Color(0xFFCED4DA)

private val MONTHS = listOf("Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember")

/** Runde Schrittweite für die y-Achse (1, 2, 2,5, 5 × 10ⁿ) */
private fun niceStep(raw: Double): Double {
    if (raw <= 0) return 1.0
    val p = 10.0.pow(floor(log10(raw)))
    return listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * p }.first { it >= raw }
}

private fun shortLabel(label: String, granularity: String): String = when (granularity) {
    "day" -> label.substringBeforeLast('.').let { "$it." } // 06.11.2026 → 06.11.
    "week" -> label.substringBefore('/') // KW 45/2026 → KW 45
    else -> label
}

private data class AxisText(val text: String, val x: Float, val anchor: Int, val strong: Boolean) // anchor: -1 links, 0 mitte, 1 rechts

/**
 * Monatsachse wie im Web: Am Anfang jeder Abrechnungsperiode deren Name („2025“ bzw. „2025/26“),
 * am Ende der letzte Monat – soweit Platz ist.
 */
private fun monthAxis(buckets: List<SeriesBucket>, slot: Float, charW: Float): List<AxisText> {
    val out = mutableListOf<AxisText>()
    val pad = 4f
    val gap = 8f
    var i = 0
    while (i < buckets.size) {
        val period = buckets[i].period ?: buckets[i].start.take(4)
        var j = i
        while (j + 1 < buckets.size && (buckets[j + 1].period ?: buckets[j + 1].start.take(4)) == period) j++
        val left = i * slot
        val right = (j + 1) * slot
        val nameEnd = left + pad + period.length * charW
        val showName = nameEnd <= right
        if (showName) out += AxisText(period, left + pad, -1, true)
        if (j + 1 < buckets.size) {
            val monthIdx = java.time.Instant.parse(buckets[j].start).atZone(java.time.ZoneId.systemDefault()).monthValue - 1
            val last = MONTHS[monthIdx]
            val from = right - pad - last.length * charW
            if (from >= left && (!showName || nameEnd + gap <= from)) out += AxisText(last, right - pad, 1, false)
        }
        i = j + 1
    }
    return out
}

/** Übrige Einteilungen: Beschriftung mittig unter der Säule, ausgedünnt bis nichts überlappt */
private fun plainAxis(buckets: List<SeriesBucket>, granularity: String, slot: Float, charW: Float): List<AxisText> {
    val out = mutableListOf<AxisText>()
    var lastEnd = Float.NEGATIVE_INFINITY
    buckets.forEachIndexed { k, b ->
        // Tage: nur montags beschriften, damit die Wochen erkennbar sind
        if (granularity == "day" && java.time.Instant.parse(b.start).atZone(java.time.ZoneId.systemDefault()).dayOfWeek.value != 1) return@forEachIndexed
        val t = shortLabel(b.label, granularity)
        val w = t.length * charW
        val cx = k * slot + slot / 2
        val from = if (granularity == "day") k * slot else cx - w / 2
        if (from < lastEnd + 6f || from < 0f) return@forEachIndexed
        out += AxisText(t, if (granularity == "day") from else cx, if (granularity == "day") -1 else 0, false)
        lastEnd = from + w
    }
    return out
}

@Composable
fun ConsumptionChart(buckets: List<SeriesBucket>, meter: Meter?, granularity: String) {
    val regIds = meter?.registers?.map { it.id } ?: emptyList()
    val unit = meter?.unit ?: ""
    val decimals = if (unit == "m³") 2 else 1
    var selected by remember(buckets) { mutableStateOf<Int?>(null) }
    val measurer = rememberTextMeasurer()
    val axisStyle = TextStyle(fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val grid = MaterialTheme.colorScheme.outlineVariant
    val onSurface = MaterialTheme.colorScheme.onSurface

    val max = buckets.maxOf { maxOf(it.total ?: 0.0, it.previousYearTotal ?: 0.0, it.forecastTotal ?: 0.0) }
    val step = niceStep(max / 4)
    val top = (ceil(max / step) * step).coerceAtLeast(step)

    // Infozeile: angetippte Säule, sonst die laufende bzw. letzte
    val shown = buckets.getOrNull(selected ?: buckets.lastIndex)
    Column {
        shown?.let { b ->
            val est = b.registers.values.any { it.estimated || (it.partial && !b.current) }
            val main = if (b.current) {
                "bisher ${num(b.total ?: 0.0, decimals)} · Prognose ${num(b.forecastTotal, decimals)} $unit"
            } else {
                (if (est) "≈ " else "") + "${num(b.total, decimals)} $unit" +
                    if ((meter?.registers?.size ?: 0) > 1) {
                        meter!!.registers.joinToString(" · ", " (", ")") { r -> "${r.name} ${num(b.registers[r.id]?.value, decimals)}" }
                    } else ""
            }
            Text(b.label + (if (selected == null && b.current) " (laufend)" else ""), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(main, style = MaterialTheme.typography.titleSmall)
            Text(
                b.previousYearTotal?.let { "Vorjahr ${num(it, decimals)} $unit" } ?: " ",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Canvas(
            Modifier
                .fillMaxWidth()
                .height(220.dp)
                .padding(top = 8.dp)
                .pointerInput(buckets) {
                    detectTapGestures { pos ->
                        val axisW = 44.dp.toPx()
                        val slot = (size.width - axisW) / buckets.size
                        val k = ((pos.x - axisW) / slot).toInt()
                        selected = if (k in buckets.indices && k != selected) k else null
                    }
                },
        ) {
            val axisW = 44.dp.toPx()
            val bottomH = 18.dp.toPx()
            val plotH = size.height - bottomH
            val plotW = size.width - axisW
            val slot = plotW / buckets.size
            val barW = (slot * 0.72f).coerceAtMost(40.dp.toPx())
            val y = { v: Double -> (plotH - v / top * plotH).toFloat() }

            // y-Achse mit runden Werten
            var v = 0.0
            while (v <= top + 1e-9) {
                val yy = y(v)
                drawLine(grid, Offset(axisW, yy), Offset(size.width, yy), strokeWidth = 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
                val t = measurer.measure(num(v, if (step < 1) 2 else if (step < 10) 1 else 0), axisStyle)
                drawText(t, topLeft = Offset(axisW - t.size.width - 6.dp.toPx(), yy - t.size.height / 2))
                v += step
            }

            buckets.forEachIndexed { i, b ->
                val left = axisW + slot * i + (slot - barW) / 2
                if (b.current) {
                    // Laufende Periode: bisher grau, darüber hell gestrichelt bis zur Prognose
                    val soFar = b.total ?: 0.0
                    val f = maxOf(b.forecastTotal ?: soFar, soFar)
                    drawRect(GRAY, Offset(left, y(soFar)), Size(barW, plotH - y(soFar)))
                    if (f > soFar) {
                        drawRect(GRAY_LIGHT.copy(alpha = 0.5f), Offset(left, y(f)), Size(barW, y(soFar) - y(f)))
                        drawRect(GRAY, Offset(left, y(f)), Size(barW, y(soFar) - y(f)), style = Stroke(width = 1.5f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 4f))))
                    }
                } else {
                    val est = b.registers.values.any { it.estimated || it.partial }
                    var acc = 0.0
                    regIds.forEachIndexed { ri, id ->
                        val value = b.registers[id]?.value ?: 0.0
                        if (value <= 0) return@forEachIndexed
                        val (strong, light) = HUES[ri % HUES.size]
                        val c = (if (b.band == 1) light else strong).copy(alpha = if (est) 0.55f else 1f)
                        drawRect(c, Offset(left, y(acc + value)), Size(barW, y(acc) - y(acc + value)))
                        acc += value
                    }
                }
                if (i == selected) {
                    val h = maxOf(b.total ?: 0.0, b.forecastTotal ?: 0.0)
                    drawRect(onSurface, Offset(left - 2f, y(h) - 2f), Size(barW + 4f, plotH - y(h) + 2f), style = Stroke(width = 2f))
                }
            }

            // Vorjahr als gestrichelte Linie über die Säulenmitten
            var prev: Offset? = null
            buckets.forEachIndexed { i, b ->
                val p = b.previousYearTotal?.let { Offset(axisW + slot * i + slot / 2, y(it)) }
                if (p != null && prev != null) drawLine(GRAY, prev!!, p, strokeWidth = 2.5f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f)))
                p?.let { drawCircle(GRAY, 2.5f, it) }
                prev = p
            }

            // x-Achse
            val charW = 6.2.sp.toPx()
            val labels = if (granularity == "month") monthAxis(buckets, slot, charW) else plainAxis(buckets, granularity, slot, charW)
            for (k in 1 until buckets.size) {
                val boundary = if (granularity == "month") buckets[k].period != buckets[k - 1].period else buckets[k].band != buckets[k - 1].band
                if (boundary) {
                    val x = axisW + slot * k
                    drawLine(grid, Offset(x, plotH), Offset(x, plotH + bottomH * 0.8f), strokeWidth = 1.5f)
                }
            }
            labels.forEach { l ->
                val t = measurer.measure(l.text, if (l.strong) axisStyle.copy(fontWeight = FontWeight.SemiBold) else axisStyle)
                val x = axisW + l.x - when (l.anchor) { 1 -> t.size.width.toFloat(); 0 -> t.size.width / 2f; else -> 0f }
                drawText(t, topLeft = Offset(x.coerceIn(axisW, size.width - t.size.width), plotH + 3.dp.toPx()))
            }
        }

        // Legende
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            meter?.registers?.forEachIndexed { i, r -> LegendItem(HUES[i % HUES.size].first, if (meter.registers.size > 1) r.name else "Verbrauch") }
            if (buckets.any { it.previousYearTotal != null }) LegendItem(GRAY, "Vorjahr", line = true)
            if (buckets.any { it.current }) LegendItem(GRAY_LIGHT, "Prognose")
        }
        Text(
            "Säule antippen für Details." + if (buckets.any { b -> !b.current && b.registers.values.any { it.estimated || it.partial } }) " Blasse Säulen sind geschätzt." else "",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

@Composable
private fun LegendItem(color: Color, label: String, line: Boolean = false) {
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Canvas(Modifier.size(width = 12.dp, height = 10.dp)) {
            if (line) drawLine(color, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), strokeWidth = 4f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 3f)))
            else drawRect(color)
        }
        Text(" $label", style = MaterialTheme.typography.labelSmall)
    }
}
