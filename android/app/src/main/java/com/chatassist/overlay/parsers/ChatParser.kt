package com.chatassist.overlay.parsers

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Turns an accessibility node tree from a dating-app chat screen into plain
 * conversation text, one message per line. Speaker attribution ([MATCH] /
 * [USER]) is best-effort: see each per-app subclass for its rule (position
 * vs sender labels). Anything uncertain keeps its best guess — the overlay
 * panel shows the captured rows so mislabels are visible, not silent.
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
     * True when this text could plausibly be a person's display name. Title
     * extraction guesses "topmost short text near the top", which during
     * calls is a banner, not a name — so non-names must be rejected here:
     * timers/clock times ("1:03:07 video call"), questions/exclamations
     * ("How was your call quality?"), sentences (6+ words), emoji-only
     * text, the app's own name ("Snapchat"), and call/status phrases
     * ("Video call", "This video is no longer available").
     */
    open fun isPlausibleTitle(text: String): Boolean {
        val t = text.trim()
        if (t.isEmpty() || t.length > 40) return false
        if (t.none { it.isLetter() }) return false
        if (Regex("""\d{1,2}:\d{2}""").containsMatchIn(t)) return false
        if (t.endsWith("?") || t.endsWith("!")) return false
        if (t.split(Regex("\\s+")).size >= 6) return false
        val lower = t.lowercase()
        if (NON_NAME_TITLES.contains(lower)) return false
        // Relative timestamps as headers ("4m ago", "2 days ago")
        if (Regex("""\d+\s*[smhdwy]\s*ago""", RegexOption.IGNORE_CASE).matches(t)) return false
        if (NON_NAME_PHRASES.any { lower.contains(it) }) return false
        return true
    }

    /**
     * Apps where a chat is meaningless without a real contact name: a
     * nameless capture would otherwise be filed under the bare package key,
     * merging unrelated chats into one junk row. Such captures are skipped
     * instead (the next event, once the header is readable, publishes).
     */
    open val requiresTitle: Boolean = false

    /**
     * Best-effort chat title: the topmost short, plausible-name, non-chrome
     * text in the top 15% of the screen (usually the contact's display name
     * in the app bar). Null when nothing qualifies — callers must fall back
     * to the package key rather than guessing (or skip, for
     * [requiresTitle] apps). Typing/presence lines are already chrome, so
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
            if (text.isNotEmpty() && node.childCount == 0 && text.length <= 60 &&
                !isChrome(text) && isPlausibleTitle(text)
            ) {
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

    /**
     * True when a visible text field looks like a chat input rather than
     * search. Conversation screens always have one; list/feed/status tabs
     * either have none or only a search box. This is the primary
     * list-screen gate — [isListScreen] stays as backup for odd screens.
     */
    open fun hasChatInput(root: AccessibilityNodeInfo?): Boolean {
        if (root == null) return false
        var found = false
        fun walk(node: AccessibilityNodeInfo) {
            if (!found && node.isEditable && node.isVisibleToUser) {
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                val hint = node.text?.toString().orEmpty() + " " +
                    node.contentDescription?.toString().orEmpty()
                if (bounds.height() > 0 && !hint.contains("search", ignoreCase = true)) {
                    found = true
                }
            }
            if (!found) {
                for (i in 0 until node.childCount) {
                    node.getChild(i)?.let { walk(it) }
                }
            }
        }
        walk(root)
        return found
    }

    /**
     * True when parsed text looks like a mid-transition frame (feed rows
     * mixed into the chat) rather than a clean conversation. Frames like
     * that must be dropped, not published — and must never clobber a clean
     * stored snapshot (see ChatBus.publish's heal rule).
     */
    open fun looksContaminated(text: String): Boolean = false

    /**
     * True when this looks like an app list/feed screen rather than an open
     * conversation (chat-list, Status/Calls tabs, Snapchat feed…). Those
     * screens fire the same content events, and without this gate every
     * contact row becomes a phantom "match". Real conversations are always
     * titled with a person's name; list screens carry generic headers.
     */
    open fun isListScreen(title: String?, text: String): Boolean =
        title?.trim()?.let { t ->
            GENERIC_SCREEN_TITLES.any { it.equals(t, ignoreCase = true) }
        } == true

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

        /** Generic list/feed headers — no real conversation is titled these. */
        private val GENERIC_SCREEN_TITLES = setOf(
            "Status", "Calls", "Updates", "Communities", "Locked chats",
            "Chat", "Discover", "Stories", "Spotlight", "Search", "Settings",
            "Camera", "Archived", "New Chat", "New Snap",
        )

        /** Exact (lowercased) texts that are app/UI names, never a person. */
        private val NON_NAME_TITLES = setOf(
            "snapchat", "whatsapp", "instagram", "tinder", "hinge", "bumble",
            "chat", "chats", "camera", "calls", "video call", "voice call",
            "call", "calling", "messages", "message", "online", "offline",
            // Snapchat settings/friends rows that get mistaken for contacts
            "email", "username", "phone number", "added me", "add friends",
            "add friend", "friends", "my friends", "new group", "mentions",
        )

        /** Fragments (lowercased) that mark call banners / status lines. */
        private val NON_NAME_PHRASES = listOf(
            "video call", "voice call", "call quality", "no longer available",
            "is calling", "calling…", "calling...", "ringing", "connecting",
            "reconnecting", "call ended", "missed call", "on a call", "tap to",
            "swipe", "unavailable", "loading", "typing",
        )
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
 * before. View-once/photo snaps carry no message text — their player chrome
 * (replay hints, lens attribution, view counts) collapses into a single
 * "(sent a snap — no text to read)" placeholder per sender instead of
 * leaking as phantom messages. View-once messages are read only while
 * visible on screen.
 */
