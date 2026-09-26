package com.chatassist.overlay

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
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
 * - Read-only: extracts visible text, never performs clicks, gestures, or
 *   sends anything on the user's behalf.
 * - Debounced (1.5s) so rapid scroll events don't spam extraction.
 */
class ChatReaderService : AccessibilityService() {

    companion object {
        private const val DEBOUNCE_MS = 1500L
    }

    private var lastPublishAt = 0L

    override fun onServiceConnected() {
        // Config comes from res/xml/accessibility_service_config.xml.
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
