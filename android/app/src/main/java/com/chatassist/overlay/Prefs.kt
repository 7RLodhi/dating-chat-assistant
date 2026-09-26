package com.chatassist.overlay

import android.content.Context

/** Tiny SharedPreferences wrapper. Backend URL points at your suggestion API. */
object Prefs {
    private const val FILE = "chat_assist_prefs"
    private const val KEY_BACKEND_URL = "backend_url"
    private const val KEY_TONE = "tone"

    const val DEFAULT_BACKEND_URL = "https://dhick-chick-chat.vercel.app/api/suggest"
    const val DEFAULT_TONE = "casual"

    fun backendUrl(ctx: Context): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_BACKEND_URL, DEFAULT_BACKEND_URL) ?: DEFAULT_BACKEND_URL

    fun setBackendUrl(ctx: Context, url: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_BACKEND_URL, url.trim()).apply()
    }

    fun tone(ctx: Context): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_TONE, DEFAULT_TONE) ?: DEFAULT_TONE

    fun setTone(ctx: Context, tone: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_TONE, tone).apply()
    }
}
