package com.chatassist.overlay

/**
 * Per-chat memory between ChatReaderService (accessibility) and
 * OverlayService (UI). Each conversation is keyed by
 * "<package>|<chat title>" (title = whoever you're talking to, e.g.
 * "Tinder|Sneha"); chats whose title can't be determined fall back to the
 * bare package key. Only the latest snapshot per key is kept (max 10 chats),
 * in memory only — a process restart starts fresh.
 */
import android.content.Context
import com.chatassist.overlay.parsers.ChatParser
import java.util.concurrent.CopyOnWriteArrayList
import org.json.JSONObject

object ChatBus {
    data class ChatSnapshot(
        val appPackage: String,
        val title: String?,
        val text: String,
        val at: Long,
        /** Raw /api/facts JSON, plus the exact text it was computed from. */
        val factsJson: String? = null,
        val factsText: String? = null,
        /** Hand-added profile details (app screen) the overlay missed. */
        val userNote: String? = null,
        /** Last suggestion batch + the exact request it answers (smart refresh). */
        val suggestMode: String? = null,
        val suggestFor: String? = null,
        val suggestMood: String = "",
        val suggestItems: List<String> = emptyList(),
        val suggestTones: List<String> = emptyList(),
        /**
         * Per-message speaker corrections, applied positionally: message body
         * -> speaker per occurrence, in row order. Survives re-captures; may
         * drift if the 30-row window slides past fixed duplicates (accepted).
         */
        val speakerFixes: Map<String, List<String>> = emptyMap(),
    )

    private const val MAX_CHATS = 10

    /**
     * Packages whose chat text may be read. Single source of truth — the
     * reader gates parsing on this, and the overlay gates auto-dismiss on it.
     */
    val SUPPORTED_PACKAGES = setOf(
        "com.tinder",
        "co.hinge.app",
        "com.bumble.app",
        "com.snapchat.android",
        "com.instagram.android",
        "com.whatsapp",
    )

    /**
     * Package of the current foreground window, updated on every window
     * state change — including unsupported apps and the launcher. Only the
     * package name is observed here, never any content.
     */
    @Volatile
    var foregroundPackage: String = ""
        private set

    private val foregroundListeners = CopyOnWriteArrayList<(String) -> Unit>()

    fun addForegroundListener(listener: (String) -> Unit) {
        foregroundListeners.add(listener)
    }

    fun removeForegroundListener(listener: (String) -> Unit) {
        foregroundListeners.remove(listener)
    }

    /**
     * Fired (with the chat key) whenever a snapshot is actually stored —
     * drives the overlay's auto-refresh on chat switch. Runs on the
     * publisher's thread; UI listeners must post to the main thread.
     */
    private val snapshotListeners = CopyOnWriteArrayList<(String) -> Unit>()

    fun addSnapshotListener(listener: (String) -> Unit) {
        snapshotListeners.add(listener)
    }

    fun removeSnapshotListener(listener: (String) -> Unit) {
        snapshotListeners.remove(listener)
    }

    fun notifyForeground(packageName: String) {
        foregroundPackage = packageName
        appendFgLog("fg=$packageName")
        for (listener in foregroundListeners) {
            runCatching { listener(packageName) }
        }
    }

    /**
     * Flight recorder for visibility debugging: ring buffer of foreground
     * changes and bubble show/hide decisions (with cause), viewable in the
     * app's Capture log screen. No message content ever lands here — package
     * names and timestamps only.
     */
    private const val FG_LOG_MAX = 40
    private val fgLog = ArrayDeque<String>()

    @Synchronized
    private fun appendFgLog(entry: String) {
        val t = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
            .format(java.util.Date())
        fgLog.addLast("$t $entry")
        while (fgLog.size > FG_LOG_MAX) fgLog.removeFirst()
    }

    /** Bubble show/hide decisions, called by the overlay (cause included). */
    @Synchronized
    fun noteBubbleVisibility(visible: Boolean, cause: String) {
        appendFgLog("bubble=${if (visible) "VISIBLE" else "GONE"} ($cause)")
    }

    @Synchronized
    fun foregroundLog(): List<String> = fgLog.toList()

