package com.chatassist.overlay

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * One match's full detail: learned summary on top, hand-added profile
 * details in the middle, captured chat rows last. Reads and writes the same
 * [ChatBus] snapshot the overlay panel uses, so a summary loaded (or a note
 * saved) here shows up in the panel too, and vice versa.
 */
class MatchDetailActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_KEY = "chat_key"
    }

    private lateinit var key: String
    private lateinit var titleView: TextView
    private lateinit var summaryBox: LinearLayout
    private lateinit var noteEdit: EditText
    private lateinit var chatBox: LinearLayout

    private var loadingFacts = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_match_detail)
        ChatBus.setAppContext(this)

        key = intent.getStringExtra(EXTRA_KEY).orEmpty()
        if (key.isBlank() || ChatBus.get(key) == null) {
            finish()
            return
        }

        titleView = findViewById(R.id.detailTitle)
        summaryBox = findViewById(R.id.detailSummary)
        noteEdit = findViewById(R.id.detailNoteEdit)
        chatBox = findViewById(R.id.detailChat)

        findViewById<Button>(R.id.btnDetailLoadSummary).setOnClickListener {
            loadSummary()
        }
        findViewById<Button>(R.id.btnDetailSaveNote).setOnClickListener {
            ChatBus.updateNote(key, noteEdit.text.toString().trim())
            Toast.makeText(this, "Saved — used in future summaries", Toast.LENGTH_SHORT).show()
            renderSummary()
        }
    }

    override fun onResume() {
        super.onResume()
        ChatBus.loadFromPrefs()
        if (ChatBus.get(key) == null) {
            finish()
            return
        }
        renderAll()
    }

    private fun renderAll() {
        val snapshot = ChatBus.get(key) ?: return
        titleView.text = ChatBus.labelFor(key, snapshot)
        // Don't clobber typing: only refill when the editor isn't focused.
        if (!noteEdit.hasFocus()) noteEdit.setText(snapshot.userNote.orEmpty())
        renderSummary()
        renderChat()
    }

    private fun sectionSmall(text: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 12f
        setTextColor(getColor(android.R.color.darker_gray))
    }

    private fun renderSummary() {
        summaryBox.removeAllViews()
        val snapshot = ChatBus.get(key) ?: return
        val note = snapshot.userNote.orEmpty()
        if (note.isNotBlank()) {
            summaryBox.addView(TextView(this).apply {
                text = "Your notes"
                textSize = 11f
                setTextColor(getColor(android.R.color.darker_gray))
            })
            summaryBox.addView(TextView(this).apply {
                text = note
                textSize = 13f
                setTextColor(getColor(android.R.color.black))
                setPadding(0, 0, 0, 6)
            })
        }
        val raw = snapshot.factsJson
        if (raw.isNullOrBlank()) {
            summaryBox.addView(sectionSmall("No summary yet — tap Load summary. Same learned sheet as the overlay panel."))
            return
        }
        val sheet = runCatching { ApiClient.buildFactSheet(JSONObject(raw)) }.getOrNull()
        if (sheet == null || (sheet.summary.isBlank() && sheet.rows.isEmpty())) {
            summaryBox.addView(sectionSmall("Saved summary looks empty — tap Load summary to retry."))
            return
        }
        if (sheet.summary.isNotBlank()) {
            summaryBox.addView(TextView(this).apply {
                text = sheet.summary
                textSize = 13f
                setTextColor(getColor(android.R.color.black))
                setPadding(0, 0, 0, 6)
            })
        }
        for ((label, value) in sheet.rows) {
            summaryBox.addView(TextView(this).apply {
                text = label
                textSize = 11f
                setTextColor(getColor(android.R.color.darker_gray))
            })
            summaryBox.addView(TextView(this).apply {
                text = value
                textSize = 13f
                setTextColor(getColor(android.R.color.black))
                setPadding(0, 0, 0, 4)
            })
        }
    }

    private fun renderChat() {
        chatBox.removeAllViews()
        val snapshot = ChatBus.get(key) ?: return
        val lines = snapshot.text.lineSequence().map { it.trim() }
            .filter { it.isNotEmpty() }.toList().takeLast(30)
        if (lines.isEmpty()) {
            chatBox.addView(sectionSmall("No chat text captured yet."))
            return
        }
        for (line in lines) {
            val upper = line.uppercase()
            val isUser = upper.startsWith("[USER]")
            val isMatch = upper.startsWith("[MATCH]")
            val body = if (isUser || isMatch) line.substringAfter("]:", line).trim() else line
            if (body.isEmpty()) continue
            chatBox.addView(TextView(this).apply {
                text = if (isUser) "You: $body" else "Match: $body"
                textSize = 13f
                setPadding(4, 2, 4, 2)
                setTextColor(
                    if (isUser) getColor(android.R.color.holo_blue_dark)
                    else getColor(android.R.color.black)
                )
            })
        }
    }

    /** Same shared snapshot — the panel reads what this stores. */
    private fun loadSummary() {
        if (loadingFacts) return
        val snapshot = ChatBus.get(key)
        val text = snapshot?.text.orEmpty()
        if (text.isBlank()) {
            summaryBox.removeAllViews()
            summaryBox.addView(sectionSmall("No chat text to learn from yet."))
            return
        }
        val stored = snapshot?.factsJson
        if (!stored.isNullOrBlank() && snapshot?.factsText == text) {
            renderSummary()
            return
        }
        loadingFacts = true
        summaryBox.removeAllViews()
        summaryBox.addView(sectionSmall("Learning summary…"))
        val previous = stored?.let { runCatching { JSONObject(it) }.getOrNull() }
        ApiClient.fetchFacts(
            Prefs.backendUrl(this), text, previous,
            callback = { result ->
                loadingFacts = false
                result.fold(
                    onSuccess = { (json, _) ->
                        ChatBus.updateFacts(key, json.toString(), text)
                        if (!isFinishing && !isDestroyed) renderSummary()
                    },
                    onFailure = { e ->
                        summaryBox.removeAllViews()
                        summaryBox.addView(sectionSmall("Couldn't load summary: ${e.message} — retry with Load summary."))
                    },
                )
            },
            bio = snapshot?.userNote.orEmpty(),
        )
    }
}
