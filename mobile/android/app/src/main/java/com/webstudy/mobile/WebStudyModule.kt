package com.webstudy.mobile

import android.util.Log
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.util.concurrent.Executors

/**
 * JSON bridge to the embedded Python study engine.
 *
 * All Python calls run on a single executor so the service is only ever touched
 * by one thread. React Native receives the raw JSON envelope and parses it on
 * the JavaScript side.
 */
@ReactModule(name = WebStudyModule.NAME)
class WebStudyModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "WebStudy"
        private const val TAG = "WebStudyBridge"
    }

    private val executor = Executors.newSingleThreadExecutor()
    private var serviceReady = false

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
        executor.execute {
            try {
                val result = runDispatch(method, payload)
                promise.resolve(result)
            } catch (error: Throwable) {
                Log.e(TAG, "Python dispatch failed for $method", error)
                promise.reject("webstudy_error", error.message ?: "Python call failed", error)
            }
        }
    }

    private fun runDispatch(method: String, payload: String): String {
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(reactContext))
        }

        val bridge = Python.getInstance().getModule("webstudy_bridge")
        if (!serviceReady) {
            val home = File(reactContext.filesDir, "webstudy")
            home.mkdirs()
            bridge.callAttr("init", home.absolutePath).toString()
            serviceReady = true
        }

        val body = payload.ifBlank { "{}" }
        return bridge.callAttr("dispatch", method, body).toString()
    }

    override fun invalidate() {
        executor.shutdown()
        super.invalidate()
    }
}
