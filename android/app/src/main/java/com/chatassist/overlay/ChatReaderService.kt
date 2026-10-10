package com.chatassist.overlay

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.chatassist.overlay.parsers.ChatParser

/**
 * Reads the visible chat conversation inside supported dating apps.
 *
 * Guardrails (deliberate, do not loosen without review):
 * - Message text is extracted ONLY from [ChatBus.SUPPORTED_PACKAGES].
 * - The service additionally observes every foreground-window change (package
 *   name only, never content) so the overlay can dismiss its panel when you
 *   leave — window-state events are cheap; content is still never touched
 *   outside the supported packages.
 * - The single write capability is tap-to-paste: one user tap fills the
 *   foreground chat input (supported apps only, verified at paste time). No
 *   send action is ever performed — the user always presses send themselves.
 * - Debounced (1.5s) so rapid scroll events don't spam extraction.
 */
class ChatReaderService : AccessibilityService() {

    companion object {
        private const val DEBOUNCE_MS = 1500L
        /** Wait after each scroll so the list settles before reading it. */
        private const val SCROLL_SETTLE_MS = 900L
        /** Matches the server's per-request input limit. */
        private const val MAX_MERGED_CHARS = 4000
    }

    private var lastPublishAt = 0L
    /** Set while a debounced event awaits its delayed retry (no pile-up). */
    private var retryPending = false
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    /**
     * Battery diet: full parses walk the whole tree with a bounds IPC per
     * leaf, but most events (scroll settling, presence/timer redraws) change
     * nothing. This structural hash costs one bounds-free walk; when it
     * matches the last parse for that app, the expensive parse is skipped
     * outright. Typing, new messages and screen changes alter text → hash
     * changes → normal capture. One entry per supported package.
     */
    private val lastTreeHash = mutableMapOf<String, Long>()

    private fun cheapTreeHash(root: AccessibilityNodeInfo): Long {
        var h = -3750763034362895579L // FNV-1a 64 offset basis
        fun mix(v: Int) {
            h = h xor v.toLong()
            h *= 1099511628211L // FNV prime
        }
        fun walk(node: AccessibilityNodeInfo) {
            mix(node.childCount)
            // Skip keystroke text inside inputs: typing bursts would
            // invalidate the hash on every character (each still parses, then
            // dedupes). Sent messages appear as message leaves, so nothing
            // real is ever missed by this.
            if (!node.isEditable) {
                // Platform type: text really is null for container nodes.
                mix(node.text?.toString()?.hashCode() ?: 0)
                mix(node.contentDescription?.toString()?.hashCode() ?: 0)
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { walk(it) }
            }
        }
        walk(root)
        return h
    }

    override fun onServiceConnected() {
        // Config comes from res/xml/accessibility_service_config.xml.
        ChatBus.setAppContext(this)
        ChatBus.setPasteHandler(::handlePasteRequest)
        // Panel Refresh bypasses debounce/hash and captures right now.
        ChatBus.setCaptureHandler(::handleCaptureRequest)
        ChatBus.setScrollBackHandler(::handleScrollBackRequest)
    }

    override fun onDestroy() {
        ChatBus.setPasteHandler(null)
        ChatBus.setCaptureHandler(null)
        ChatBus.setScrollBackHandler(null)
        super.onDestroy()
    }

    /**
     * Scrolls the open chat upward a few screens so older messages load, then
     * stores everything seen as one text (newest kept). Only scrolls: never
     * taps, types or sends. Stops at [steps], or early when two scrolls add
     * no new lines (top of chat reached, or the app ignores the scroll).
     */
    private fun handleScrollBackRequest(steps: Int, done: (Int) -> Unit) {
        val fg = ChatBus.foregroundPackage
        if (fg !in ChatBus.SUPPORTED_PACKAGES || !ChatBus.isAppEnabled(fg)) {
            done(0)
            return
        }
        var merged = linesOf(ChatBus.get(ChatBus.latestKey)?.text.orEmpty())
        var taken = 0
        var stale = 0

        fun finish() {
            if (merged.isNotEmpty()) {
                // Keep the newest lines within the server's input limit.
                val kept = mutableListOf<String>()
                var used = 0
                for (line in merged.asReversed()) {
                    if (used + line.length + 1 > MAX_MERGED_CHARS) break
                    kept.add(line)
                    used += line.length + 1
                }
                kept.reverse()
                ChatBus.setMergedText(ChatBus.latestKey, kept.joinToString("\n"))
            }
            done(taken)
        }

        fun step() {
            if (taken >= steps || stale >= 2) return finish()
            val root = findConversationRoot(fg) ?: return finish()
            if (!scrollOlder(root)) {
                ChatBus.noteCaptureSkip("scroll-failed")
                return finish()
            }
            taken++
            mainHandler.postDelayed({
                publishCurrent(fg, force = true)
                val now = linesOf(ChatBus.get(ChatBus.latestKey)?.text.orEmpty())
                val before = merged.size
                merged = prependOlder(now, merged)
                stale = if (merged.size == before) stale + 1 else 0
                step()
            }, SCROLL_SETTLE_MS)
        }
        step()
    }

