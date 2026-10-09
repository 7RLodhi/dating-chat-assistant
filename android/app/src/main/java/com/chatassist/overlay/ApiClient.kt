package com.chatassist.overlay

import android.os.Handler
import android.os.Looper
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import org.json.JSONObject

data class SuggestionResult(
    val mood: String,
    val suggestions: List<SuggestionItem>,
)

/** One reply option with the tone the model assigned it (drives votes). */
data class SuggestionItem(
    val text: String,
    val tone: String,
)

/** Learned fact sheet about one match: one-line summary plus labeled rows. */
data class FactSheet(
    val summary: String,
    val rows: List<Pair<String, String>>,
)

/**
 * Minimal client for the suggestion backend (same contract as the web app's
 * /api/suggest). Zero dependencies: HttpURLConnection + org.json (bundled).
 * Always calls back on the main thread.
 */
object ApiClient {
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Reads a backend error body (usually {"error":"..."} from our API, or
     * platform HTML on infra failures) into a short human-readable suffix.
     * Without this every failure surfaced as a bare "HTTP 502" and backend
     * outages were undiagnosable from the phone.
     */
    private fun backendError(conn: HttpURLConnection, code: Int): String {
        val raw = runCatching {
            (conn.errorStream ?: conn.inputStream)
                .bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
        }.getOrDefault("").trim()
        if (raw.isEmpty() || raw.startsWith("<")) return "HTTP $code"
        val msg = runCatching { JSONObject(raw).optString("error").trim() }
            .getOrDefault("").ifEmpty { raw }
        val short = if (msg.length > 220) msg.take(220) + "…" else msg
        return "HTTP $code: $short"
    }

    fun fetchSuggestions(
        backendUrl: String,
        conversationText: String,
        tone: String,
        mode: String = "reply",
        profileText: String = "",
        matchName: String = "",
        callback: (Result<SuggestionResult>) -> Unit,
        tasteProfile: String = "",
        userGender: String = "",
        styleExamples: String = "",
        userName: String = "",
    ) {
        Thread {
            try {
                val body = JSONObject()
                    .put("mode", mode)
                    .put("conversationText", conversationText)
                    .put("tone", tone)
                    .put("goal", "keep_it_light")
                    .put("language", "auto")
                    .put("profileText", profileText)
                    .put("matchName", matchName)
                    .put("tasteProfile", tasteProfile)
                    .put("userGender", userGender)
                    .put("styleExamples", styleExamples)
                    .put("userName", userName)
                    .toString()

                val conn = (URL(backendUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    connectTimeout = 15000
                    // Suggestions can take 8-12s normally and ~2x that when
                    // the server runs its grammar-retry pass — 15s timed out
                    // healthy requests. 45s fails only on real outages.
                    readTimeout = 45000
                    doOutput = true
                }
                OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body) }

                val code = conn.responseCode
                if (code !in 200..299) {
                    throw IllegalStateException("Backend returned ${backendError(conn, code)}")
                }
                val text = BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8))
                    .use { it.readText() }
                val json = JSONObject(text)

