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

    fun notifyForeground(packageName: String) {
        foregroundPackage = packageName
        for (listener in foregroundListeners) {
            runCatching { listener(packageName) }
        }
    }

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
        val existing = snapshots[key]
        // Ignore duplicate snapshots so we don't spam the backend.
        if (existing != null && existing.text == snapshot.text) return
        snapshots.remove(key)
        snapshots[key] = snapshot
        while (snapshots.size > MAX_CHATS) {
            snapshots.remove(snapshots.keys.first())
        }
        latestKey = key
        persistLocked()
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
                    .put("factsText", s.factsText))
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
                snapshots[key] = ChatSnapshot(
                    appPackage = o.optString("appPackage"),
                    title = o.optString("title").takeIf { it.isNotEmpty() },
                    text = o.optString("text"),
                    at = o.optLong("at", 0L),
                    factsJson = o.optString("factsJson").takeIf { it.isNotEmpty() },
                    factsText = o.optString("factsText").takeIf { it.isNotEmpty() },
                )
            }
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
