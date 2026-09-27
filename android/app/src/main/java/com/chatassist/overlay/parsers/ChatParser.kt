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
        // Our own overlay panel strings — defense-in-depth alongside the
        // reader's active-window package check, so panel text can never be
        // mistaken for chat even if window focus misbehaves.
        "Suggestions ready", "No chat text captured yet", "Thinking…",
        "Thinking of openers…", "Learning summary…", "Tap one to copy",
        "Couldn't load suggestions", "Couldn't load summary",
        "Couldn't find the chat box", "Pasted into chat", "Copied — paste",
        "Load summary", "Tap for chat + summary", "Tap to collapse",
    )

    /** Max messages to keep (most recent). Oldest are dropped. */
    protected open val maxMessages: Int = 30

    data class Bubble(val text: String, val top: Int, val centerX: Int)

    open fun parse(root: AccessibilityNodeInfo?): String {
        if (root == null) return ""
        val bubbles = collectLeaves(root).toMutableList()
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

    /** Raw leaf texts with geometry, unfiltered — subclasses needing label
     * context (e.g. sender tags) walk this and filter themselves. */
    protected fun collectRawLeaves(root: AccessibilityNodeInfo): List<Bubble> {
        val out = mutableListOf<Bubble>()
        collectRaw(root, out)
        return out
    }

    /** Leaf texts minus UI chrome, unsorted. */
    protected fun collectLeaves(root: AccessibilityNodeInfo): List<Bubble> {
        val out = mutableListOf<Bubble>()
        collectRaw(root, out)
        return out.filterNot { isChrome(it.text) }
    }

    private fun collectRaw(node: AccessibilityNodeInfo, out: MutableList<Bubble>) {
        val text = node.text?.toString()?.trim().orEmpty()
        if (text.isNotEmpty() && node.childCount == 0) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            if (bounds.width() > 0 && bounds.height() > 0) {
                out.add(Bubble(text, bounds.top, bounds.centerX()))
            }
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { collectRaw(it, out) }
        }
    }

    /**
     * Whole-text matches that are UI chrome, not chat (e.g. delivery
     * statuses). Exact match — unlike [skipTextSubstrings] — so that real
     * messages merely containing these words are never dropped.
     */
    protected open val skipExactTexts: Set<String> = emptySet()

    /**
     * Same as [skipExactTexts] but case-SENSITIVE, for labels like Snapchat's
     * all-caps "ME" self-tag (a real message reading exactly "ME" is near
     * nonexistent, while lowercase "me" as a reply must survive).
     */
    protected open val skipExactCaseSensitive: Set<String> = emptySet()

    /**
     * Full-text patterns for chrome like locale date headers ("12/09/26").
     * Anchored patterns only — never unanchored, which would swallow real
     * messages.
     */
    protected open val skipPatterns: List<Regex> = emptyList()

    protected fun isChrome(text: String): Boolean {
        if (text.length > 500) return true // bios / T&Cs walls, not chat
        if (skipExactTexts.any { it.equals(text, ignoreCase = true) }) return true
        if (skipExactCaseSensitive.any { it == text }) return true
        if (skipPatterns.any { it.matches(text) }) return true
        return skipTextSubstrings.any { text.contains(it, ignoreCase = true) }
    }

    private fun AccessibilityNodeInfo.boundsWidth(): Int {
        val bounds = Rect()
        getBoundsInScreen(bounds)
        return bounds.width().coerceAtLeast(1)
    }

    /**
     * Best-effort chat title: the topmost short, non-chrome text in the top
     * 15% of the screen (usually the contact's display name in the app bar).
     * Null when nothing qualifies — callers must fall back to the package
     * key rather than guessing. Typing/presence lines are already chrome, so
     * a "typing…" header never becomes a title.
     */
    open fun extractTitle(root: AccessibilityNodeInfo?): String? {
        if (root == null) return null
        val screen = Rect()
        root.getBoundsInScreen(screen)
        if (screen.height() <= 0) return null
        val cutoff = (screen.height() * 0.15).toInt()
        var best: String? = null
        var bestTop = Int.MAX_VALUE
        fun walk(node: AccessibilityNodeInfo) {
            val text = node.text?.toString()?.trim().orEmpty()
            if (text.isNotEmpty() && node.childCount == 0 && text.length <= 60 && !isChrome(text)) {
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                if (bounds.top in 0..cutoff && bounds.top < bestTop) {
                    bestTop = bounds.top
                    best = text
                }
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { walk(it) }
            }
        }
        walk(root)
        return best
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
 * Snapchat lays chat out as a SINGLE column with sender labels ("ME" above
 * your messages, the contact's display name above theirs) — there are no
 * left/right bubbles, so position-based attribution (correct on every other
 * app) mislabels the whole conversation here. This parser attributes by
 * label instead: "ME" means you, a line matching the header's contact name
 * means the match. Delivery statuses and date headers are filtered as
 * before. Note: snaps/voice notes carry no text — only typed chat is
 * captured, and view-once messages are read only while visible on screen.
 */
class SnapchatParser : ChatParser("com.snapchat.android") {
    override val skipTextSubstrings = super.skipTextSubstrings + listOf(
        "Send a chat", "New Snap", "New Chat", "Tap to Chat", "is typing", "just now",
        "Enable notifications", "Don't miss", "notification_cta_button",
    )
    override val skipExactTexts = setOf(
        "Delivered", "Opened", "Received", "Sent", "Viewed",
        "Today", "Yesterday",
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    )
    // "ME" is consumed as a speaker label by parse() below (never emitted),
    // so it stays out of the generic skip set on purpose.
    override val skipExactCaseSensitive: Set<String> = emptySet()

    /**
     * Quoted replies ("SONAM THAKUR 21:20" header + quoted text): drop the
     * header and re-attribute the quoted line to the OTHER speaker, mirroring
     * the screenshot-OCR rule. Without this, your reply ("Software
     * developer") and their quoted question merge into one side and
     * suggestions end up asking about YOUR facts.
     */
    private val quoteHeader = Regex("""^[A-Z][A-Z .]{1,30}\s+\d{1,2}:\d{2}$""")

    override fun parse(root: AccessibilityNodeInfo?): String {
        if (root == null) return ""
        // Contact-name label candidates: the header name, plus its first
        // token ("Rakshaarya" for "Rakshaarya Arya"). Only trustworthy names
        // qualify — a too-short/too-generic title is ignored rather than
        // risk eating real messages.
        val title = extractTitle(root)?.trim().orEmpty()
        val titleTokens = title.split(Regex("\\s+")).filter { it.length >= 2 }
        val isLabelName = { text: String ->
            text.equals(title, ignoreCase = true) ||
                titleTokens.any { tok -> text.equals(tok, ignoreCase = true) }
        }
        val useLabels = title.contains(" ") || title.length >= 4

        val rows = mutableListOf<Pair<String, String>>()
        var speaker: String? = null
        for (b in collectRawLeaves(root).sortedBy { it.top }) {
            val text = b.text
            if (text == "ME") {
                speaker = "USER"
                continue
            }
            if (useLabels && isLabelName(text)) {
                speaker = "MATCH"
                continue
            }
            if (isChrome(text)) continue
            rows.add((speaker ?: "MATCH") to text)
        }

        val out = mutableListOf<String>()
        var flipNext = false
        for ((sp, text) in rows) {
            if (quoteHeader.matches(text)) {
                flipNext = true
                continue
            }
            if (flipNext) {
                flipNext = false
                val other = if (sp == "USER") "MATCH" else "USER"
                out.add("[$other]: (quoted) $text")
            } else {
                out.add("[$sp]: $text")
            }
        }
        return out.takeLast(maxMessages).joinToString("\n") { it }
    }
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
