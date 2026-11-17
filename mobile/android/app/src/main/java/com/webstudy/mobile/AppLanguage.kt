package com.webstudy.mobile

import android.content.Context

/**
 * Resolves the language chosen in the app settings. Shared by the foreground
 * service and notification builders, which cannot read React state.
 */
object AppLanguage {
    private const val PREFS = "webstudy"
    private const val KEY = "language"

    fun current(context: Context): String {
        val stored = context.getSharedPreferences(PREFS, 0).getString(KEY, null)
        if (stored == "es" || stored == "en") {
            return stored
        }
        val locales = context.resources.configuration.locales
        val language = if (locales.isEmpty) "en" else locales[0].language
        return if (language == "es") "es" else "en"
    }

    fun isSpanish(context: Context): Boolean = current(context) == "es"
}
