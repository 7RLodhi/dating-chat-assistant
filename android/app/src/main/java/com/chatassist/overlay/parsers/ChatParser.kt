package com.chatassist.overlay.parsers

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Turns an accessibility node tree from a dating-app chat screen into plain
 * conversation text, one message per line. Speaker attribution ([MATCH] /
 * [USER]) is best-effort: left-aligned bubbles are the match, right-aligned
 * are you. The overlay UI already lets the user swap a mislabeled message.
 *
 * Per-app subclasses only tweak what the generic walker can't know (e.g.
 * package-specific chrome to skip). Add a new dating app by subclassing and
 * registering it in [ChatReaderService].
 */
open class ChatParser(val appPackage: String) {

    /** Node class names / view IDs whose text is app chrome, never chat. */
    protected open val skipTextSubstrings: List<String> = listOf(
        "Type a message", "Message ", "Send", " • ", "Online", "Active ",
    )

    /** Max messages to keep (most recent). Oldest are dropped. */
    protected open val maxMessages: Int = 30

    data class Bubble(val text: String, val top: Int, val centerX: Int)

    open fun parse(root: AccessibilityNodeInfo?): String {
        if (root == null) return ""
        val bubbles = mutableListOf<Bubble>()
        collectBubbles(root, bubbles)
        if (bubbles.isEmpty()) return ""
        // Reading order: top to bottom.
        bubbles.sortBy { it.top }
        val screenWidth = root.boundsWidth()
        val recent = bubbles.takeLast(maxMessages)
        return recent.joinToString("\n") { b ->
            // Center on the right half of the screen => your bubble.
            val speaker = if (b.centerX > screenWidth / 2) "USER" else "MATCH"
            "[$speaker]: ${b.text}"
        }
    }

    private fun collectBubbles(node: AccessibilityNodeInfo, out: MutableList<Bubble>) {
        val text = node.text?.toString()?.trim().orEmpty()
        if (text.isNotEmpty() && node.childCount == 0 && !isChrome(text)) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            if (bounds.width() > 0 && bounds.height() > 0) {
                out.add(Bubble(text, bounds.top, bounds.centerX()))
            }
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { collectBubbles(it, out) }
        }
    }

    /**
     * Whole-text matches that are UI chrome, not chat (e.g. delivery
     * statuses). Exact match — unlike [skipTextSubstrings] — so that real
     * messages merely containing these words are never dropped.
     */
    protected open val skipExactTexts: Set<String> = emptySet()

    /**
     * Full-text patterns for chrome like locale date headers ("12/09/26").
     * Anchored patterns only — never unanchored, which would swallow real
     * messages.
     */
    protected open val skipPatterns: List<Regex> = emptyList()

    private fun isChrome(text: String): Boolean {
        if (text.length > 500) return true // bios / T&Cs walls, not chat
        if (skipExactTexts.any { it.equals(text, ignoreCase = true) }) return true
        if (skipPatterns.any { it.matches(text) }) return true
        return skipTextSubstrings.any { text.contains(it, ignoreCase = true) }
    }

    private fun AccessibilityNodeInfo.boundsWidth(): Int {
        val bounds = Rect()
        getBoundsInScreen(bounds)
        return bounds.width().coerceAtLeast(1)
    }

    companion object {
        fun forPackage(appPackage: String): ChatParser = when (appPackage) {
            "com.tinder" -> TinderParser()
            "co.hinge.app" -> HingeParser()
            "com.bumble.app" -> BumbleParser()
            "com.snapchat.android" -> SnapchatParser()
            "com.instagram.android" -> InstagramParser()
            "com.whatsapp" -> WhatsAppParser()
            else -> ChatParser(appPackage)
        }
    }
}

/** Tinder: chat input hint and match-profile headers differ; generic walk works. */
class TinderParser : ChatParser("com.tinder") {
    override val skipTextSubstrings = super.skipTextSubstrings + listOf(
        "Say something nice", "It's a Match", "Likes You",
    )
}

/** Hinge: prompt cards ("Most spontaneous thing") appear inline; skip them. */
class HingeParser : ChatParser("co.hinge.app") {
    override val skipTextSubstrings = super.skipTextSubstrings + listOf(
        "Send Like", "Your Turn", "Their Turn", "Prompts",
    )
}

/** Bumble: 24h timer banners and "She said" headers are chrome. */
class BumbleParser : ChatParser("com.bumble.app") {
    override val skipTextSubstrings = super.skipTextSubstrings + listOf(
        "Time left", "expires in", "Make the first move",
    )
}

/**
 * Snapchat: delivery statuses ("Delivered", "Opened"…) and date headers sit
 * as text under messages, so they are exact-matched (a real message merely
 * containing those words must survive). Multi-word CTAs are substring-safe.
 * Note: snaps/voice notes carry no text — only typed chat is captured, and
 * view-once messages are read only while visible on screen.
 */
class SnapchatParser : ChatParser("com.snapchat.android") {
    override val skipTextSubstrings = super.skipTextSubstrings + listOf(
        "Send a chat", "New Snap", "New Chat", "Tap to Chat", "is typing", "just now",
    )
    override val skipExactTexts = setOf(
        "Delivered", "Opened", "Received", "Sent", "Viewed",
        "Today", "Yesterday",
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    )
}

/**
 * Instagram: "Seen" receipts and the message-box hint are the main chrome.
 * Reaction labels are exact-matched. Suggested quick-reply chips are
 * deliberately NOT filtered — they look identical to short real messages,
 * so the user deletes the odd stray row instead of us risking real text.
 */
class InstagramParser : ChatParser("com.instagram.android") {
    override val skipTextSubstrings = super.skipTextSubstrings + listOf(
        "Send message", "Message...", "Active ",
    )
    override val skipExactTexts = setOf("Seen", "Liked")
}

/**
 * WhatsApp: message bubbles glue the timestamp into the same text node
 * ("Hello\n10:30 pm"), so timestamps are stripped per line after parsing.
 * Encryption notices, unread dividers, presence lines and caps date headers
 * are filtered. Voice notes and quoted blocks have no separable text — the
 * reply generator sees them as plain lines, same as everywhere else.
 */
class WhatsAppParser : ChatParser("com.whatsapp") {
    override val skipTextSubstrings = super.skipTextSubstrings + listOf(
        "end-to-end encrypted", "last seen", "UNREAD MESSAGE",
    )
    override val skipExactTexts = setOf(
        "online", "typing...", "typing…", "Message", "TODAY", "YESTERDAY",
    )
    override val skipPatterns = listOf(
        Regex("""\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"""), // locale date headers: 12/09/26
    )

    private val timeTail = Regex("""\s*\d{1,2}:\d{2}(\s?[AaPp][Mm])?\s*$""")

    override fun parse(root: AccessibilityNodeInfo?): String {
        return super.parse(root)
            .lineSequence()
            .map { it.replace(timeTail, "") }
            .filter { it.isNotBlank() }
            .joinToString("\n")
    }
}
