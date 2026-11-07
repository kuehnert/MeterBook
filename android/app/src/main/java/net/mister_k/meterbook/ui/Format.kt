package net.mister_k.meterbook.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.Thermostat
import androidx.compose.material.icons.outlined.WaterDrop
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.vectorResource
import net.mister_k.meterbook.R
import net.mister_k.meterbook.data.Meter
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val DE = Locale.GERMANY

fun num(v: Double?, digits: Int = 1): String {
    if (v == null) return "–"
    val f = NumberFormat.getNumberInstance(DE)
    f.minimumFractionDigits = digits
    f.maximumFractionDigits = digits
    return f.format(v)
}

fun eur(v: Double?): String = if (v == null) "–" else NumberFormat.getCurrencyInstance(DE).format(v)

private val dateFmt = DateTimeFormatter.ofPattern("dd.MM.yyyy", DE)
private val dateTimeFmt = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm", DE)

fun date(iso: String?): String = iso?.let { dateFmt.format(Instant.parse(it).atZone(ZoneId.systemDefault())) } ?: "–"
/** Letzter Tag eines Zeitraums, dessen Ende (exklusiv) iso ist – z. B. 01.01.2027 → 31.12.2026 */
fun lastDay(endExclusive: String): String = dateFmt.format(Instant.parse(endExclusive).atZone(ZoneId.systemDefault()).minusDays(1))
fun dateTime(iso: String?): String = iso?.let { dateTimeFmt.format(Instant.parse(it).atZone(ZoneId.systemDefault())) } ?: "–"

fun daysAgo(n: Int?): String = when (n) {
    null -> "noch nie abgelesen"
    0 -> "heute abgelesen"
    1 -> "gestern abgelesen"
    else -> "vor $n Tagen abgelesen"
}

/** Symbol eines Zählers: eigenes Symbol, sonst das der Zählerart. */
@Composable
fun meterIcon(meter: Meter): ImageVector = when (meter.icon ?: meter.medium) {
    "HEATING" -> ImageVector.vectorResource(R.drawable.ic_radiator)
    else -> mediumIcon(meter.icon ?: meter.medium)
}

fun mediumIcon(medium: String): ImageVector = when (medium) {
    "ELECTRICITY" -> Icons.Outlined.Bolt
    "WATER" -> Icons.Outlined.WaterDrop
    "GAS" -> Icons.Outlined.LocalFireDepartment
    "HEAT" -> Icons.Outlined.Thermostat
    else -> Icons.Outlined.Speed
}

/** Liest eine Zahl mit deutschem Komma (29.789,6) oder Punkt (29789.6). */
fun parseNumber(s: String): Double? {
    var t = s.trim().replace(" ", "")
    if (t.isEmpty()) return null
    if (t.contains(',')) t = t.replace(".", "").replace(',', '.')
    return t.toDoubleOrNull()
}

/** Formatiert einen Wert für ein Eingabefeld (ohne Tausenderpunkte). */
fun inputValue(v: Double, decimals: Int): String = String.format(DE, "%.${decimals}f", v)
