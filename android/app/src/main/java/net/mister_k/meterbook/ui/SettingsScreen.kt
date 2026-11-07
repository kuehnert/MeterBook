package net.mister_k.meterbook.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import androidx.compose.material3.Switch
import net.mister_k.meterbook.BuildConfig
import net.mister_k.meterbook.MeterBookApp
import androidx.compose.material3.TextButton
import net.mister_k.meterbook.data.Health
import net.mister_k.meterbook.data.ReminderSettingsIn
import net.mister_k.meterbook.data.ReminderState
import net.mister_k.meterbook.work.ReminderWorker
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** z. B. „Montag, 26. Oktober, 9 Uhr“ */
private fun reminderDate(iso: String): String {
    val d = Instant.parse(iso).atZone(ZoneId.systemDefault())
    val pattern = if (d.year == java.time.LocalDate.now().year) "EEEE, d. MMMM, H 'Uhr'" else "EEEE, d. MMMM yyyy, H 'Uhr'"
    return d.format(DateTimeFormatter.ofPattern(pattern, Locale.GERMAN))
}

/** kurz, z. B. „Mo., 9. Nov.“ (mit Jahr, wenn nicht im laufenden Jahr) */
private fun shortDate(iso: String): String {
    val d = Instant.parse(iso).atZone(ZoneId.systemDefault())
    val pattern = if (d.year == java.time.LocalDate.now().year) "EE, d. MMM" else "EE, d. MMM yyyy"
    return d.format(DateTimeFormatter.ofPattern(pattern, Locale.GERMAN))
}

private val INTERVALS = listOf("OFF" to "Aus", "WEEKLY" to "Wöchentlich", "MONTHLY" to "Monatlich", "QUARTERLY" to "Vierteljährlich", "YEARLY" to "Jährlich")
private fun intervalLabel(v: String?) = INTERVALS.firstOrNull { it.first == v }?.second ?: "–"

private val INTERVAL_HINT = mapOf(
    "OFF" to "Keine Erinnerung.",
    "WEEKLY" to "Jeden Montag um 9 Uhr.",
    "MONTHLY" to "Am 1. jedes Monats um 9 Uhr.",
    "QUARTERLY" to "Am 1. Januar, April, Juli und Oktober um 9 Uhr.",
    "YEARLY" to "Einmal im Jahr zum Abrechnungsbeginn des Zählers, 9 Uhr.",
)

