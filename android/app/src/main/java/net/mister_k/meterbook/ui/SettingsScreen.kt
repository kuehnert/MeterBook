package net.mister_k.meterbook.ui

import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import androidx.compose.material3.Switch
import net.mister_k.meterbook.BuildConfig
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.data.Health

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(app: MeterBookApp, onBack: () -> Unit) {
    val user by app.session.user.collectAsStateWithLifecycle()
    var reminder by remember { mutableStateOf(app.session.reminderDays) }
    var gallery by remember { mutableStateOf(app.session.saveToGallery) }
    var health by remember { mutableStateOf<Health?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { health = runCatching { app.api.health() }.getOrNull() }

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
                    Text(app.session.serverUrl + (health?.let { if (it.ocr) " · Erkennung aktiv" else " · Erkennung aus" } ?: " · nicht erreichbar"))
                },
            )
            ListItem(
                headlineContent = { Text("Version") },
                supportingContent = {
                    Column {
                        Text("App ${BuildConfig.VERSION_NAME} · Server ${health?.version ?: "–"}")
                        if (health != null && health!!.version != BuildConfig.VERSION_NAME) {
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
            Text(
                "Benachrichtigung, wenn ein Zähler so lange nicht abgelesen wurde.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            Spacer(Modifier.height(8.dp))
            val options = listOf(0 to "Aus", 7 to "Wöchentlich", 30 to "Monatlich")
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                options.forEachIndexed { i, (days, label) ->
                    SegmentedButton(
                        selected = reminder == days,
                        onClick = { reminder = days; app.session.reminderDays = days },
                        shape = SegmentedButtonDefaults.itemShape(i, options.size),
                    ) { Text(label) }
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 16.dp))
            Text(
                "Zähler, Tarife und Berichte verwaltest du im Web-Frontend unter ${app.session.serverUrl}.",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            Spacer(Modifier.height(24.dp))
            OutlinedButton(
                onClick = { scope.launch { app.repo.clear(); app.api.logout() } },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            ) { Text("Abmelden") }
        }
    }
}
