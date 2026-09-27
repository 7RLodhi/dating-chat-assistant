package com.chatassist.overlay

import android.accessibilityservice.AccessibilityService
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.app.NotificationCompat
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
        private const val START_RETRY_MS = 60_000L
        private const val NOTIFY_GAP_MS = 10 * 60_000L
        private const val START_CHANNEL_ID = "bubble_start"
    }

    private var lastPublishAt = 0L
    private var lastStartAttemptAt = 0L
    private var lastStartNotifyAt = 0L

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
            // Supported app opened while the overlay is down (first run,
            // reboot, after drop-to-close): try to bring the bubble up.
            if (pkg in ChatBus.SUPPORTED_PACKAGES) ensureOverlayRunning()
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

    /**
     * Best-effort bubble auto-start. Works outright on older Android and in
     * the rare allowed cases; on new versions a background start is blocked
     * by the OS, so fall back to a tap-to-start notification (throttled).
     * Either way the user never digs through settings — one tap at most.
     */
    private fun ensureOverlayRunning() {
        if (isOverlayRunning()) return
        val now = System.currentTimeMillis()
        if (now - lastStartAttemptAt < START_RETRY_MS) return
        lastStartAttemptAt = now
        val intent = Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_START)
        val started = runCatching {
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
            true
        }.getOrDefault(false)
        if (!started) notifyToStartBubble(now)
    }

    private fun isOverlayRunning(): Boolean {
        val manager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        return manager.getRunningServices(Int.MAX_VALUE)
            .any { it.service.className == OverlayService::class.java.name }
    }

    private fun notifyToStartBubble(now: Long) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        if (now - lastStartNotifyAt < NOTIFY_GAP_MS) return
        lastStartNotifyAt = now
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(START_CHANNEL_ID, "Bubble starter", NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(this, START_CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Dating app opened — tap to start the bubble")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .build()
        nm.notify(2, notif)
    }
}
