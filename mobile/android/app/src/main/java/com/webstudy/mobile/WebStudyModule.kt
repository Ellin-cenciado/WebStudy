package com.webstudy.mobile

import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject

/**
 * JSON bridge to the embedded Python study engine and the background timer
 * service. Python calls are delegated to [WebStudyEngine] so the service and
 * React Native share one serialised runtime.
 */
@ReactModule(name = WebStudyModule.NAME)
class WebStudyModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "WebStudy"
        private const val TAG = "WebStudyBridge"
        private const val PREFS = "webstudy"
        private const val KEY_AWAY_ELAPSED = "timer.away.elapsed"
        private const val KEY_AWAY_DAY = "timer.away.logical_day"
        private const val KEY_AWAY_RUNNING = "timer.away.running"
        private const val KEY_AWAY_RECORDED_AT = "timer.away.recorded_at"
    }

    private val preferences
        get() = reactContext.getSharedPreferences(PREFS, 0)

    override fun getName(): String = NAME

    @ReactMethod
    fun getLocale(promise: Promise) {
        try {
            val locales = reactContext.resources.configuration.locales
            val tag = if (locales.isEmpty) "en" else locales[0].toLanguageTag()
            promise.resolve(tag)
        } catch (error: Throwable) {
            Log.e(TAG, "Could not read the system locale", error)
            promise.resolve("en")
        }
    }

    @ReactMethod
    fun getPreference(key: String, promise: Promise) {
        val prefs = reactContext.getSharedPreferences("webstudy", 0)
        promise.resolve(prefs.getString(key, null))
    }

    @ReactMethod
    fun setPreference(key: String, value: String, promise: Promise) {
        val prefs = reactContext.getSharedPreferences("webstudy", 0)
        prefs.edit().putString(key, value).apply()
        if (key == "language") {
            TimerNotifications.ensureChannels(reactContext)
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun dispatch(method: String, payload: String, promise: Promise) {
        WebStudyEngine.dispatchAsync(reactContext, method, payload) { result ->
            result.fold(
                onSuccess = { promise.resolve(it) },
                onFailure = { error ->
                    Log.e(TAG, "Python dispatch failed for $method", error)
                    promise.reject(
                        "webstudy_error",
                        error.message ?: "Python call failed",
                        error,
                    )
                },
            )
        }
    }

    @ReactMethod
    fun startTimerService(promise: Promise) {
        try {
            TimerService.start(reactContext)
            promise.resolve(null)
        } catch (error: Throwable) {
            Log.e(TAG, "Could not start the timer service", error)
            promise.reject(
                "timer_service_error",
                error.message ?: "Could not start the timer service",
                error,
            )
        }
    }

    @ReactMethod
    fun stopTimerService(promise: Promise) {
        try {
            TimerService.stop(reactContext)
            promise.resolve(null)
        } catch (error: Throwable) {
            Log.e(TAG, "Could not stop the timer service", error)
            promise.reject(
                "timer_service_error",
                error.message ?: "Could not stop the timer service",
                error,
            )
        }
    }

    @ReactMethod
    fun isTimerServiceRunning(promise: Promise) {
        promise.resolve(TimerService.isRunning)
    }

    @ReactMethod
    fun setTimerAppForeground(foreground: Boolean, promise: Promise) {
        WebStudyEngine.appForeground = foreground
        promise.resolve(null)
    }

    /**
     * Persist the state at the moment the UI leaves the foreground. If Android
     * later destroys the UI while the timer service keeps running, the next UI
     * launch can still report how much time was credited in between.
     */
    @ReactMethod
    fun recordAwayMarker(
        elapsedSeconds: Double,
        logicalDay: String,
        running: Boolean,
        promise: Promise,
    ) {
        try {
            preferences
                .edit()
                .putLong(KEY_AWAY_ELAPSED, elapsedSeconds.toLong())
                .putString(KEY_AWAY_DAY, logicalDay)
                .putBoolean(KEY_AWAY_RUNNING, running)
                .putLong(KEY_AWAY_RECORDED_AT, SystemClock.elapsedRealtime())
                .commit()
            promise.resolve(null)
        } catch (error: Throwable) {
            Log.e(TAG, "Could not record the away marker", error)
            promise.reject(
                "away_marker_error",
                error.message ?: "Could not record the away marker",
                error,
            )
        }
    }

    @ReactMethod
    fun takeAwayMarker(promise: Promise) {
        try {
            val recordedAt = preferences.getLong(KEY_AWAY_RECORDED_AT, -1L)
            if (recordedAt < 0L) {
                promise.resolve(null)
                return
            }
            val ageSeconds =
                (SystemClock.elapsedRealtime() - recordedAt).coerceAtLeast(0L) /
                    1000.0
            val payload =
                JSONObject()
                    .put("elapsedSeconds", preferences.getLong(KEY_AWAY_ELAPSED, 0L))
                    .put("logicalDay", preferences.getString(KEY_AWAY_DAY, "") ?: "")
                    .put("running", preferences.getBoolean(KEY_AWAY_RUNNING, false))
                    .put("ageSeconds", ageSeconds)
            clearAwayMarker()
            promise.resolve(payload.toString())
        } catch (error: Throwable) {
            Log.e(TAG, "Could not read the away marker", error)
            promise.reject(
                "away_marker_error",
                error.message ?: "Could not read the away marker",
                error,
            )
        }
    }

    @ReactMethod
    fun clearAwayMarker(promise: Promise) {
        try {
            clearAwayMarker()
            promise.resolve(null)
        } catch (error: Throwable) {
            Log.e(TAG, "Could not clear the away marker", error)
            promise.reject(
                "away_marker_error",
                error.message ?: "Could not clear the away marker",
                error,
            )
        }
    }

    private fun clearAwayMarker() {
        preferences
            .edit()
            .remove(KEY_AWAY_ELAPSED)
            .remove(KEY_AWAY_DAY)
            .remove(KEY_AWAY_RUNNING)
            .remove(KEY_AWAY_RECORDED_AT)
            .commit()
    }
}
