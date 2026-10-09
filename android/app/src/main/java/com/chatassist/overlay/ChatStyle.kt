package com.chatassist.overlay

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * "My chat style": learns how the user writes from THEIR OWN captured lines
 * only (match messages never leave the phone here). Stored as:
 *  - samples: the exact lines the user sent (kept, shown collapsed),
 *  - analysis: the learned pattern (summary + traits),
 *  - example: an editable paragraph in the user's own words.
 * Refreshes automatically whenever the bubble opens or a summary is learned,
 * but only when the user's lines actually changed.
 */
object ChatStyle {
    private const val MIN_LINES = 3
    private const val MAX_LINES = 60
    private const val MAX_CHARS = 3500

    /** The user's own lines from every captured chat, newest chats first. */
    fun myLines(): List<String> {
        val titles = knownTitles()
        return ChatBus.all().asSequence()
            .flatMap { (_, s) -> ChatBus.applySpeakerFixes(s.text, s.speakerFixes).lineSequence() }
            .map { it.trim() }
            .filter { it.startsWith("[USER]", ignoreCase = true) }
            .map { it.substringAfter("]:", it).trim() }
            .filter { it.isNotEmpty() && !isUiNoise(it, titles) }
            .distinct()
            .take(MAX_LINES)
            .toList()
    }

    /** Stored sample lines, one per line, minus any UI text saved by older builds. */
    fun storedLines(ctx: Context): List<String> {
        val titles = knownTitles()
        return Prefs.chatStyleSamples(ctx).lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !isUiNoise(it, titles) }
            .toList()
    }

    /** A paragraph in the user's own words, built from their sent lines. */
    fun paragraph(lines: List<String>): String =
        lines.joinToString(" ").take(600).trim()

    /** Chat titles and contact names: a line equal to one of these is a label, not something the user typed. */
    private fun knownTitles(): Set<String> =
        ChatBus.all().map { (key, s) -> ChatBus.labelFor(key, s).trim().lowercase() }.toSet()

    private val NOISE_EXACT = setOf(
        "(edited)", "missed call", "video call", "voice call", "you deleted a chat",
        "this message was deleted", "watch on spotlight", "sent a snap", "opened",
        "delivered", "sent", "received", "viewed",
    )
    private val NOISE_PREFIXES = listOf(
        "replied to ", "reply to ", "you replied to ", "watch on ", "you deleted ",
    )

    /**
     * UI text that leaks into captured lines and is not something the user
     * wrote: system banners ("YOU DELETED A CHAT", "Missed call"), quoted-reply
     * headers ("Replied to X's Story", "Reply to X..."), "(Edited)" tags, and
     * contact names / sender labels (a line equal to a known chat title, or an
     * all-caps multi-word label like "SONAM THAKUR").
     */
    private fun isUiNoise(line: String, titles: Set<String>): Boolean {
        val l = line.trim().lowercase()
        if (l.isEmpty()) return true
        if (l in NOISE_EXACT) return true
        if (NOISE_PREFIXES.any { l.startsWith(it) }) return true
        if (l in titles) return true
        val words = line.trim().split(Regex("\\s+"))
        if (words.size >= 2 && line.any { it.isLetter() } && line == line.uppercase()) return true
        return false
    }

    /**
     * Refreshes the style from captured lines, merged with what is already
     * stored (pasted or imported samples are kept). Skips the network when the
     * captured lines are unchanged since the last successful analysis.
     */
    fun autoRefresh(ctx: Context, onDone: (Boolean) -> Unit = {}) {
        val harvested = myLines()
        if (harvested.size < MIN_LINES) return onDone(false)
        val hash = harvested.joinToString("\n").hashCode().toString()
        if (Prefs.chatStyleHash(ctx) == hash) return onDone(false)
        val merged = (harvested + storedLines(ctx)).distinct().take(MAX_LINES)
        analyze(ctx, merged, hash = hash, resetExample = false) { ok -> onDone(ok) }
    }

    /**
     * Analyzes the given lines and saves samples, analysis and example. Used
     * by the automatic refresh, Learn, and Analyze & save (which resets the
     * example to a fresh paragraph).
     */
    fun analyze(
        ctx: Context,
        lines: List<String>,
        hash: String? = null,
        resetExample: Boolean,
        onDone: (Boolean) -> Unit = {},
    ) {
        if (inFlight) return onDone(false)
        val samples = lines.joinToString("\n").take(MAX_CHARS)
        if (samples.isBlank()) return onDone(false)
        inFlight = true
        ApiClient.analyzeStyle(Prefs.backendUrl(ctx), samples) { result ->
            inFlight = false
            result.fold(
                onSuccess = { profile ->
                    Prefs.setChatStyleSamples(ctx, samples)
                    Prefs.setChatStyleJson(
                        ctx,
                        JSONObject()
                            .put("summary", profile.summary)
                            .put("traits", JSONArray(profile.traits))
                            .put("at", System.currentTimeMillis())
                            .toString(),
                    )
                    if (resetExample) Prefs.setChatStyleExampleEdited(ctx, false)
                    if (!Prefs.chatStyleExampleEdited(ctx)) {
                        Prefs.setChatStyleExample(ctx, paragraph(lines))
                    }
                    if (hash != null) Prefs.setChatStyleHash(ctx, hash)
                    onDone(true)
                },
                onFailure = { onDone(false) },
            )
        }
    }

    private var inFlight = false

    /** Export/import payload, shared by the setup screen's file buttons. */
    fun exportJson(ctx: Context): String = JSONObject()
        .put("app", "chat-assist-style")
        .put("v", 2)
        .put("samples", storedLines(ctx).joinToString("\n"))
        .put("example", Prefs.chatStyleExample(ctx))
        .put("exampleEdited", Prefs.chatStyleExampleEdited(ctx))
        .put("analysis", runCatching { JSONObject(Prefs.chatStyleJson(ctx)) }.getOrElse { JSONObject() })
        .toString(2)

    /** Applies an import; returns false when the file isn't a style export. */
    fun importJson(ctx: Context, raw: String): Boolean {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return false
        if (json.optString("app") != "chat-assist-style") return false
        val titles = knownTitles()
        val cleaned = json.optString("samples", "").lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !isUiNoise(it, titles) }
            .toList()
        if (cleaned.isEmpty()) return false
        val samples = cleaned.joinToString("\n")
        Prefs.setChatStyleSamples(ctx, samples)
        val analysis = json.optJSONObject("analysis")
        if (analysis != null && analysis.optString("summary", "").isNotBlank()) {
            if (analysis.optLong("at", 0L) == 0L) analysis.put("at", System.currentTimeMillis())
            Prefs.setChatStyleJson(ctx, analysis.toString())
        } else {
            Prefs.setChatStyleJson(ctx, "")
        }
        val example = json.optString("example", "").trim()
        Prefs.setChatStyleExample(ctx, example.ifEmpty { paragraph(samples.lines()) })
        Prefs.setChatStyleExampleEdited(ctx, json.optBoolean("exampleEdited", false))
        Prefs.setChatStyleHash(ctx, "")
        return true
    }
}
