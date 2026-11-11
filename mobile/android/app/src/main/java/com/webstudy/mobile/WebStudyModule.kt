package com.webstudy.mobile

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

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
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun getPreference(key: String, promise: Promise) {
        val prefs = reactContext.getSharedPreferences("webstudy", 0)
        promise.resolve(prefs.getString(key, null))
    }

    @ReactMethod
    fun setPreference(key: String, value: String, promise: Promise) {
        val prefs = reactContext.getSharedPreferences("webstudy", 0)
        prefs.edit().putString(key, value).apply()
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
}
