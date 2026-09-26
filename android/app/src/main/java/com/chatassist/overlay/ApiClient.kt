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
    val suggestions: List<String>,
)

/**
 * Minimal client for the suggestion backend (same contract as the web app's
 * /api/suggest). Zero dependencies: HttpURLConnection + org.json (bundled).
 * Always calls back on the main thread.
 */
object ApiClient {
    private val mainHandler = Handler(Looper.getMainLooper())

    fun fetchSuggestions(
        backendUrl: String,
        conversationText: String,
        tone: String,
        callback: (Result<SuggestionResult>) -> Unit,
    ) {
        Thread {
            try {
                val body = JSONObject()
                    .put("mode", "reply")
                    .put("conversationText", conversationText)
                    .put("tone", tone)
                    .put("goal", "keep_it_light")
                    .put("language", "auto")
                    .toString()

                val conn = (URL(backendUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    connectTimeout = 15000
                    readTimeout = 15000
                    doOutput = true
                }
                OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body) }

                val code = conn.responseCode
                if (code !in 200..299) {
                    throw IllegalStateException("Backend returned HTTP $code")
                }
                val text = BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8))
                    .use { it.readText() }
                val json = JSONObject(text)

                val mood = json.optJSONObject("conversation_read")?.optString("summary").orEmpty()
                val suggestions = mutableListOf<String>()
                val arr = json.optJSONArray("suggestions")
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        arr.optJSONObject(i)?.optString("text")?.takeIf { it.isNotBlank() }?.let {
                            suggestions.add(it)
                        }
                    }
                }
                if (suggestions.isEmpty()) throw IllegalStateException("Backend returned no suggestions")
                mainHandler.post { callback(Result.success(SuggestionResult(mood, suggestions))) }
            } catch (e: Exception) {
                mainHandler.post { callback(Result.failure(e)) }
            }
        }.start()
    }
}
