package com.chatassist.overlay.parsers

import com.chatassist.overlay.parsers.ChatParser.Bubble
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Snapchat parser regression tests over recorded fixtures. Each fixture is a
 * synthetic screen: one line per on-screen text node, "position<TAB>text",
 * with the header title on the first line. Add a fixture for every bug found
 * on a real screen, then pin the expected output here.
 */
class SnapchatParserFixtureTest {

    private val parser = SnapchatParser()

    private fun run(name: String): String {
        val lines = javaClass.classLoader!!
            .getResource("fixtures/snapchat/$name")!!
            .readText(Charsets.UTF_8)
            .lines()
            .filter { it.isNotBlank() }
        val title = lines.first().substringAfter("\t").trim()
        val leaves = lines.drop(1).map { line ->
            val (top, text) = line.split("\t", limit = 2)
            Bubble(text, top.trim().toInt(), centerX = 540)
        }
        return parser.parseLeaves(leaves, title)
    }

    @Test
    fun emojiLabelMatchesHeaderAndMeGroupStaysYours() {
        // Regression (0.62/0.63): the label "ALEX 👩🏻" must match the header
        // "Alex 👩🏻", and lines under the ME label must stay yours.
        assertEquals(
            listOf(
                "[MATCH]: Hey, how was your day",
                "[MATCH]: Good, you?",
                "[USER]: Hm",
                "[USER]: मैडम जी, Aap insta ya WhatsApp kahi to hogi yaar?",
                "[MATCH]: Ha",
            ).joinToString("\n"),
            run("label_emoji_me_group.tsv"),
        )
    }

    @Test
    fun headerChromeIsDroppedButRealTextSurvives() {
        // Regression (0.58): age, date divider, TODAY and "City, State" are
        // header chrome; "Hi, Sonam" and "snap envelope nahi aaya" are text.
        assertEquals(
            listOf(
                "[MATCH]: Hi, Sonam",
                "[USER]: Sure, call me",
                "[MATCH]: snap envelope nahi aaya",
            ).joinToString("\n"),
            run("header_chrome.tsv"),
        )
    }

    @Test
    fun envelopeAfterQuoteDoesNotLeakTheQuoteOntoNextMessage() {
        // Regression (0.61/0.62): a skipped snap envelope must clear the
        // pending quote, or "Okay" would be filed as a quoted reply.
        assertEquals(
            listOf(
                "[MATCH]: Are you there?",
                "[USER]: (quoted) Yes, sorry",
                "[MATCH]: Okay",
            ).joinToString("\n"),
            run("quote_then_envelope.tsv"),
        )
    }
}