    private val snapshots = LinkedHashMap<String, ChatSnapshot>()

    /**
     * Disk persistence so the match list (and summaries) survive process
     * restarts — the app screen and the overlay panel read the same map, so
     * a summary fetched in either place shows up in both. Stored context is
     * the application context (never an Activity) to avoid leaks.
     */
    @Volatile
    private var appContext: Context? = null

    fun setAppContext(ctx: Context) {
        appContext = ctx.applicationContext
        if (snapshots.isEmpty()) loadFromPrefs()
    }

    @Volatile
    var latestKey: String = ""
        private set

    @Synchronized
    fun publish(key: String, snapshot: ChatSnapshot) {
        // Keys merge case-insensitively: Snapchat exposes the same chat as
        // "NIDHIII…" and "Nidhiii…" across screens, which used to list twice.
        val oldKey = snapshots.keys.firstOrNull { it.equals(key, ignoreCase = true) }
        val existing = oldKey?.let { snapshots[it] }
        // Ignore duplicate snapshots so we don't spam the backend.
        // (latestKey untouched: identical text means nothing moved.)
        if (existing != null && existing.text == snapshot.text) return
        if (existing != null && existing.text != snapshot.text) {
            // Anti-shrink: mid-transition trees and scrolled slices capture
            // partial slices ("Ok" alone); they must never clobber a fuller
            // history. Keep the old text, but still move latestKey (the user
            // IS viewing this chat) so the panel renders the full version.
            val oldRows = existing.text.lineSequence().count { it.isNotBlank() }
            val newRows = snapshot.text.lineSequence().count { it.isNotBlank() }
            if (oldRows >= 3 && newRows < oldRows) {
                latestKey = key
                for (listener in snapshotListeners) {
                    runCatching { listener(key) }
                }
                return
            }
        }
        if (oldKey != null) snapshots.remove(oldKey)
        snapshots.remove(key)
        // Preserve hand-added notes, facts and suggestions across re-captures.
        val merged = snapshot.copy(
            factsJson = snapshot.factsJson ?: existing?.factsJson,
            factsText = snapshot.factsText ?: existing?.factsText,
            userNote = snapshot.userNote ?: existing?.userNote,
            suggestMode = snapshot.suggestMode ?: existing?.suggestMode,
            suggestFor = snapshot.suggestFor ?: existing?.suggestFor,
            suggestMood = snapshot.suggestMood.ifEmpty { existing?.suggestMood.orEmpty() },
            suggestItems = snapshot.suggestItems.ifEmpty { existing?.suggestItems.orEmpty() },
            suggestTones = snapshot.suggestTones.ifEmpty { existing?.suggestTones.orEmpty() },
            speakerFixes = snapshot.speakerFixes.ifEmpty { existing?.speakerFixes.orEmpty() },
        )
        snapshots[key] = merged
        while (snapshots.size > MAX_CHATS) {
            snapshots.remove(snapshots.keys.first())
        }
        latestKey = key
        persistLocked()
        for (listener in snapshotListeners) {
            runCatching { listener(key) }
        }
    }

    @Synchronized
    fun get(key: String): ChatSnapshot? = snapshots[key]

    /** Newest first — drives the match list in the app screen. */
    @Synchronized
    fun all(): List<Pair<String, ChatSnapshot>> =
        snapshots.entries.sortedByDescending { it.value.at }.map { it.key to it.value }

    /** Attaches a freshly fetched fact sheet to a chat (latestKey untouched). */
    @Synchronized
    fun updateFacts(key: String, factsJson: String, factsText: String) {
        val existing = snapshots[key] ?: return
        snapshots[key] = existing.copy(factsJson = factsJson, factsText = factsText)
        persistLocked()
    }

    /** Stores a generated suggestion batch so re-Refresh is instant + free. */
    @Synchronized
    fun updateSuggestions(
        key: String, mode: String, forText: String, mood: String,
        items: List<String>, tones: List<String>,
    ) {
        val existing = snapshots[key] ?: return
        snapshots[key] = existing.copy(
            suggestMode = mode,
            suggestFor = forText,
            suggestMood = mood,
            suggestItems = items,
            suggestTones = tones,
        )
        persistLocked()
    }

