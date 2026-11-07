package net.mister_k.meterbook.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import net.mister_k.meterbook.BuildConfig
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.R

/** Projektseite von MeterBook (Teil von kuehnert.online) */
const val PROJECT_URL = "https://kuehnert.online"

/** Über MeterBook: Version, wer die App gebaut hat, Link zur Projektseite. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(app: MeterBookApp, onBack: () -> Unit) {
    val uri = LocalUriHandler.current
    val serverVersion by produceState<String?>(null) { value = runCatching { app.api.health().version }.getOrNull() }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Über MeterBook") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Zurück") } },
            )
        },
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Wie das App-Symbol: weißer Zähler auf blauem Kreis
            Image(
                painterResource(R.drawable.ic_launcher_foreground),
                null,
                Modifier.size(120.dp).clip(CircleShape).background(Color(0xFF2F6FB0)),
            )
            Text("MeterBook", style = MaterialTheme.typography.headlineMedium)
            Text(
                "App ${BuildConfig.VERSION_NAME}" + (serverVersion?.let { " · Server $it" } ?: ""),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "Zählerstände fotografieren und ablesen – Strom, Wasser, Gas und Wärme. Verbrauch, Kosten und Prognosen immer im Blick.",
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
            HorizontalDivider(Modifier.fillMaxWidth().padding(vertical = 8.dp))
            Text("Gebaut von", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Matthias Kühnert und Claude", style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(
                "Claude ist eine KI von Anthropic.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            HorizontalDivider(Modifier.fillMaxWidth().padding(vertical = 8.dp))
            Text("Mehr über MeterBook", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                PROJECT_URL.removePrefix("https://"),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
                textDecoration = TextDecoration.Underline,
                modifier = Modifier.clickable { runCatching { uri.openUri(PROJECT_URL) } },
            )
        }
    }
}
