package com.webstudy.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/** Notification channels and builders for the background study timer. */
object TimerNotifications {
    const val CHANNEL_ONGOING = "study_timer_ongoing"
    const val CHANNEL_ALERTS = "study_timer_alerts"
    const val ONGOING_ID = 4101

    private val alertSequence = AtomicInteger(4200)

    private fun tr(context: Context, english: String, spanish: String): String =
        if (AppLanguage.isSpanish(context)) spanish else english

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val ongoing =
            NotificationChannel(
                CHANNEL_ONGOING,
                tr(context, "Study timer", "Cronómetro de estudio"),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description =
                    tr(
                        context,
                        "Ongoing timer while a study session runs in the background",
                        "Cronómetro visible mientras corre una sesión en segundo plano",
                    )
                setShowBadge(false)
                enableVibration(false)
                setSound(null, null)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        val alerts =
            NotificationChannel(
                CHANNEL_ALERTS,
                tr(context, "Study alerts", "Avisos de estudio"),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description =
                    tr(
                        context,
                        "Phase changes, rest, item expiry, and day completion",
                        "Cambios de fase, descansos, fin de tiempo y día completo",
                    )
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        manager.createNotificationChannels(listOf(ongoing, alerts))
    }

    fun starting(context: Context): Notification =
        baseBuilder(context, CHANNEL_ONGOING)
            .setContentTitle(tr(context, "Study timer", "Cronómetro de estudio"))
            .setContentText(
                tr(
                    context,
                    "Starting the background timer…",
                    "Iniciando el cronómetro en segundo plano…",
                ),
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp(context))
            .build()

    fun updateOngoing(context: Context, payload: JSONObject) {
        val running = payload.optBoolean("running", false)
        val remaining = payload.optLong("remaining_seconds", 0L)
        val title =
            payload.optString(
                "title",
                tr(context, "Study timer", "Cronómetro de estudio"),
            )
        val body = payload.optString("body", "")
        val builder =
            baseBuilder(context, CHANNEL_ONGOING)
                .setContentTitle(title)
                .setContentText(body)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openApp(context))

        if (running && remaining > 0) {
            builder
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setWhen(System.currentTimeMillis() + remaining * 1000L)
        } else {
            builder.setUsesChronometer(false).setShowWhen(false)
        }

        if (running) {
            builder.addAction(
                android.R.drawable.ic_media_pause,
                tr(context, "Pause", "Pausar"),
                serviceAction(context, TimerService.ACTION_PAUSE, 1),
            )
            builder.addAction(
                android.R.drawable.ic_media_next,
                tr(context, "Skip", "Saltar"),
                serviceAction(context, TimerService.ACTION_SKIP, 2),
            )
        }

        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(ONGOING_ID, builder.build())
    }

    fun updateOngoingError(context: Context) {
        val builder =
            baseBuilder(context, CHANNEL_ONGOING)
                .setContentTitle(tr(context, "Study timer", "Cronómetro de estudio"))
                .setContentText(
                    tr(
                        context,
                        "Reconnecting to the study engine…",
                        "Reconectando con el motor de estudio…",
                    ),
                )
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openApp(context))
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(ONGOING_ID, builder.build())
    }

    fun postAlert(context: Context, summary: String, body: String, urgent: Boolean) {
        if (summary.isBlank() && body.isBlank()) {
            return
        }
        val builder =
            baseBuilder(context, CHANNEL_ALERTS)
                .setContentTitle(
                    summary.ifBlank {
                        tr(context, "Study alert", "Aviso de estudio")
                    },
                )
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setCategory(
                    if (urgent) {
                        NotificationCompat.CATEGORY_ALARM
                    } else {
                        NotificationCompat.CATEGORY_REMINDER
                    },
                )
                .setPriority(
                    if (urgent) {
                        NotificationCompat.PRIORITY_HIGH
                    } else {
                        NotificationCompat.PRIORITY_DEFAULT
                    },
                )
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openApp(context))
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(alertSequence.incrementAndGet(), builder.build())
    }

    fun cancelOngoing(context: Context) {
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(ONGOING_ID)
    }

    private fun baseBuilder(context: Context, channel: String): NotificationCompat.Builder =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_study)
            .setColor(0xFF4F46E5.toInt())

    private fun openApp(context: Context): PendingIntent {
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        return PendingIntent.getActivity(
            context,
            3,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun serviceAction(context: Context, action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, TimerService::class.java).setAction(action)
        return PendingIntent.getService(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