    /** Stores tap-to-flip speaker corrections for one chat. */
    @Synchronized
    fun updateSpeakerFixes(key: String, fixes: Map<String, List<String>>) {
        val existing = snapshots[key] ?: return
        snapshots[key] = existing.copy(speakerFixes = fixes)
        persistLocked()
    }

    private val speakerTag = Regex("""^\[(USER|MATCH)\]:\s?(.*)$""", RegexOption.IGNORE_CASE)

    /**
     * Rewrites speaker tags per stored corrections, matching duplicate
     * bodies positionally (1st "Ok" -> 1st fix, 2nd -> 2nd…). Unfixed lines
     * and unknown bodies pass through untouched.
     */
    fun applySpeakerFixes(text: String, fixes: Map<String, List<String>>): String {
        if (text.isEmpty() || fixes.isEmpty()) return text
        val remaining = fixes.mapValues { ArrayDeque(it.value) }
        return text.lineSequence().map { line ->
            val m = speakerTag.matchEntire(line.trim()) ?: return@map line
            val body = m.groupValues[2]
            val forced = remaining[body]?.removeFirstOrNull()
            if (forced == "USER" || forced == "MATCH") "[$forced]: $body" else line
        }.joinToString("\n")
    }

    /** Saves a hand-added profile note (latestKey untouched). */
    @Synchronized
    fun updateNote(key: String, note: String) {
        val existing = snapshots[key] ?: return
        snapshots[key] = existing.copy(userNote = note.takeIf { it.isNotBlank() })
        persistLocked()
    }

