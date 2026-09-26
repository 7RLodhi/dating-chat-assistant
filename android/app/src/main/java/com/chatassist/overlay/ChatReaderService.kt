package com.chatassist.overlay

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import com.chatassist.overlay.parsers.ChatParser

/**
 * Reads the visible chat conversation inside supported dating apps.
 *
 * Guardrails (deliberate, do not loosen without review):
 * - Only the whitelisted packages below are ever inspected (also enforced in
 *   res/xml/accessibility_service_config.xml).
 * - Read-only: extracts visible text, never performs clicks, gestures, or
 *   sends anything on the user's behalf.
 * - Debounced (1.5s) so rapid scroll events don't spam extraction.
 */
class ChatReaderService : AccessibilityService() {

    companion object {
        val SUPPORTED_PACKAGES = setOf(
            "com.tinder",
            "co.hinge.app",
            "com.bumble.app",
        )
        private const val DEBOUNCE_MS = 1500L
    }

    private var lastPublishAt = 0L

    override fun onServiceConnected() {
        // Config comes from res/xml/accessibility_service_config.xml.
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: return
        if (pkg !in SUPPORTED_PACKAGES) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        ) return

        val now = System.currentTimeMillis()
        if (now - lastPublishAt < DEBOUNCE_MS) return
        lastPublishAt = now

        try {
            val root = rootInActiveWindow ?: return
            val text = ChatParser.forPackage(pkg).parse(root)
            if (text.isNotBlank()) {
                ChatBus.publish(pkg, text)
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
