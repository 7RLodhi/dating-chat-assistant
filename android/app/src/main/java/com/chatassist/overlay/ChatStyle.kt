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
    fun myLines(): List<String> =
        ChatBus.all().asSequence()
            .flatMap { (_, s) -> ChatBus.applySpeakerFixes(s.text, s.speakerFixes).lineSequence() }
            .map { it.trim() }
            .filter { it.startsWith("[USER]", ignoreCase = true) }
            .map { it.substringAfter("]:", it).trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .take(MAX_LINES)
            .toList()

    /** Stored sample lines, one per line. */
    fun storedLines(ctx: Context): List<String> =
        Prefs.chatStyleSamples(ctx).lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()

    /** A paragraph in the user's own words, built from their sent lines. */
    fun paragraph(lines: List<String>): String =
        lines.joinToString(" ").take(600).trim()

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
        .put("samples", Prefs.chatStyleSamples(ctx))
        .put("example", Prefs.chatStyleExample(ctx))
        .put("exampleEdited", Prefs.chatStyleExampleEdited(ctx))
        .put("analysis", runCatching { JSONObject(Prefs.chatStyleJson(ctx)) }.getOrElse { JSONObject() })
        .toString(2)

    /** Applies an import; returns false when the file isn't a style export. */
    fun importJson(ctx: Context, raw: String): Boolean {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return false
        if (json.optString("app") != "chat-assist-style") return false
        val samples = json.optString("samples", "").trim()
        if (samples.isEmpty()) return false
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
