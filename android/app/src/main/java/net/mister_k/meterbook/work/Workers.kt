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