    private fun persistLocked() {
        val ctx = appContext ?: return
        runCatching {
            val root = JSONObject()
            for ((key, s) in snapshots) {
                root.put(key, JSONObject()
                    .put("appPackage", s.appPackage)
                    .put("title", s.title)
                    .put("text", s.text)
                    .put("at", s.at)
                    .put("factsJson", s.factsJson)
                    .put("factsText", s.factsText)
                    .put("userNote", s.userNote)
                    .put("suggestMode", s.suggestMode)
                    .put("suggestFor", s.suggestFor)
                    .put("suggestMood", s.suggestMood)
                    .put("suggestItems", org.json.JSONArray(s.suggestItems))
                    .put("suggestTones", org.json.JSONArray(s.suggestTones))
                    .put("speakerFixes", JSONObject(s.speakerFixes.mapValues { org.json.JSONArray(it.value) })))
            }
            ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).edit()
                .putString(KEY_SNAPSHOTS, root.toString()).apply()
        }
    }

    @Synchronized
    fun loadFromPrefs() {
        val ctx = appContext ?: return
        runCatching {
            val raw = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
                .getString(KEY_SNAPSHOTS, null) ?: return
            val root = JSONObject(raw)
            for (key in root.keys()) {
                val o = root.optJSONObject(key) ?: continue
                val storedAt = o.optLong("at", 0L)
                // Never let a stale disk read clobber a newer live capture.
                if ((snapshots[key]?.at ?: -1L) > storedAt) continue
                snapshots[key] = ChatSnapshot(
                    appPackage = o.optString("appPackage"),
                    title = o.optString("title").takeIf { it.isNotEmpty() },
                    text = o.optString("text"),
                    at = storedAt,
                    factsJson = o.optString("factsJson").takeIf { it.isNotEmpty() },
                    factsText = o.optString("factsText").takeIf { it.isNotEmpty() },
                    userNote = o.optString("userNote").takeIf { it.isNotEmpty() },
                    suggestMode = o.optString("suggestMode").takeIf { it.isNotEmpty() },
                    suggestFor = o.optString("suggestFor").takeIf { it.isNotEmpty() },
                    suggestMood = o.optString("suggestMood").orEmpty(),
                    suggestItems = (o.optJSONArray("suggestItems")?.let { arr ->
                        (0 until arr.length()).mapNotNull {
                            arr.optString(it)?.takeIf { s -> s.isNotEmpty() }
                        }
                    }).orEmpty(),
                    suggestTones = (o.optJSONArray("suggestTones")?.let { arr ->
                        (0 until arr.length()).mapNotNull {
                            arr.optString(it)?.takeIf { s -> s.isNotEmpty() }
                        }
                    }).orEmpty(),
                    speakerFixes = (o.optJSONObject("speakerFixes")?.let { fo ->
                        linkedMapOf<String, List<String>>().also { m ->
                            for (k in fo.keys()) {
                                val arr = fo.optJSONArray(k) ?: continue
                                m[k] = (0 until arr.length()).mapNotNull {
                                    arr.optString(it)?.takeIf { s -> s == "USER" || s == "MATCH" }
                                }
                            }
                        }
                    }).orEmpty(),
                )
            }
            // One-time repair for stores written by older builds: merge keys
            // that differ only by case ("NIDHIII…" vs "Nidhiii…", newest wins)
            // and purge list-screen captures (Status, Locked chats, feeds).
            var repaired = false
            val merged = LinkedHashMap<String, ChatSnapshot>()
            for ((_, group) in snapshots.entries.groupBy { it.key.lowercase() }) {
                val newest = group.maxByOrNull { it.value.at }!!
                if (group.size > 1) repaired = true
                merged[newest.key] = newest.value
            }
            snapshots.clear()
            snapshots.putAll(merged)
            val junk = snapshots.filter { (_, s) ->
                runCatching {
                    ChatParser.forPackage(s.appPackage).isListScreen(s.title, s.text)
                }.getOrDefault(false)
            }.keys
            if (junk.isNotEmpty()) {
                repaired = true
                junk.forEach { snapshots.remove(it) }
            }
            if (repaired) persistLocked()
            while (snapshots.size > MAX_CHATS) {
                snapshots.remove(snapshots.keys.first())
            }
            if (latestKey.isBlank() || snapshots[latestKey] == null) {
                latestKey = snapshots.entries.maxByOrNull { it.value.at }?.key.orEmpty()
            }
        }
    }

    private const val PREFS_FILE = "chat_assist_chats"
    private const val KEY_SNAPSHOTS = "snapshots"

    /**
     * Tap-to-paste plumbing. The overlay (plain Service, no node access)
     * requests a paste; the reader service performs it and reports back.
     * Requests are strictly user-initiated (one overlay tap = at most one
     * paste) — there is intentionally no queue, no automation loop.
     */
    private var pasteHandler: ((String, (Boolean) -> Unit) -> Unit)? = null

    @Synchronized
    fun setPasteHandler(handler: ((String, (Boolean) -> Unit) -> Unit)?) {
        pasteHandler = handler
    }

    fun requestPaste(text: String, callback: (Boolean) -> Unit) {
        val handler = synchronized(this) { pasteHandler }
        if (handler == null) {
            callback(false)
            return
        }
        try {
            handler(text, callback)
        } catch (_: Exception) {
            callback(false)
        }
    }

    /**
     * Force-capture plumbing (same pattern as paste): the panel's Refresh
     * asks the reader to capture right now, bypassing debounce/hash, so a
     * missed chat switch is one tap away instead of stuck forever.
     */
    private var captureHandler: (() -> Boolean)? = null

    @Synchronized
    fun setCaptureHandler(handler: (() -> Boolean)?) {
        captureHandler = handler
    }

    fun requestCapture(): Boolean {
        val handler = synchronized(this) { captureHandler }
        if (handler == null) return false
        return try {
            handler()
        } catch (_: Exception) {
            false
        }
    }

    fun labelFor(key: String, snapshot: ChatSnapshot): String {
        val app = appLabel(snapshot.appPackage)
        val title = snapshot.title?.takeIf { it.isNotBlank() }
        return if (title != null) "$title • $app" else app.ifBlank { key }
    }

    fun appLabel(appPackage: String): String = when (appPackage) {
        "com.tinder" -> "Tinder"
        "co.hinge.app" -> "Hinge"
        "com.bumble.app" -> "Bumble"
        "com.snapchat.android" -> "Snapchat"
        "com.instagram.android" -> "Instagram"
        "com.whatsapp" -> "WhatsApp"
        else -> appPackage
    }
}