/** Knopf mit Auswahlliste für einen Rhythmus; withDefault fügt „Standard (…)“ als null hinzu. */
@Composable
private fun IntervalPicker(value: String?, defaultLabel: String?, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, contentPadding = PaddingValues(horizontal = 12.dp)) {
            Text(if (value == null) "Standard" else intervalLabel(value), maxLines = 1)
            Icon(Icons.Outlined.ArrowDropDown, null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (defaultLabel != null) {
                DropdownMenuItem(text = { Text("Standard ($defaultLabel)") }, onClick = { open = false; onPick(null) })
            }
            INTERVALS.forEach { (key, label) ->
                DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onPick(key) })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(app: MeterBookApp, onBack: () -> Unit, onAbout: () -> Unit = {}) {
    val user by app.session.user.collectAsStateWithLifecycle()
    var reminder by remember { mutableStateOf<ReminderState?>(null) }
    var sticky by remember { mutableStateOf(app.session.reminderSticky) }
    var gallery by remember { mutableStateOf(app.session.saveToGallery) }
    var health by remember { mutableStateOf<Health?>(null) }
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    LaunchedEffect(Unit) {
        health = runCatching { app.api.health() }.getOrNull()
        reminder = runCatching { app.api.reminder() }.getOrNull()
    }

    /** Erinnerung auf dem Server ändern, danach die Benachrichtigung an den neuen Stand anpassen */
    fun changeReminder(call: suspend () -> ReminderState) {
        scope.launch {
            runCatching { call() }.onSuccess {
                reminder = it
                ReminderWorker.update(app, it)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Einstellungen") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Zurück") } },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp)) {
            ListItem(headlineContent = { Text(user?.name ?: "") }, supportingContent = { Text(user?.email ?: "") })
            ListItem(
                headlineContent = { Text("Server") },
                supportingContent = {
                    Column {
                        Text("Zähler, Tarife und Berichte verwalten:")
                        // Antippen öffnet das Web-Frontend im Browser
                        Text(
                            app.session.serverUrl,
                            color = MaterialTheme.colorScheme.primary,
                            textDecoration = TextDecoration.Underline,
                            modifier = Modifier.clickable {
                                runCatching { uriHandler.openUri(app.session.serverUrl) }
                            },
                        )
                        Text(health?.let { if (it.ocr) "Erkennung aktiv" else "Erkennung aus" } ?: "nicht erreichbar")
                    }
                },
            )
            ListItem(
                headlineContent = { Text("Version") },
                supportingContent = {
                    Column {
                        Text("App ${BuildConfig.VERSION_NAME} · Server ${health?.version ?: "–"}")
                        // Die Dev-App heißt z. B. „0.3.1-dev“ – die Endung zählt beim Vergleich nicht
                        if (health != null && health!!.version != BuildConfig.VERSION_NAME.removeSuffix("-dev")) {
                            Text(
                                "App und Server haben unterschiedliche Versionen – am besten beide aktualisieren.",
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                },
            )
            ListItem(
                headlineContent = { Text("Fotos in der Galerie speichern") },
                supportingContent = { Text("Kopie unter Bilder/MeterBook") },
                trailingContent = { Switch(checked = gallery, onCheckedChange = { gallery = it; app.session.saveToGallery = it }) },
            )
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text("Erinnerung ans Ablesen", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 16.dp))
            val r = reminder
            if (r == null) {
                Text(
                    "Nur mit Verbindung zum Server einstellbar.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            } else {
                ListItem(
                    headlineContent = { Text("Standard für alle Zähler") },
                    supportingContent = { Text(INTERVAL_HINT[r.interval] ?: "") },
                    trailingContent = {
                        IntervalPicker(r.interval, null) { v -> changeReminder { app.api.updateReminder(ReminderSettingsIn(interval = v)) } }
                    },
                )
                Text(
                    "Je Zähler",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, top = 4.dp),
                )
                r.meters.forEach { m ->
                    ListItem(
                        headlineContent = { Text(m.name) },
                        supportingContent = { Text(m.next?.let { "Nächster Termin: ${shortDate(it)}" } ?: "Keine Erinnerung") },
                        trailingContent = {
                            IntervalPicker(m.interval, intervalLabel(r.interval)) { v -> changeReminder { app.api.setMeterReminder(m.id, v) } }
                        },
                    )
                }
                if (r.enabled) {
                    ListItem(
                        headlineContent = { Text("Auch per E-Mail") },
                        supportingContent = { Text(if (health?.mail == "smtp") "Eine E-Mail je Termin" else "Auf dem Server ist kein E-Mail-Versand eingerichtet") },
                        trailingContent = {
                            Switch(checked = r.email, onCheckedChange = { on -> changeReminder { app.api.updateReminder(ReminderSettingsIn(email = on)) } })
                        },
                    )
                    ListItem(
                        headlineContent = { Text("Benachrichtigung anheften") },
                        supportingContent = { Text("Bleibt stehen, bis alles abgelesen ist. Sonst täglich neu, bis abgelesen.") },
                        trailingContent = {
                            Switch(checked = sticky, onCheckedChange = {
                                sticky = it
                                app.session.reminderSticky = it
                                ReminderWorker.checkNow(app, force = true)
                            })
                        },
                    )
                    r.next?.let { next ->
                        val skippingNext = r.skipUntil != null && r.skipUntil >= next
                        ListItem(
                            headlineContent = { Text("Nächste Erinnerung") },
                            supportingContent = { Text(reminderDate(next) + if (skippingNext) " · wird übersprungen" else "") },
                            trailingContent = {
                                if (skippingNext || (r.skipped && !r.active)) {
                                    TextButton(onClick = { changeReminder { app.api.skipReminder("none") } }) { Text("Doch erinnern") }
                                } else {
                                    TextButton(onClick = { changeReminder { app.api.skipReminder("next") } }) { Text("Überspringen") }
                                }
                            },
                        )
                    }
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 16.dp))
            ListItem(
                headlineContent = { Text("Über MeterBook") },
                supportingContent = { Text("Version, wer die App gebaut hat, Projektseite") },
                modifier = Modifier.clickable(onClick = onAbout),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { scope.launch { app.repo.clear(); app.photoInbox.clear(); app.api.logout() } },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            ) { Text("Abmelden") }
        }
    }
}
