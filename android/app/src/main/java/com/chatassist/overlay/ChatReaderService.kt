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
            val root = rootInActiveWindow ?: run { callback(false); return }
            val pkg = root.packageName?.toString() ?: run { callback(false); return }
            if (pkg !in ChatBus.SUPPORTED_PACKAGES) {
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
            val root = rootInActiveWindow ?: return
            val parser = ChatParser.forPackage(pkg)
            val text = parser.parse(root)
            if (text.isNotBlank()) {
                val title = parser.extractTitle(root)
                    ?.replace("|", " ")?.trim()?.take(40)?.takeIf { it.isNotBlank() }
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