/** Regions that can close a "City, Region" header line (Indian states/UTs, common countries). */
private val LOCATION_REGIONS = listOf(
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
    "Uttarakhand", "West Bengal", "Delhi", "Chandigarh", "Puducherry", "Jammu and Kashmir",
    "Ladakh", "Andaman and Nicobar", "Dadra and Nagar Haveli", "Daman and Diu", "Lakshadweep",
    "India", "USA", "UK", "Canada", "Australia", "UAE", "Pakistan", "Nepal", "Bangladesh",
    "Sri Lanka", "Singapore", "Dubai",
).map { Regex.escape(it) }

class SnapchatParser : ChatParser("com.snapchat.android") {
    override fun isListScreen(title: String?, text: String): Boolean {
        // "Let X know when you arrive safely" nudge only exists on the feed.
        if (text.contains("arrive safely", ignoreCase = true)) return true
        return super.isListScreen(title, text)
    }

    // A Snapchat chat with no readable contact name is never filed under the
    // bare package ("Snapchat" row) — skipped until the header is readable.
    override val requiresTitle: Boolean = true

    private val senderLabel = Regex("""^[A-Z][A-Z .'’-]*[A-Z.]$""")

    /**
     * The contact name, from the most trustworthy source available.
     * 1. A plausible header candidate that Snapchat ALSO repeats as a sender
     *    label inside the chat (all-caps above their messages) — the header
     *    and the label agreeing is near-proof it's the contact, and it
     *    beats call banners / timers / reactions sitting in the same spot.
     * 2. Otherwise the topmost-leftmost plausible header candidate.
     * 3. Otherwise the sender label itself, title-cased — during video calls
     *    the header region holds only call chrome, but the chat below still
     *    labels their messages with their name.
     * Null when none exist (caller skips the capture).
     */
    override fun extractTitle(root: AccessibilityNodeInfo?): String? {
        if (root == null) return null
        val screen = Rect()
        root.getBoundsInScreen(screen)
        if (screen.height() <= 0) return null
        val cutoff = (screen.height() * 0.25).toInt()
        val leaves = collectRawLeaves(root)

        val candidates = leaves
            .filter {
                it.top in 0..cutoff && it.text.length <= 60 &&
                    !isChrome(it.text) && isPlausibleTitle(it.text)
            }
            .sortedWith(compareBy({ it.top }, { it.centerX }))
        val labelled = candidates.firstOrNull { c ->
            leaves.any { it.top > cutoff && it.text.equals(c.text, ignoreCase = true) }
        }
        (labelled ?: candidates.firstOrNull())?.let { return it.text }

        val label = leaves.asSequence()
            .filter { it.top > cutoff }
            .map { it.text.trim() }
            .firstOrNull {
                it != "ME" && it.length in 3..40 && senderLabel.matches(it) &&
                    !isChrome(it) && isPlausibleTitle(it)
            } ?: return null
        return label.lowercase().split(' ').joinToString(" ") { w ->
            w.replaceFirstChar { c -> c.uppercase() }
        }
    }

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
    override val skipPatterns = listOf(
        // Message clock times ("11:04", "11:07 PM") sit under every bubble —
        // without this they become phantom message rows (and get mailed to
        // the LLM as things somebody "said").
        Regex("""\d{1,2}:\d{2}(:\d{2})?(\s?[AaPp][Mm])?"""),
        // Delivery receipts WITH a clock time ("Opened 16:00") — the bare
        // words are covered by skipExactTexts, but the timed variants would
        // otherwise become phantom rows. (They must die here and not in the
        // quote-header rule below, which would misread "Opened 16:00" as a
        // "NAME time" header and flip the NEXT line's speaker.)
        Regex("""(?i)^(delivered|opened|received|sent|viewed)\s+\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?$"""),
        // System banners for deleted chats: "YOGI JI DELETED A CHAT" and
        // "YOU DELETED A CHAT" are not messages.
        Regex("""(?i)^(.+ )?deleted a chat$"""),
        // Chat header subtitle chrome, read as messages when the header is in
        // the captured tree: a relative age ("18h", "3d") alone on a line...
        Regex("""(?i)^\d{1,3}\s*[smhdwy]$"""),
        // ...a date divider ("3 OCTOBER", "10 Oct") and the "TODAY" label.
        // Month names only, so replies like "2 baje" or "5 days" survive.
        Regex("""(?i)^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$"""),
        Regex("""(?i)^today$"""),
        // ...and the "City, State/Country" location line under the contact
        // name. Only known states, union territories and countries count, so
        // ordinary texts that happen to contain a comma ("Hi, Sonam") pass.
        Regex("""^[A-Z][a-z]+(?: [A-Z][a-z]+){0,2}, (?:${LOCATION_REGIONS.joinToString("|")})$"""),
    )

