package net.mister_k.meterbook.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import net.mister_k.meterbook.MainActivity
import net.mister_k.meterbook.MeterBookApp
import net.mister_k.meterbook.R
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.delay
import net.mister_k.meterbook.data.InboxItem

/** Lädt offline erfasste Ablesungen hoch, sobald Netz da ist. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as MeterBookApp
        if (app.session.user.value == null) return Result.success()
        return if (app.queue.flush()) Result.success() else Result.retry()
    }

    companion object {
        fun enqueue(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("sync", ExistingWorkPolicy.REPLACE, req)
        }
    }
}

/** Erinnert ans Ablesen, wenn ein Zähler länger nicht abgelesen wurde. */
class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as MeterBookApp
        val days = app.session.reminderDays
        if (days == 0 || app.session.user.value == null) return Result.success()
        val due = try {
            app.api.overview().filter { (it.daysSinceLastReading ?: Int.MAX_VALUE) >= days }.map { it.meter.name }
        } catch (_: Exception) {
            return Result.success()
        }
        if (due.isNotEmpty()) notify(applicationContext, due)
        return Result.success()
    }

    private fun notify(context: Context, meters: List<String>) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val intent = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Zeit zum Ablesen")
            .setContentText(meters.joinToString(", "))
            .setContentIntent(intent)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(1, n)
    }

    companion object {
        const val CHANNEL = "reminders"

        fun createChannel(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Erinnerungen ans Ablesen", NotificationManager.IMPORTANCE_DEFAULT))
        }

        /** Prüft einmal täglich, ob eine Erinnerung fällig ist. */
        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<ReminderWorker>(1, TimeUnit.DAYS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("reminder", ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}

/**
 * Lädt Fotos aus dem Eingang hoch, sobald Netz da ist, wartet auf die Erkennung auf dem Server
 * und meldet per Benachrichtigung, wenn Fotos zum Prüfen bereitliegen.
 */
class PhotoWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as MeterBookApp
        if (app.session.user.value == null) return Result.success()
        val (uploaded, reachable) = app.photoInbox.upload()
        if (!reachable) return Result.retry()

        // Auf die Erkennung warten (meist 10–30 s je Foto), höchstens einige Minuten
        val watch = uploaded.toMutableSet()
        val ready = mutableListOf<InboxItem>()
        val deadline = System.currentTimeMillis() + 5 * 60_000
        while (watch.isNotEmpty() && System.currentTimeMillis() < deadline) {
            delay(4_000)
            val items = try {
                app.photoInbox.refresh()
            } catch (_: Exception) {
                break
            }
            for (it in items.filter { i -> i.photoId in watch && i.ocrStatus != "PENDING" }) {
                ready += it
                watch -= it.photoId
            }
            // Foto inzwischen bearbeitet oder verworfen
            watch.retainAll(items.map { it.photoId }.toSet())
        }
        if (ready.isNotEmpty()) notifyReady(app, ready)
        return Result.success()
    }

    private fun notifyReady(app: MeterBookApp, ready: List<InboxItem>) {
        val context = applicationContext
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val names = ready.map { item -> app.repo.meter(item.meterId ?: "")?.name ?: "Zähler unbekannt" }.distinct()
        val total = app.photoInbox.server.value.count { it.ocrStatus != "PENDING" }
        val intent = PendingIntent.getActivity(
            context, 2,
            Intent(context, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN, "inbox")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (total == 1) "1 Foto zum Prüfen" else "$total Fotos zum Prüfen")
            .setContentText("Erkannt: ${names.joinToString(", ")}")
            .setContentIntent(intent)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(2, n)
    }

    companion object {
        const val CHANNEL = "inbox"

        fun createChannel(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Fotos zum Prüfen", NotificationManager.IMPORTANCE_HIGH))
        }

        fun enqueue(context: Context) {
            val req = OneTimeWorkRequestBuilder<PhotoWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            // Läuft schon einer, hängt der neue sich an – so geht kein Foto verloren
            WorkManager.getInstance(context).enqueueUniqueWork("photos", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }
    }
}
