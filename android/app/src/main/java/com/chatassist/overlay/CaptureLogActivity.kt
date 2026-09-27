package com.chatassist.overlay

import android.content.ClipData
import android.content.ClipboardManager
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Debug view: the exact captured text per chat — byte-for-byte what the
 * reader extracted and what the backend receives. Tap a card to copy its
 * raw text (e.g. to send to the developer when attribution looks wrong).
 */
class CaptureLogActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_capture_log)
        ChatBus.setAppContext(this)
    }

    override fun onResume() {
        super.onResume()
        ChatBus.loadFromPrefs()
        render()
    }

    private fun render() {
        val list = findViewById<LinearLayout>(R.id.captureList)
        list.removeAllViews()
        val chats = ChatBus.all()
        if (chats.isEmpty()) {
            list.addView(TextView(this).apply {
                text = "Nothing captured yet — open a conversation in a supported app."
                textSize = 13f
                setTextColor(getColor(android.R.color.darker_gray))
            })
            return
        }
        val fmt = SimpleDateFormat("HH:mm, dd MMM", Locale.getDefault())
        for ((key, s) in chats) {
            val flags = buildList {
                if (s.factsJson != null) add("summary")
                if (s.suggestItems.isNotEmpty()) add("suggestions")
                if (s.userNote != null) add("note")
                if (s.speakerFixes.isNotEmpty()) {
                    add("${s.speakerFixes.values.sumOf { it.size }} speaker fixes")
                }
            }.joinToString(", ").ifEmpty { "no extras" }
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(16, 12, 16, 12)
            }
            card.addView(TextView(this).apply {
                text = ChatBus.labelFor(key, s)
                textSize = 15f
                setTextColor(getColor(R.color.ink))
            }.also { it.setTypeface(it.typeface, android.graphics.Typeface.BOLD) })
            card.addView(TextView(this).apply {
                text = "${fmt.format(Date(s.at))} • ${s.text.length} chars • $flags • tap to copy"
                textSize = 11f
                setTextColor(getColor(android.R.color.darker_gray))
            })
            card.addView(TextView(this).apply {
                text = s.text
                textSize = 12f
                setPadding(0, 6, 0, 0)
                setTextColor(getColor(android.R.color.black))
                setTextIsSelectable(true)
            })
            card.setOnClickListener {
                val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("capture", "KEY: $key\n${s.text}"))
                Toast.makeText(this, "Raw capture copied", Toast.LENGTH_SHORT).show()
            }
            list.addView(card)
        }
    }
}
