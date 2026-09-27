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
    }

    private var lastPublishAt = 0L

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
    }

    override fun onDestroy() {
        ChatBus.setPasteHandler(null)
        super.onDestroy()
    }

    /**
     * Fills the foreground chat input with user-tapped suggestion text.
     * Refuses unless a supported dating app is actually in front — so a tap
     * can never land text in a banking app, settings screen, or anywhere
     * else. Reports success back for the overlay's toast + clipboard fallback.
     */
    private fun handlePasteRequest(text: String, callback: (Boolean) -> Unit) {
        try {
            // Never trust rootInActiveWindow alone: whatever holds focus
            // (keyboard, a popup, our own bubble) may own the active window.
            // Scan all windows for a supported dating app instead.
            val root = findSupportedAppRoot() ?: run { callback(false); return }
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
            ChatBus.notifyForeground(pkg)
        }
        if (pkg !in ChatBus.SUPPORTED_PACKAGES) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        ) return

        val now = System.currentTimeMillis()
        if (now - lastPublishAt < DEBOUNCE_MS) return
        lastPublishAt = now

        try {
            // Same helper as tap-to-paste: the focused window may be the
            // keyboard or a popup, so scan for the dating app's window and
            // require it to match the event's package (never our panel).
            val root = findSupportedAppRoot() ?: return
            if (root.packageName?.toString() != pkg) return
            val parser = ChatParser.forPackage(pkg)
            // Hash gate before the expensive parse (see cheapTreeHash).
            val treeHash = cheapTreeHash(root)
            if (lastTreeHash[pkg] == treeHash) return
            lastTreeHash[pkg] = treeHash
            // Only real conversation screens: a chat input must be on screen
            // (kills chat-lists, Status/Calls tabs, feeds, contact info…),
            // and list-screen markers are double-checked after parsing.
            if (!parser.hasChatInput(root)) return
            val text = parser.parse(root)
            if (text.isNotBlank()) {
                val title = parser.extractTitle(root)
                    ?.replace("|", " ")?.trim()?.take(40)?.takeIf { it.isNotBlank() }
                if (parser.isListScreen(title, text)) return
                val key = if (title != null) "$pkg|$title" else pkg
                ChatBus.publish(
                    key,
                    ChatBus.ChatSnapshot(
                        appPackage = pkg,
                        title = title,
                        text = text,
                        at = System.currentTimeMillis(),
                    ),
                )
            }
        } catch (_: Exception) {
            // A dating-app UI update must never crash the service.
            // Next event will retry automatically.
        }
    }

    override fun onInterrupt() {
        // Nothing to clean up.
    }
}
