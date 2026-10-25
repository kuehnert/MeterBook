package net.mister_k.meterbook.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import net.mister_k.meterbook.MainActivity
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.R
import net.mister_k.meterbook.data.ReminderSettingsIn
import net.mister_k.meterbook.data.ReminderState
import java.time.LocalDate
import java.time.LocalTime
import java.util.concurrent.TimeUnit

/**
 * Erinnerung ans Ablesen. Termine und „fällig“ bestimmt der Server (montags bzw. am 1. um 9 Uhr).
 * Die App prüft stündlich: Ist eine Erinnerung offen, steht eine Benachrichtigung da – angeheftet,
 * bis alle Zähler abgelesen sind, und täglich neu, falls sie weggewischt wurde. Mit dem Ablesen,
 * dem Überspringen oder dem nächsten Termin verschwindet sie.
 */
class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as MeterBookApp
        if (app.session.user.value == null) {
            cancel(applicationContext)
            return Result.success()
        }
        val state = try {
            migrate(app) ?: app.api.reminder()
        } catch (_: Exception) {
            return Result.success()
        }
        update(app, state, force = inputData.getBoolean(KEY_FORCE, false))
        return Result.success()
    }

    /** Bis 0.2 lag die Einstellung nur auf dem Gerät – einmalig auf den Server übernehmen. */
    private suspend fun migrate(app: MeterBookApp): ReminderState? {
        if (app.session.reminderMigrated) return null
        val current = app.api.reminder()
        val interval = when (app.session.legacyReminderDays) {
            7 -> "WEEKLY"
            30 -> "MONTHLY"
            else -> null
        }
        val result = if (current.interval == "OFF" && interval != null) app.api.updateReminder(ReminderSettingsIn(interval = interval)) else current
        app.session.reminderMigrated = true
        return result
    }

    companion object {
        const val CHANNEL = "reminders"
        private const val NOTIFICATION_ID = 1
        private const val KEY_FORCE = "force"

        fun createChannel(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Erinnerungen ans Ablesen", NotificationManager.IMPORTANCE_DEFAULT))
        }

        /** Stündlich prüfen – so erscheint die Erinnerung kurz nach 9 Uhr und verschwindet nach dem Ablesen. */
        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<ReminderWorker>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("reminder", ExistingPeriodicWorkPolicy.UPDATE, req)
        }

        /** Sofort prüfen, z. B. nach dem Ablesen oder nach geänderten Einstellungen. */
        fun checkNow(context: Context, force: Boolean = false) {
            val req = OneTimeWorkRequestBuilder<ReminderWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(workDataOf(KEY_FORCE to force))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("reminder-now", ExistingWorkPolicy.REPLACE, req)
        }

        fun cancel(context: Context) = NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)

        /** Benachrichtigung passend zum Stand zeigen, aktualisieren oder entfernen. */
        fun update(app: MeterBookApp, state: ReminderState, force: Boolean = false) {
            val context: Context = app
            if (!state.active) {
                cancel(context)
                return
            }
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val nm = context.getSystemService(NotificationManager::class.java)
            val showing = nm.activeNotifications.any { it.id == NOTIFICATION_ID }
            val today = LocalDate.now().toString()
            val newPeriod = app.session.reminderShownFor != state.current
            // Weggewischt? Dann am nächsten Tag ab 9 Uhr erneut
            val daily = app.session.reminderShownDay != today && LocalTime.now().hour >= 9
            if (!showing && !newPeriod && !daily && !force) return

            val sticky = app.session.reminderSticky
            val names = state.due.map { it.name }
            val open = PendingIntent.getActivity(
                context, 10,
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val capture = PendingIntent.getActivity(
                context, 11,
                Intent(context, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_OPEN, "capture")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val skip = PendingIntent.getBroadcast(
                context, 12,
                Intent(context, ReminderSkipReceiver::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Zeit zum Ablesen")
                .setContentText(names.joinToString(", "))
                .setStyle(NotificationCompat.BigTextStyle().bigText(names.joinToString("\n")))
                .setContentIntent(open)
                .addAction(0, "Ablesen", capture)
                .addAction(0, "Überspringen", skip)
                .setOngoing(sticky)
                .setAutoCancel(!sticky)
                // Nur beim ersten Erscheinen am Tag Ton/Vibration, Aktualisierungen bleiben still
                .setOnlyAlertOnce(true)
                .build()
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, n)
            if (!showing) {
                app.session.reminderShownFor = state.current
                app.session.reminderShownDay = today
            }
        }
    }
}

/** „Überspringen“ in der Benachrichtigung: sofort ausblenden, den Termin auf dem Server überspringen. */
class ReminderSkipReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        ReminderWorker.cancel(context)
        val req = OneTimeWorkRequestBuilder<ReminderSkipWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("reminder-skip", ExistingWorkPolicy.REPLACE, req)
    }
}

class ReminderSkipWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as MeterBookApp
        if (app.session.user.value == null) return Result.success()
        return try {
            ReminderWorker.update(app, app.api.skipReminder("current"))
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