    // Feed-row fingerprints. Internal view IDs (avatar_container,
    // feed_muted_notification_icon…) and feed delivery ages ("Received 12h")
    // never occur inside a real conversation — when present, feed rows leaked
    // into the tree mid-transition and the whole frame is untrustworthy.
    private val contaminationId =
        Regex("""^[a-z][a-z0-9_]*(_container|_icon|_button|_view|_layout)$""")
    private val contaminationStatus =
        Regex("""(?i)^(delivered|opened|received|sent|viewed)\s+\d+\s*[mhd]$""")

    override fun looksContaminated(text: String): Boolean {
        return text.lineSequence().map { it.substringAfter("]:", it).trim() }.any { line ->
            contaminationId.matches(line) || contaminationStatus.matches(line) ||
                line.contains("arrive safely", ignoreCase = true)
        }
    }

    /**
     * Quoted replies come in two node shapes. Single-node ("SONAM THAKUR
     * 21:20" header + quoted text) and split-node, where Snapchat exposes
     * the header as separate leaves: a sender tag ("ME"), a standalone
     * clock time ("11:04"), then the quoted words — all nested inside the
     * quoter's own message group (see the white quote bubble). The split
     * shape is the dangerous one: without special handling, the inner "ME"
     * reads as a speaker switch and every message after it (e.g. her "Kyu" /
     * "Pagal ho") gets attributed to YOU. Both shapes drop the header and
     * tag the quoted line with its true author, so the following messages
     * keep the quoter's side.
     */
    private val quoteHeader = Regex("""^(?!DELIVERED\b|OPENED\b|RECEIVED\b|SENT\b|VIEWED\b)[A-Z][A-Z .]{1,30}\s+\d{1,2}:\d{2}$""")
    private val timeOnly = Regex("""\d{1,2}:\d{2}(:\d{2})?(\s?[AaPp][Mm])?""")

