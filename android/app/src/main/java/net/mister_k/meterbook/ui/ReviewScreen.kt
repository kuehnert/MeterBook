package net.mister_k.meterbook.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.Meter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewScreen(
    app: MeterBookApp,
    viewModel: CaptureViewModel,
    onDone: () -> Unit,
    onRetake: (String?) -> Unit,
    onBack: () -> Unit,
) {
    val s by viewModel.state.collectAsStateWithLifecycle()
    val meters = remember { app.repo.cachedOverview()?.map { it.meter }.orEmpty() }
    val meter = s.meterId?.let { id -> meters.firstOrNull { it.id == id } }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(meter?.name ?: "Ablesung") },
                navigationIcon = {
                    IconButton(onClick = { viewModel.discard(); onBack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Zurück") }
                },
            )
        },
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            s.photo?.let { file ->
                val boxes = s.ocr?.registers?.mapNotNull { it.box?.takeIf { b -> b.size == 4 } }.orEmpty()
                DigitsPreview(file, boxes)
            }
            if (s.uploading) {
                Column {
                    Text(if (s.meterId == null) "Zähler und Stand werden erkannt …" else "Stand wird erkannt …", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(6.dp))
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            }

            MeterPicker(meters, meter, enabled = !s.uploading, autoAssigned = s.autoAssigned, onSelect = viewModel::selectMeter)

            if (s.offline) Hint(Icons.Outlined.CloudOff, "Kein Netz – bitte den Stand selbst eintragen. Foto und Werte werden gesendet, sobald wieder Verbindung besteht.")
            if (!s.uploading && s.meterId == null && s.photoId != null) {
                Hint(Icons.Outlined.WarningAmber, "Der Zähler wurde nicht erkannt – bitte oben auswählen.", warn = true)
            }
            s.ocr?.let { ocr ->
                if (s.meterId != null) Hint(Icons.Outlined.AutoAwesome, "Automatisch erkannt – bitte mit dem Ausschnitt vergleichen.")
                if (ocr.serialNumberMatches == false) {
                    Hint(Icons.Outlined.WarningAmber, "Auf dem Foto steht die Zählernummer ${ocr.serialNumberSeen}, erwartet ${meter?.serialNumber}. Richtiger Zähler?", warn = true)
                }
                if (ocr.issues.isNotEmpty()) Text(ocr.issues.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            s.ocrError?.let { Hint(Icons.Outlined.WarningAmber, "Erkennung nicht möglich: $it", warn = true) }

            meter?.registers?.forEachIndexed { i, r ->
                val ocr = s.ocr?.registers?.firstOrNull { it.registerId == r.id }
                val warnings = s.warnings.firstOrNull { it.registerId == r.id }?.warnings.orEmpty()
                OutlinedTextField(
                    value = s.inputs[r.id] ?: "",
                    onValueChange = { viewModel.setInput(r.id, it.filter { c -> c.isDigit() || c == ',' || c == '.' }) },
                    label = { Text(if (meter.registers.size > 1) "Zählwerk ${r.name}" else "Zählerstand") },
                    suffix = { Text(meter.unit) },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.headlineSmall,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Decimal,
                        imeAction = if (i == meter.registers.lastIndex) ImeAction.Done else ImeAction.Next,
                    ),
                    isError = warnings.isNotEmpty(),
                    supportingText = {
                        Column {
                            val parts = listOfNotNull(
                                r.lastReading?.let { "Zuletzt ${num(it.value, r.decimals)} ${meter.unit} am ${date(it.readAt)}" },
                                ocr?.let { "erkannt „${it.digits}“ · Sicherheit ${(it.confidence * 100).toInt()} %" },
                            )
                            if (parts.isNotEmpty()) Text(parts.joinToString("\n"))
                            if (ocr != null && ocr.confidence < 0.6) {
                                Text("Unsicher erkannt – bitte Ziffern mit dem Foto vergleichen", color = MaterialTheme.colorScheme.tertiary)
                            }
                            warnings.forEach { Text(it.message, color = MaterialTheme.colorScheme.error) }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            if (meter != null) {
                OutlinedTextField(s.note, viewModel::setNote, Modifier.fillMaxWidth(), label = { Text("Notiz (optional)") }, singleLine = true)
                Text("Abgelesen am ${dateTime(s.takenAt.toString())}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            s.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (s.photo != null) {
                    OutlinedButton(onClick = { val id = s.meterId.takeIf { !s.autoAssigned }; viewModel.discard(); onRetake(id) }, Modifier.weight(1f).height(52.dp)) {
                        Icon(Icons.Outlined.CameraAlt, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Neu")
                    }
                }
                Button(
                    onClick = {
                        scope.launch {
                            when (viewModel.save()) {
                                SaveOutcome.Saved -> { Toast.makeText(context, "Ablesung gespeichert", Toast.LENGTH_SHORT).show(); onDone() }
                                SaveOutcome.Queued -> { Toast.makeText(context, "Gespeichert – wird gesendet, sobald Netz da ist", Toast.LENGTH_LONG).show(); onDone() }
                                null -> {}
                            }
                        }
                    },
                    enabled = !s.uploading && !s.saving && meter != null,
                    modifier = Modifier.weight(2f).height(52.dp),
                ) {
                    if (s.saving) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
                    else Text(if (s.warnings.any { it.warnings.isNotEmpty() }) "Trotzdem speichern" else "Speichern")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MeterPicker(meters: List<Meter>, selected: Meter?, enabled: Boolean, autoAssigned: Boolean, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { if (enabled) open = it }) {
        OutlinedTextField(
            value = selected?.name ?: "",
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(if (autoAssigned) "Zähler (automatisch erkannt)" else "Zähler") },
            placeholder = { Text("Bitte wählen") },
            leadingIcon = selected?.let { { Icon(meterIcon(it), null) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            meters.forEach { m ->
                DropdownMenuItem(
                    text = { Text(m.name) },
                    leadingIcon = { Icon(meterIcon(m), null) },
                    onClick = { open = false; onSelect(m.id) },
                )
            }
        }
    }
}

@Composable
private fun Hint(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, warn: Boolean = false) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (warn) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer,
        ),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
