package com.chatassist.overlay

import android.content.Context

/** Tiny SharedPreferences wrapper. Backend URL points at your suggestion API. */
object Prefs {
    private const val FILE = "chat_assist_prefs"
    private const val KEY_BACKEND_URL = "backend_url"
    private const val KEY_TONE = "tone"
    private const val KEY_ICON_STYLE = "icon_style"
    private const val KEY_BUBBLE_SIZE = "bubble_size_dp"
    private const val KEY_TRANSPARENCY = "transparency_pct"
    private const val KEY_CUSTOM_ICON_URI = "custom_icon_uri"

    const val DEFAULT_BACKEND_URL = "https://dhick-chick-chat.vercel.app/api/suggest"
    const val DEFAULT_TONE = "casual"

    /** Bubble icon: "initials" (CA), "chat" (💬), "dot" (plain), "custom" (gallery image). */
    const val DEFAULT_ICON_STYLE = "initials"
    const val DEFAULT_BUBBLE_SIZE_DP = 56
    const val DEFAULT_TRANSPARENCY_PCT = 100

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

    fun iconStyle(ctx: Context): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_ICON_STYLE, DEFAULT_ICON_STYLE) ?: DEFAULT_ICON_STYLE

    fun setIconStyle(ctx: Context, style: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_ICON_STYLE, style).apply()
    }

    fun bubbleSizeDp(ctx: Context): Int =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getInt(KEY_BUBBLE_SIZE, DEFAULT_BUBBLE_SIZE_DP)

    fun setBubbleSizeDp(ctx: Context, dp: Int) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putInt(KEY_BUBBLE_SIZE, dp.coerceIn(40, 96)).apply()
    }

    fun transparencyPct(ctx: Context): Int =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getInt(KEY_TRANSPARENCY, DEFAULT_TRANSPARENCY_PCT)

    fun setTransparencyPct(ctx: Context, pct: Int) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putInt(KEY_TRANSPARENCY, pct.coerceIn(20, 100)).apply()
    }

    fun customIconUri(ctx: Context): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_CUSTOM_ICON_URI, "").orEmpty()

    fun setCustomIconUri(ctx: Context, uri: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_CUSTOM_ICON_URI, uri).apply()
    }
}
