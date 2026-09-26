package com.chatassist.overlay

/**
 * Per-chat memory between ChatReaderService (accessibility) and
 * OverlayService (UI). Each conversation is keyed by
 * "<package>|<chat title>" (title = whoever you're talking to, e.g.
 * "Tinder|Sneha"); chats whose title can't be determined fall back to the
 * bare package key. Only the latest snapshot per key is kept (max 10 chats),
 * in memory only — a process restart starts fresh.
 */
import java.util.concurrent.CopyOnWriteArrayList

object ChatBus {
    data class ChatSnapshot(
        val appPackage: String,
        val title: String?,
        val text: String,
        val at: Long,
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
    }

    @Synchronized
    fun get(key: String): ChatSnapshot? = snapshots[key]

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