    /**
     * Snap-media chrome: view-once/photo rows expose no message text, only
     * player chrome ("Hold to replay or save"), lens attribution split
     * across leaves ("Purple Orchid" • "6.5B"), and internal IDs
     * ("snap_envelop"). Individually the lens name is indistinguishable from
     * chat — but a same-speaker run with 2+ of these markers and at most one
     * other line IS a media bubble, collapsed to one placeholder row below.
     */
    private val mediaCount = Regex("""^\d+(\.\d+)?[KMB]$""")
    private val mediaId = Regex("""^snap_envelope?$""")
    private val mediaPhrase =
        Regex("""^(hold to replay( or save)?|tap to view)$""", RegexOption.IGNORE_CASE)

    private fun isMediaMarker(text: String): Boolean =
        text == "•" || mediaCount.matches(text) || mediaId.matches(text) ||
            mediaPhrase.matches(text)

    /**
     * Lens/studio attribution ("Purple Orchid") vs a real photo caption.
     * Attribution is short and Title-Cased per word; Hindi-script or
     * sentence-case lines are captions and must survive. A 2-word Title-Case
     * caption ("Nice pic!") is the accepted residual — it collapses.
     */
    private fun isAttributionLike(text: String): Boolean {
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty() || words.size > 3) return false
        return words.all { w -> w[0] in 'A'..'Z' }
    }

    override fun parse(root: AccessibilityNodeInfo?): String {
        if (root == null) return ""
        return parseLeaves(collectRawLeaves(root), extractTitle(root))
    }

    /**
     * Pure parse over captured leaves and the header title: no Android screen
     * needed, so the parser can be tested with recorded fixtures.
     */
    fun parseLeaves(rawLeaves: List<Bubble>, rawTitle: String?): String {
        // Contact-name label candidates: the header name, plus its first
        // token ("Rakshaarya" for "Rakshaarya Arya"). Only trustworthy names
        // qualify — a too-short/too-generic title is ignored rather than
        // risk eating real messages.
        val title = rawTitle?.trim().orEmpty()
        val titleTokens = title.split(Regex("\\s+")).filter { it.length >= 2 }
        val useLabels = title.contains(" ") || title.length >= 4
        // Names are compared letters-only: Snapchat renders the contact label
        // as "LEENA 👩🏻" while the header reads "Leena 👩🏻" (emoji and spacing
        // differ), and an exact compare silently failed — every line under
        // that label then inherited the wrong speaker.
        fun letters(s: String): String = s.filter { it.isLetterOrDigit() }.lowercase()
        val titleKey = letters(title)
        val tokenKeys = titleTokens.map { letters(it) }.filter { it.length >= 2 }
        fun authorOf(name: String): String? =
            if (name.equals("ME", ignoreCase = true)) "USER"
            else if (useLabels && letters(name).length >= 2 &&
                (letters(name) == titleKey || tokenKeys.any { it == letters(name) })
            ) "MATCH"
            else null
        // Speaker labels stay case-SENSITIVE ("ME" only — a real message
        // reading exactly "me" must survive); header-name matching above is
        // case-insensitive since headers render all-caps.
        fun speakerOfLabel(text: String): String? =
            if (text == "ME") "USER" else authorOf(text)

        val leaves = rawLeaves.sortedBy { it.top }.map { it.text }
        // (speaker, body) in reading order; quoted bodies carry a "(quoted)"
        // prefix from the logic below.
        val rows = mutableListOf<Pair<String, String>>()
        var speaker: String? = null
        var quoteAuthor: String? = null
        var i = 0
        while (i < leaves.size) {
            val text = leaves[i]
            val label = speakerOfLabel(text)
            if (label != null) {
                // Split quoted-reply header (sender tag directly followed by
                // a standalone clock time): drop both, tag the next message
                // with the quoted author. A genuine label is always followed
                // by its message, never by a bare time (times sit UNDER
                // messages), so this can't misfire on normal rows.
                if (i + 1 < leaves.size && timeOnly.matches(leaves[i + 1])) {
                    quoteAuthor = label
                    i += 2
                } else {
                    speaker = label
                    // A fresh speaker label ends any pending quote (the quote
                    // bubble carried no text) — otherwise the tag would leak
                    // onto this group's first real message.
                    quoteAuthor = null
                    i += 1
                }
                continue
            }
            if (quoteHeader.matches(text)) {
                val name = text.replace(Regex("""\s+\d{1,2}:\d{2}$"""), "").trim()
                quoteAuthor = authorOf(name) ?: (speaker ?: "MATCH").let {
                    if (it == "USER") "MATCH" else "USER"
                }
                i += 1
                continue
            }
            // Standalone clock times (message timestamps) are chrome — but
            // only when NOT in header position (checked above first).
            if (isChrome(text)) {
                i += 1
                continue
            }
            // Snap envelope labels ("snap_envelope", also when they arrive as
            // a quoted reply) are media chrome, never a message: dropped here,
            // before the quote branch can wrap them as "(quoted) …".
            if (isMediaMarker(text)) {
                // The envelope IS the quoted bubble when a quote header came
                // before it: consume that pending quote here, or it leaks onto
                // the next real message and flips its speaker.
                quoteAuthor = null
                i += 1
                continue
            }
            val quoted = quoteAuthor
            quoteAuthor = null
            val sp = speaker ?: "MATCH"
            if (quoted != null) {
                rows.add(quoted to "(quoted) $text")
            } else {
                rows.add(sp to text)
            }
            i += 1
        }

        // Collapse snap-media bubbles: consecutive same-speaker rows with 2+
        // media markers and at most one other line become a single
        // placeholder (the leftover line is lens attribution, not chat).
        // Stray lone markers elsewhere are dropped as chrome.
        val out = mutableListOf<String>()
        var j = 0
        while (j < rows.size) {
            var k = j
            while (k < rows.size && rows[k].first == rows[j].first) k++
            val group = rows.subList(j, k)
            val markers = group.count { isMediaMarker(it.second) }
            val unknowns = group.filter { !isMediaMarker(it.second) }.map { it.second }
            if (markers >= 2 && unknowns.all { isAttributionLike(it) }) {
                out.add("[${group[0].first}]: (sent a snap — no text to read)")
            } else {
                for ((gsp, body) in group) {
                    if (!isMediaMarker(body)) out.add("[$gsp]: $body")
                }
            }
            j = k
        }
        return out.takeLast(maxMessages).joinToString("\n")
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
    /** Chat-list rows ("Locked chats", search bar…) appear as exact lines. */
    override fun isListScreen(title: String?, text: String): Boolean {
        if (super.isListScreen(title, text)) return true
        return text.lineSequence().map { it.substringAfter("]:", it).trim() }.any {
            it.equals("Locked chats", ignoreCase = true) ||
                it.equals("Ask Meta AI or Search", ignoreCase = true)
        }
    }

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
