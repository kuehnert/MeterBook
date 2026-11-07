package net.mister_k.meterbook

import android.Manifest
import android.os.Build
import android.content.Intent
import android.os.Bundle
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import net.mister_k.meterbook.ui.AboutScreen
import net.mister_k.meterbook.ui.CaptureScreen
import net.mister_k.meterbook.ui.CaptureViewModel
import net.mister_k.meterbook.ui.HomeScreen
import net.mister_k.meterbook.ui.InboxScreen
import net.mister_k.meterbook.ui.LoginScreen
import net.mister_k.meterbook.ui.MeterScreen
import net.mister_k.meterbook.ui.ReviewScreen
import net.mister_k.meterbook.ui.SettingsScreen
import net.mister_k.meterbook.ui.theme.MeterBookTheme

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    /** Ziel aus einer Benachrichtigung, z. B. "inbox" */
    private val openTarget = MutableStateFlow<String?>(null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openTarget.value = intent.getStringExtra(EXTRA_OPEN)
    }

    companion object {
        const val EXTRA_OPEN = "open"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as MeterBookApp
        openTarget.value = intent?.getStringExtra(EXTRA_OPEN)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            MeterBookTheme {
                val user by app.session.user.collectAsStateWithLifecycle()
                if (user == null) {
                    LoginScreen(app)
                } else {
                    val nav = rememberNavController()
                    // Gemeinsamer Zustand für Eingang → Prüfen
                    val capture: CaptureViewModel = viewModel()
                    val target by openTarget.collectAsStateWithLifecycle()
                    LaunchedEffect(target) {
                        when (target) {
                            "inbox" -> nav.navigate("inbox") { launchSingleTop = true }
                            // „Ablesen“ aus der Erinnerung: Kamera mit automatischer Zählererkennung
                            "capture" -> nav.navigate("capture/auto") { launchSingleTop = true }
                        }
                        openTarget.value = null
                    }
                    NavHost(nav, startDestination = "home") {
                        composable("home") {
                            HomeScreen(
                                app,
                                onCapture = { nav.navigate("capture/$it") },
                                onCaptureAuto = { nav.navigate("capture/auto") },
                                onOpenMeter = { nav.navigate("meter/$it") },
                                onSettings = { nav.navigate("settings") },
                                onOpenInbox = { nav.navigate("inbox") },
                            )
                        }
                        composable("meter/{id}") { entry ->
                            MeterScreen(
                                app,
                                meterId = entry.arguments?.getString("id")!!,
                                onBack = { nav.popBackStack() },
                                onCapture = { nav.navigate("capture/$it") },
                            )
                        }
                        composable("capture/{id}") { entry ->
                            val id = entry.arguments?.getString("id")!!
                            CaptureScreen(
                                app,
                                meterId = id.takeIf { it != "auto" },
                                viewModel = capture,
                                onQueued = { if (!nav.popBackStack("home", inclusive = false)) nav.navigate("home") },
                                onManual = { nav.navigate("review") { popUpTo("capture/{id}") { inclusive = true } } },
                                onBack = { nav.popBackStack() },
                            )
                        }
                        composable("review") {
                            ReviewScreen(
                                app,
                                viewModel = capture,
                                onDone = { nav.popBackStack() },
                                onBack = { nav.popBackStack() },
                            )
                        }
                        composable("inbox") {
                            InboxScreen(
                                app,
                                onOpen = { item ->
                                    capture.openInbox(item)
                                    nav.navigate("review")
                                },
                                onCapture = { nav.navigate("capture/auto") },
                                onBack = { if (!nav.popBackStack()) nav.navigate("home") },
                            )
                        }
                        composable("settings") {
                            SettingsScreen(app, onBack = { nav.popBackStack() }, onAbout = { nav.navigate("about") })
                        }
                        composable("about") {
                            AboutScreen(app, onBack = { nav.popBackStack() })
                        }
                    }
                }
            }
        }
    }
}