    /**
     * One upward scroll. Tries the list's own scroll action first (and its
     * parents, since Snapchat often marks a wrapper as scrollable), then a
     * short swipe down on the left side of the chat, where the overlay panel
     * usually isn't. Returns false only when neither could be dispatched.
     */
    private fun scrollOlder(root: AccessibilityNodeInfo): Boolean {
        findScrollable(root)?.let { node ->
            var cur: AccessibilityNodeInfo? = node
            var depth = 0
            while (cur != null && depth < 4) {
                if (cur.isScrollable && cur.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) return true
                cur = cur.parent
                depth++
            }
        }
        if (android.os.Build.VERSION.SDK_INT < 24) return false
        val b = Rect()
        root.getBoundsInScreen(b)
        if (b.height() <= 0) return false
        val x = b.left + b.width() * 0.25f
        val path = android.graphics.Path().apply {
            moveTo(x, b.top + b.height() * 0.3f)
            lineTo(x, b.top + b.height() * 0.75f)
        }
        val stroke = android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, 350)
        val gesture = android.accessibilityservice.GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture, null, null)
    }

    private fun linesOf(text: String): List<String> =
        text.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()

    /**
     * Joins an older screen onto what was already collected. Scrolling up
     * shows the older rows, whose bottom overlaps the top of [current]; the
     * longest such overlap is dropped so each message appears once.
     */
    private fun prependOlder(older: List<String>, current: List<String>): List<String> {
        for (m in minOf(older.size, current.size) downTo 1) {
            if (older.takeLast(m) == current.take(m)) return older + current.drop(m)
        }
        return older + current
    }

    /** The big scrollable message list: the largest visible scrollable node. */
    private fun findScrollable(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var best: AccessibilityNodeInfo? = null
        var bestArea = 0
        fun walk(node: AccessibilityNodeInfo) {
            if (node.isScrollable && node.isVisibleToUser) {
                val b = Rect()
                node.getBoundsInScreen(b)
                if (b.width() * b.height() > bestArea) {
                    bestArea = b.width() * b.height()
                    best = node
                }
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { walk(it) }
            }
        }
        walk(root)
        return best
    }

    /**
     * Force-capture for the panel's Refresh button. Runs on the UI thread
     * (one full tree walk per tap — acceptable for an explicit action).
     */
    private fun handleCaptureRequest(): Boolean {
        val fg = ChatBus.foregroundPackage
        if (fg !in ChatBus.SUPPORTED_PACKAGES) {
            ChatBus.noteCaptureSkip("not-a-dating-app")
            return false
        }
        if (!ChatBus.isAppEnabled(fg)) {
            ChatBus.noteCaptureSkip("app-disabled")
            return false
        }
        return publishCurrent(fg, force = true)
    }

    /**
     * Fills the foreground chat input with user-tapped suggestion text.
     * Refuses unless a supported dating app is actually in front — so a tap
     * can never land text in a banking app, settings screen, or anywhere
     * else. Reports success back for the overlay's toast + clipboard fallback.
     */
    private fun handlePasteRequest(text: String, callback: (Boolean) -> Unit) {
        try {
            // Conversation window directly (not just any supported window):
            // the input must exist for the paste to land anywhere.
            val root = findConversationRoot() ?: run { callback(false); return }
            // Per-app kill switch: never paste into an app the user unchecked.
            val pkg = root.packageName?.toString().orEmpty()
            if (!ChatBus.isAppEnabled(pkg)) {
                callback(false)
                return
            }
            val field = findChatInput(root) ?: run { callback(false); return }
            field.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            val args = Bundle().apply {
                putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                    text,
                )
            }
            callback(field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args))
        } catch (_: Exception) {
            callback(false)
        }
    }

    /**
     * Returns the root node of the frontmost supported dating-app window, or
     * null when none is on screen. Refuses anything else, so a tap can never
     * land text in a banking app, settings screen, or our own overlay.
     */
    private fun findSupportedAppRoot(): AccessibilityNodeInfo? {
        // In practice at most one supported dating app is ever on screen
        // (our own overlay is a different package and never qualifies), so
        // the first match wins. Split-screen with two dating apps would paste
        // into whichever the system lists first — acceptable edge case.
        runCatching { windows }.getOrNull()?.forEach { window ->
            val root = runCatching { window?.root }.getOrNull() ?: return@forEach
            if (root.packageName?.toString() in ChatBus.SUPPORTED_PACKAGES) {
                return root
            }
        }
        // Fallback: single active window, still package-gated.
        val root = rootInActiveWindow ?: return null
        return if (root.packageName?.toString() in ChatBus.SUPPORTED_PACKAGES) root else null
    }

    /**
     * The conversation window: a supported app's window that actually holds
     * a chat input. Popups (text-selection Cut/Copy toolbar), toasts and
     * feed windows share the app's package but carry no input — picking the
     * first supported window blindly parses those instead of the chat, and
     * the missing input then wrongly clears the conversation verdict (the
     * bubble vanished every time text was selected). Null when no
     * conversation window exists; callers treat that as "not a chat".
     * Pass null to accept any supported app (tap-to-paste).
     */
    private fun findConversationRoot(pkg: String? = null): AccessibilityNodeInfo? {
        runCatching { windows }.getOrNull()?.forEach { window ->
            val root = runCatching { window?.root }.getOrNull() ?: return@forEach
            val rp = root.packageName?.toString() ?: return@forEach
            if (rp !in ChatBus.SUPPORTED_PACKAGES) return@forEach
            if (pkg != null && rp != pkg) return@forEach
            if (ChatParser.forPackage(rp).hasChatInput(root)) return root
        }
        return null
    }

    /**
     * Chat inputs sit at the bottom of the screen, so the lowest visible
     * editable field wins. Tiny/hidden nodes are skipped.
     */
    private fun findChatInput(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var best: AccessibilityNodeInfo? = null
        var bestTop = Int.MIN_VALUE
        fun walk(node: AccessibilityNodeInfo) {
            if (node.isEditable && node.isVisibleToUser) {
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                if (bounds.height() > 0 && bounds.top >= bestTop) {
                    bestTop = bounds.top
                    best = node
                }
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { walk(it) }
            }
        }
        walk(root)
        return best
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            // Ground truth first: is a supported window still present?
            // (Transient toasts/usage-reminders fire with foreign packages
            // while the dating app sits underneath.)
            ChatBus.supportedVisible =
                runCatching { findSupportedAppRoot() != null }.getOrDefault(false)
            ChatBus.notifyForeground(pkg)
        }
        // Leaving all supported apps clears the conversation verdict: it is
        // re-derived on every capture inside, but nothing recomputes it
        // outside — without this it sticks true forever and every later
        // visibility sync wrongly resurrects the bubble (own app, home,
        // other apps). Overlay-context windows (our own UI, keyboards,
        // systemui) sit ON TOP of the chat rather than replacing it, so
        // they must not clear. Hash/debounce skips intentionally keep the
        // old value (unchanged screen ⇒ unchanged verdict).
        if (pkg !in ChatBus.SUPPORTED_PACKAGES) {
            if (!ChatBus.isOverlayContext(pkg, packageName)) {
                ChatBus.inConversation = false
            }
            return
        }
        // User-disabled app: no capture, no bubble, no panel — and the
        // verdict clears so nothing stale lingers. Foreground tracking
        // above still ran, so hide-on-leave keeps working.
        if (!ChatBus.isAppEnabled(pkg)) {
            ChatBus.inConversation = false
            ChatBus.noteCaptureSkip("app-disabled")
            return
        }
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        ) return

        publishCurrent(pkg)
    }

    /**
     * Reads the current window and publishes it as the latest snapshot.
     * Normally gated (debounce + tree hash); `force` skips both for an
     * explicit Refresh. Returns true when a snapshot was stored.
     */
    private fun publishCurrent(pkg: String, force: Boolean = false): Boolean {
        if (!force) {
            val now = System.currentTimeMillis()
            if (now - lastPublishAt < DEBOUNCE_MS) {
                // A chat switch landing inside the debounce window would
                // otherwise be lost: a settled screen fires nothing more,
                // stranding the panel on the previous chat forever. Retry
                // once, reading the CURRENT window (not this stale event).
                if (!retryPending) {
                    retryPending = true
                    ChatBus.noteCaptureSkip("debounced+retry")
                    mainHandler.postDelayed({
                        retryPending = false
                        val fg = ChatBus.foregroundPackage
                        if (fg in ChatBus.SUPPORTED_PACKAGES) publishCurrent(fg)
                    }, DEBOUNCE_MS + 200)
                } else {
                    ChatBus.noteCaptureSkip("debounced")
                }
                return false
            }
            lastPublishAt = now
        }

        try {
            // Conversation window first: popups (text-selection Cut/Copy
            // toolbar), toasts and feeds share the app's package but carry
            // no chat input. Parsing those instead of the chat both poisoned
            // snapshots and wrongly cleared the conversation verdict.
            val root = findConversationRoot(pkg)
            if (root == null) {
                // No supported window at all, or none holding a chat input
                // (feed/list/popup only): not a conversation, clear verdict.
                ChatBus.inConversation = false
                ChatBus.noteCaptureSkip("no-conversation-window")
                return false
            }
            val parser = ChatParser.forPackage(pkg)
            // Hash gate before the expensive parse (see cheapTreeHash).
            val treeHash = cheapTreeHash(root)
            if (!force && lastTreeHash[pkg] == treeHash) {
                ChatBus.noteCaptureSkip("hash-same")
                return false
            }
            lastTreeHash[pkg] = treeHash
            // Chat-input presence was already verified by
            // findConversationRoot above (which is also why list/feed
            // screens never reach the parse below); list-screen markers are
            // still double-checked after parsing for odd screens.
            val text = parser.parse(root)
            // Mid-transition frames (feed rows mixed into chat) are dropped
            // outright — publishing them would poison the snapshot and every
            // suggestion after it.
            if (parser.looksContaminated(text)) {
                ChatBus.noteCaptureSkip("contaminated")
                return false
            }
            // Empty chats publish too (title only): switching to a fresh,
            // message-less conversation must move latestKey and yield
            // openers — otherwise the panel sticks on the previous match.
            // Only a title-less empty read means nothing at all.
            val title = parser.extractTitle(root)
                ?.replace("|", " ")?.trim()?.take(40)?.takeIf { it.isNotBlank() }
            // Apps that need a contact name (Snapchat) never file a chat
            // under the bare package: a nameless frame — call screen, banner,
            // mid-transition — is dropped, and the next readable frame
            // publishes under the real name.
            if (title == null && parser.requiresTitle) {
                ChatBus.noteCaptureSkip("no-title")
                return false
            }
            if (text.isBlank() && title == null) {
                ChatBus.noteCaptureSkip("empty-titleless")
                return false
            }
            if (parser.isListScreen(title, text)) {
                ChatBus.inConversation = false
                ChatBus.noteCaptureSkip("list-screen")
                return false
            }
            val key = if (title != null) "$pkg|$title" else pkg
            // Bubble-visible ⟺ snapshot-exists: only a stored snapshot may
            // claim the conversation (covers normal and empty-titled
            // publishes alike). Dropped frames leave the old verdict alone.
            ChatBus.inConversation = true
            ChatBus.publish(
                key,
                ChatBus.ChatSnapshot(
                    appPackage = pkg,
                    title = title,
                    text = text,
                    at = System.currentTimeMillis(),
                ),
                touch = force,
            )
            return true
        } catch (_: Exception) {
            // A dating-app UI update must never crash the service.
            // Counted (not just swallowed) so a crashing parse shows up in
            // the capture log instead of masquerading as "no chat".
            ChatBus.noteCaptureSkip("exception")
            // Next event will retry automatically.
        }
        return false
    }

    override fun onInterrupt() {
        // Nothing to clean up.
    }
}
