package com.webstudy.mobile

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import org.json.JSONObject

/**
 * Foreground service that keeps the embedded study engine ticking while the
 * app is backgrounded or the screen is locked.
 */
class TimerService : Service() {

    companion object {
        const val ACTION_START = "com.webstudy.mobile.action.START_TIMER"
        const val ACTION_STOP = "com.webstudy.mobile.action.STOP_TIMER"
        const val ACTION_PAUSE = "com.webstudy.mobile.action.PAUSE_TIMER"
        const val ACTION_SKIP = "com.webstudy.mobile.action.SKIP_PHASE"
        const val ACTION_REFRESH = "com.webstudy.mobile.action.REFRESH_TIMER"

        private const val TAG = "WebStudyTimer"
        private const val TICK_MS = 5_000L
        private const val WAKE_LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1000L

        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(context: Context) {
            val intent = Intent(context, TimerService::class.java).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TimerService::class.java))
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private val ticker =
        object : Runnable {
            override fun run() {
                if (!isRunning) {
                    return
                }
                acquireWakeLock()
                refresh()
                handler.postDelayed(this, TICK_MS)
            }
        }

    override fun onCreate() {
        super.onCreate()
        TimerNotifications.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        if (action == ACTION_STOP) {
            stopTimer()
            return START_NOT_STICKY
        }
        if (!isRunning) {
            isRunning = true
            startForegroundCompat(TimerNotifications.starting(this))
            acquireWakeLock()
        }
        when (action) {
            ACTION_PAUSE -> {
                handlePause()
                return START_NOT_STICKY
            }
            ACTION_SKIP -> {
                handleSkip()
                return START_STICKY
            }
            else -> startTimer()
        }
        return START_STICKY
    }

    private fun startTimer() {
        handler.removeCallbacks(ticker)
        handler.post(ticker)
    }

    private fun refresh() {
        val foreground = WebStudyEngine.appForeground
        val payload = if (foreground) """{"drainEvents":false}""" else "{}"
        WebStudyEngine.dispatchAsync(applicationContext, "poll", payload) { result ->
            handler.post {
                if (!isRunning) {
                    return@post
                }
                result.fold(
                    onSuccess = { applyPayload(it) },
                    onFailure = { error ->
                        Log.e(TAG, "Timer poll failed", error)
                        TimerNotifications.updateOngoingError(this)
                    },
                )
            }
        }
    }

    private fun applyPayload(raw: String) {
        val envelope = runCatching { JSONObject(raw) }.getOrNull() ?: return
        if (!envelope.optBoolean("ok")) {
            return
        }
        val data = envelope.optJSONObject("data") ?: return
        val notification = data.optJSONObject("notification") ?: return
        val notificationsEnabled = notification.optBoolean("notifications_enabled", true)
        val events = data.optJSONArray("events")
        if (notificationsEnabled && !WebStudyEngine.appForeground && events != null) {
            for (index in 0 until events.length()) {
                val event = events.optJSONObject(index) ?: continue
                TimerNotifications.postAlert(
                    this,
                    event.optString("summary"),
                    event.optString("body"),
                    event.optBoolean("urgent", false),
                )
            }
        }
        val running = notification.optBoolean("running", false)
        val dayComplete = notification.optBoolean("day_complete", false)
        val freeDay = notification.optBoolean("is_free_day", false)
        if (!running || dayComplete || freeDay) {
            stopTimer()
            return
        }
        TimerNotifications.updateOngoing(this, notification)
    }

    private fun handlePause() {
        WebStudyEngine.dispatchAsync(applicationContext, "pause") { result ->
            handler.post {
                result.fold(
                    onSuccess = { stopTimer() },
                    onFailure = { error ->
                        Log.e(TAG, "Timer pause failed", error)
                        TimerNotifications.postAlert(
                            this,
                            "Could not pause the timer",
                            error.message ?: "Open WebStudy and try again.",
                            true,
                        )
                        startTimer()
                    },
                )
            }
        }
    }

    private fun handleSkip() {
        WebStudyEngine.dispatchAsync(applicationContext, "skipPhase") { result ->
            handler.post {
                result.fold(
                    onSuccess = { applyPayload(it) },
                    onFailure = { error ->
                        Log.e(TAG, "Timer skip failed", error)
                        TimerNotifications.postAlert(
                            this,
                            "Could not skip the phase",
                            error.message ?: "Open WebStudy and try again.",
                            true,
                        )
                        startTimer()
                    },
                )
            }
        }
    }

    private fun stopTimer() {
        isRunning = false
        handler.removeCallbacks(ticker)
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                TimerNotifications.ONGOING_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(TimerNotifications.ONGOING_ID, notification)
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) {
            return
        }
        val manager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock =
            manager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "WebStudy::StudyTimer",
            ).apply {
                setReferenceCounted(false)
                acquire(WAKE_LOCK_TIMEOUT_MS)
            }
    }

    private fun releaseWakeLock() {
        val lock = wakeLock ?: return
        if (lock.isHeld) {
            lock.release()
        }
        wakeLock = null
    }

    override fun onDestroy() {
        isRunning = false
        handler.removeCallbacks(ticker)
        releaseWakeLock()
        TimerNotifications.cancelOngoing(this)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
