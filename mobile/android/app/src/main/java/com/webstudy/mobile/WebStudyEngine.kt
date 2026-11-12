package com.webstudy.mobile

import android.content.Context
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/**
 * Shared bridge to the embedded Python study engine.
 *
 * React Native and the foreground timer service must use the same Python
 * service instance. All calls are serialised on one executor.
 */
object WebStudyEngine {
    private val executor = Executors.newSingleThreadExecutor()
    @Volatile
    private var initialized = false

    /** Whether the React app is currently visible. */
    @Volatile
    var appForeground: Boolean = false

    fun dispatch(context: Context, method: String, payload: String = "{}"): String =
        executor.submit(Callable { dispatchBlocking(context, method, payload) }).get()

    fun dispatchAsync(
        context: Context,
        method: String,
        payload: String = "{}",
        callback: (Result<String>) -> Unit,
    ) {
        executor.execute {
            callback(runCatching { dispatchBlocking(context, method, payload) })
        }
    }

    private fun dispatchBlocking(context: Context, method: String, payload: String): String {
        ensureInitialized(context)
        val bridge = Python.getInstance().getModule("webstudy_bridge")
        return bridge.callAttr("dispatch", method, payload.ifBlank { "{}" }).toString()
    }

    private fun ensureInitialized(context: Context) {
        if (initialized) {
            return
        }
        synchronized(this) {
            if (initialized) {
                return
            }
            if (!Python.isStarted()) {
                Python.start(AndroidPlatform(context.applicationContext))
            }
            val bridge = Python.getInstance().getModule("webstudy_bridge")
            val home = File(context.filesDir, "webstudy")
            home.mkdirs()
            val envelope = bridge.callAttr("init", home.absolutePath).toString()
            val ok = runCatching { JSONObject(envelope).optBoolean("ok") }.getOrDefault(false)
            if (!ok) {
                throw IllegalStateException("Study engine initialization failed: $envelope")
            }
            val language = AppLanguage.current(context)
            bridge.callAttr(
                "dispatch",
                "setLanguage",
                JSONObject().put("language", language).toString(),
            )
            initialized = true
        }
    }
}
