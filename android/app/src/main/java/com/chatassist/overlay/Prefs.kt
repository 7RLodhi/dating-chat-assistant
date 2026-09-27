package com.chatassist.overlay

import android.content.Context
import kotlin.math.roundToInt

/** Tiny SharedPreferences wrapper. Backend URL points at your suggestion API. */
object Prefs {
    private const val FILE = "chat_assist_prefs"
    private const val KEY_TONE = "tone"
    private const val KEY_ICON_STYLE = "icon_style"
    private const val KEY_BUBBLE_SIZE = "bubble_size_dp"
    private const val KEY_TRANSPARENCY = "transparency_pct"
    private const val KEY_CUSTOM_ICON_URI = "custom_icon_uri"

    // Fixed production backend. A former onboarding field let testers point
    // elsewhere, but a typo'd URL silently broke suggestions — one constant,
    // zero confusion.
    private const val BACKEND_URL = "https://dhick-chick-chat.vercel.app/api/suggest"
    const val DEFAULT_TONE = "casual"

    /** Bubble icon: "initials" (CA), "chat" (💬), "dot" (plain), "custom" (gallery image). */
    const val DEFAULT_ICON_STYLE = "initials"
    const val DEFAULT_BUBBLE_SIZE_DP = 56
    const val DEFAULT_TRANSPARENCY_PCT = 100

    fun backendUrl(@Suppress("UNUSED_PARAMETER") ctx: Context): String = BACKEND_URL

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

    const val DEFAULT_PANEL_ALPHA_PCT = 80

    private const val KEY_PANEL_ALPHA = "panel_alpha_pct"

    fun panelAlphaPct(ctx: Context): Int =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getInt(KEY_PANEL_ALPHA, DEFAULT_PANEL_ALPHA_PCT)

    fun setPanelAlphaPct(ctx: Context, pct: Int) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putInt(KEY_PANEL_ALPHA, pct.coerceIn(20, 80)).apply()
    }

    // Tap-to-paste: tapping a suggestion fills the dating app's chat input;
    // the user always presses send. Default ON (tapping copies to clipboard
    // only when opted out or when the chat box can't be found).
    private const val KEY_AUTO_PASTE = "auto_paste"

    fun autoPaste(ctx: Context): Boolean =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getBoolean(KEY_AUTO_PASTE, true)

    fun setAutoPaste(ctx: Context, enabled: Boolean) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_AUTO_PASTE, enabled).apply()
    }

    // Panel size in dp. 0/0 = automatic (320dp wide, 60% of screen height).
    private const val KEY_PANEL_WIDTH = "panel_width_dp"
    private const val KEY_PANEL_HEIGHT = "panel_height_dp"

    fun panelWidthDp(ctx: Context): Int =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getInt(KEY_PANEL_WIDTH, 0)

    fun panelHeightDp(ctx: Context): Int =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getInt(KEY_PANEL_HEIGHT, 0)

    fun setPanelSizeDp(ctx: Context, widthDp: Int, heightDp: Int) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putInt(KEY_PANEL_WIDTH, widthDp.coerceIn(220, 2000))
            .putInt(KEY_PANEL_HEIGHT, heightDp.coerceIn(160, 2000))
            .apply()
    }

    fun setCustomIconUri(ctx: Context, uri: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_CUSTOM_ICON_URI, uri).apply()
    }

    // ---- Learned taste (mirrors webapp/lib/tasteProfile.ts exactly) ----
    // 👍/👎 votes on suggestion cards crystallize into tone affinity, length
    // preference and emoji appetite, sent as LEARNED TASTE with every
    // generation. Same thresholds as web so both clients steer identically.
    private const val KEY_TASTE_VOTES = "taste_votes_json"
    private const val MAX_TASTE_VOTES = 100
    private val CURRENT_TONES = setOf("casual", "playful", "witty", "sincere", "flirty", "spicy")
    private val EMOJI_RE = Regex(
        "[\u2600-\u27BF\u2B00-\u2BFF\uFE0F]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDEFF]|\uD83E[\uDD00-\uDFFF]"
    )

    private data class TasteVote(val tone: String, val text: String, val up: Boolean)

    fun recordTasteVote(ctx: Context, tone: String, text: String, up: Boolean) {
        val votes = getTasteVotes(ctx).toMutableList()
        votes.add(TasteVote(tone.lowercase(), text, up))
        while (votes.size > MAX_TASTE_VOTES) votes.removeAt(0)
        val arr = org.json.JSONArray()
        for (v in votes) {
            arr.put(org.json.JSONObject()
                .put("tone", v.tone)
                .put("text", v.text)
                .put("up", v.up))
        }
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_TASTE_VOTES, arr.toString()).apply()
    }

    private fun getTasteVotes(ctx: Context): List<TasteVote> {
        val raw = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_TASTE_VOTES, null) ?: return emptyList()
        return runCatching {
            val arr = org.json.JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                TasteVote(
                    tone = o.optString("tone").lowercase(),
                    text = o.optString("text"),
                    up = o.optBoolean("up", true),
                )
            }
        }.getOrDefault(emptyList())
    }

    /** Prompt-ready paragraph, or "" until votes crystallize (same as web). */
    fun tasteProfile(ctx: Context): String {
        val votes = getTasteVotes(ctx)
        if (votes.size < 3) return ""
        val lines = mutableListOf<String>()
        val byTone = mutableMapOf<String, IntArray>() // tone -> [up, down]
        for (v in votes) {
            val e = byTone.getOrPut(v.tone) { intArrayOf(0, 0) }
            if (v.up) e[0]++ else e[1]++
        }
        val loved = mutableListOf<String>()
        val disliked = mutableListOf<String>()
        for ((tone, e) in byTone) {
            if (tone !in CURRENT_TONES) continue
            if (e[0] + e[1] < 3) continue
            val rate = e[0].toDouble() / (e[0] + e[1])
            if (rate >= 0.67) loved.add(tone)
            else if (rate <= 0.33) disliked.add(tone)
        }
        if (loved.isNotEmpty()) lines.add("Leans toward the ${loved.joinToString(", ")} tone.")
        if (disliked.isNotEmpty()) lines.add("Steer away from the ${disliked.joinToString(", ")} tone.")

        val ups = votes.filter { it.up }
        val downs = votes.filter { !it.up }
        if (ups.size >= 2 && downs.size >= 2) {
            val avgUp = ups.sumOf { it.text.length }.toDouble() / ups.size
            val avgDown = downs.sumOf { it.text.length }.toDouble() / downs.size
            if (avgUp + 30 <= avgDown) {
                lines.add("Prefers shorter messages (liked ones average ~${avgUp.roundToInt()} chars).")
            } else if (avgDown + 30 <= avgUp) {
                lines.add("Prefers longer, fuller messages (liked ones average ~${avgUp.roundToInt()} chars).")
            }
            val upRate = ups.count { EMOJI_RE.containsMatchIn(it.text) }.toDouble() / ups.size
            val downRate = downs.count { EMOJI_RE.containsMatchIn(it.text) }.toDouble() / downs.size
            if (upRate - downRate >= 0.4) lines.add("Likes messages with emoji.")
            else if (downRate - upRate >= 0.4) lines.add("Prefers messages without emoji.")
        }
        if (lines.isEmpty()) return ""
        return "LEARNED TASTE (from ${votes.size} past 👍/👎 votes by this user — steer toward what they demonstrably like):\n- ${lines.joinToString("\n- ")}"
    }
}