                val mood = json.optJSONObject("conversation_read")?.optString("summary").orEmpty()
                val suggestions = mutableListOf<SuggestionItem>()
                val arr = json.optJSONArray("suggestions")
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        val o = arr.optJSONObject(i) ?: continue
                        val text = o.optString("text")?.takeIf { it.isNotBlank() } ?: continue
                        val tone = o.optString("tone", "casual").takeIf { it.isNotBlank() } ?: "casual"
                        suggestions.add(SuggestionItem(text, tone))
                    }
                }
                if (suggestions.isEmpty()) throw IllegalStateException("Backend returned no suggestions")
                mainHandler.post { callback(Result.success(SuggestionResult(mood, suggestions))) }
            } catch (e: Exception) {
                mainHandler.post { callback(Result.failure(e)) }
            }
        }.start()
    }

    /**
     * Fetches the learned fact sheet for one chat (same contract as the web
     * app's /api/facts). `previousFacts` enables incremental merging —
     * pass the stored sheet back so new details merge instead of replacing.
     */
    fun fetchFacts(
        backendUrl: String,
        conversationText: String,
        previousFacts: JSONObject?,
        callback: (Result<Pair<JSONObject, FactSheet>>) -> Unit,
        bio: String = "",
    ) {
        Thread {
            try {
                val factsUrl = if (backendUrl.endsWith("/api/suggest")) {
                    backendUrl.removeSuffix("/api/suggest") + "/api/facts"
                } else {
                    "$backendUrl/api/facts"
                }
                val body = JSONObject()
                    .put("bio", bio)
                    .put("conversationText", conversationText)
                if (previousFacts != null) body.put("previousFacts", previousFacts)

                val conn = (URL(factsUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    connectTimeout = 15000
                    readTimeout = 40000
                    doOutput = true
                }
                OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body.toString()) }

                val code = conn.responseCode
                if (code !in 200..299) {
                    throw IllegalStateException("Backend returned ${backendError(conn, code)}")
                }
                val json = JSONObject(
                    BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8))
                        .use { it.readText() }
                )
                mainHandler.post { callback(Result.success(json to buildFactSheet(json))) }
            } catch (e: Exception) {
                mainHandler.post { callback(Result.failure(e)) }
            }
        }.start()
    }

    /** Learned writing-voice profile: one-line summary plus traits. */
    data class StyleProfile(
        val summary: String,
        val traits: List<String>,
    )

    /**
     * Analyzes sample messages into a writing-voice profile (same contract
     * as the web app's /api/style, which the web StylePanel uses).
     */
    fun analyzeStyle(
        backendUrl: String,
        samples: String,
        callback: (Result<StyleProfile>) -> Unit,
    ) {
        Thread {
            try {
                val styleUrl = if (backendUrl.endsWith("/api/suggest")) {
                    backendUrl.removeSuffix("/api/suggest") + "/api/style"
                } else {
                    "$backendUrl/api/style"
                }
                val body = JSONObject()
                    .put("sampleMessages", samples)
                    .toString()

                val conn = (URL(styleUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    connectTimeout = 15000
                    readTimeout = 45000
                    doOutput = true
                }
                OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body.toString()) }

                val code = conn.responseCode
                if (code !in 200..299) {
                    throw IllegalStateException("Backend returned ${backendError(conn, code)}")
                }
                val json = JSONObject(
                    BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8))
                        .use { it.readText() }
                )
                val summary = json.optString("summary", "").trim()
                if (summary.isEmpty()) throw IllegalStateException("Backend returned no analysis")
                val traits = (0 until (json.optJSONArray("traits")?.length() ?: 0)).mapNotNull {
                    json.optJSONArray("traits")?.optString(it)?.trim()?.takeIf { s -> s.isNotEmpty() }
                }
                mainHandler.post { callback(Result.success(StyleProfile(summary, traits))) }
            } catch (e: Exception) {
                mainHandler.post { callback(Result.failure(e)) }
            }
        }.start()
    }

    private fun JSONObject.str(key: String): String = optString(key, "").trim()

    private fun JSONObject.strList(key: String): String {
        val arr = optJSONArray(key) ?: return ""
        return (0 until arr.length())
            .mapNotNull { arr.optString(it)?.trim()?.takeIf { s -> s.isNotEmpty() } }
            .joinToString(", ")
    }

    private fun displayAge(json: JSONObject): String {
        val stated = json.str("age")
        if (stated.isNotEmpty()) return stated
        return try {
            val dob = java.time.LocalDate.parse(json.str("dob"))
            java.time.Period.between(dob, java.time.LocalDate.now()).years.toString()
        } catch (_: Exception) {
            ""
        }
    }

    private fun occupationLine(json: JSONObject): String {
        fun s(key: String) = json.str(key)
        return when (s("occupationType")) {
            "student" -> when (s("educationLevel")) {
                "school" -> "Student" +
                    (if (s("schoolClass").isNotEmpty()) " — ${s("schoolClass")} grade" else "") +
                    (if (s("schoolStream").isNotEmpty()) ", ${s("schoolStream")}" else "")
                "college" -> {
                    val parts = listOf(s("collegeYear"), s("degree")).filter { it.isNotEmpty() }
                    "Student" +
                        (if (parts.isNotEmpty()) " — ${parts.joinToString(" ")}" else "") +
                        (if (s("branch").isNotEmpty()) " in ${s("branch")}" else "")
                }
                else -> "Student"
            }
            "professional" -> {
                val role = listOf(
                    s("jobRole"),
                    if (s("company").isNotEmpty()) "at ${s("company")}" else "",
                ).filter { it.isNotEmpty() }.joinToString(" ")
                (if (role.isNotEmpty()) role else "Working professional") +
                    (if (s("jobLocation").isNotEmpty()) " (${s("jobLocation")})" else "")
            }
            else -> {
                // The model sometimes returns a job without classifying it
                // (occupationType blank): still show what it found rather
                // than a blank Occupation row.
                listOf(
                    s("jobRole"),
                    if (s("company").isNotEmpty()) "at ${s("company")}" else "",
                ).filter { it.isNotEmpty() }.joinToString(" ")
            }
        }
    }

    /** Rebuilds display rows from stored fact JSON (same output as fetch). */
    fun buildFactSheet(json: JSONObject): FactSheet {
        val rows = mutableListOf<Pair<String, String>>()
        fun add(label: String, value: String) {
            if (value.isNotEmpty()) rows.add(label to value)
        }
        add("Age", displayAge(json))
        add("Location", json.str("location"))
        add("Occupation", occupationLine(json))
        add("Hobbies", json.strList("hobbies"))
        add("Taste", json.strList("taste"))
        add("Surprises", json.str("surprises"))
        add("Dreams", json.strList("dreams"))
        add("Wishlist", json.strList("wishlist"))
        add("Fantasies", json.strList("fantasies"))
        add("Other", json.strList("other"))
        return FactSheet(summary = json.str("summary"), rows = rows)
    }

    /** The learned sheet as plain profile text — what opening questions are built from. */
    fun factsProfileText(json: JSONObject): String {
        val sheet = buildFactSheet(json)
        return (listOf(sheet.summary) + sheet.rows.map { "${it.first}: ${it.second}" })
            .filter { it.isNotBlank() }
            .joinToString("\n")
    }
}
