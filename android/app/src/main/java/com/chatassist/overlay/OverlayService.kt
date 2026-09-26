package com.chatassist.overlay

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat

/**
 * Foreground service hosting the floating bubble + suggestion panel.
 * Flow: user taps the bubble (or Refresh) -> latest text from [ChatBus] is
 * sent to the suggestion backend -> results render as tappable cards; tap a
 * card to copy it, then paste it into the dating app yourself. The app never
 * types or sends anything into other apps.
 */
class OverlayService : Service() {

    companion object {
        const val ACTION_START = "com.chatassist.overlay.START"
        private const val NOTIF_ID = 1
        private const val CHANNEL_ID = "bubble"
    }

    private lateinit var windowManager: WindowManager
    private var bubble: View? = null
    private var panel: View? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var panelParams: WindowManager.LayoutParams? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())
        if (bubble == null) showBubble()
        return START_STICKY
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notif_channel_name),
                NotificationManager.IMPORTANCE_MIN,
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notif_text))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun showBubble() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val inflater = LayoutInflater.from(this)
        bubble = inflater.inflate(R.layout.overlay_bubble, null)

        bubbleParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 300
        }

        var downX = 0
        var downY = 0
        var startX = 0
        var startY = 0
        var moved = false
        bubble!!.setOnTouchListener { _, event ->
            val p = bubbleParams ?: return@setOnTouchListener false
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX.toInt()
                    downY = event.rawY.toInt()
                    startX = p.x
                    startY = p.y
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX.toInt() - downX
                    val dy = event.rawY.toInt() - downY
                    if (dx * dx + dy * dy > 100) moved = true
                    p.x = startX + dx
                    p.y = startY + dy
                    windowManager.updateViewLayout(bubble, p)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) togglePanel()
                    true
                }
                else -> false
            }
        }
        windowManager.addView(bubble, bubbleParams)
    }

    private fun togglePanel() {
        if (panel != null) {
            windowManager.removeView(panel)
            panel = null
            return
        }
        val inflater = LayoutInflater.from(this)
        panel = inflater.inflate(R.layout.overlay_panel, null)
        panelParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // Focusable so the panel's buttons receive taps.
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            val bp = bubbleParams
            x = (bp?.x ?: 0) + 130
            y = (bp?.y ?: 300)
        }
        panel!!.findViewById<Button>(R.id.btnClose).setOnClickListener { togglePanel() }
        panel!!.findViewById<Button>(R.id.btnRefresh).setOnClickListener { loadSuggestions() }
        windowManager.addView(panel, panelParams)
        loadSuggestions()
    }

    private fun loadSuggestions() {
        val panelView = panel ?: return
        val moodText = panelView.findViewById<TextView>(R.id.moodText)
        val list = panelView.findViewById<LinearLayout>(R.id.suggestionList)
        val text = ChatBus.latestText
        if (text.isBlank()) {
            moodText.text = "No chat text captured yet — open a conversation in a supported dating app."
            return
        }
        moodText.text = "Thinking…"
        list.removeAllViews()
        ApiClient.fetchSuggestions(
            Prefs.backendUrl(this),
            text,
            Prefs.tone(this),
        ) { result ->
            result.fold(
                onSuccess = { r ->
                    moodText.text = r.mood.ifBlank { "Suggestions ready — tap one to copy." }
                    for (s in r.suggestions.take(5)) {
                        val card = TextView(this).apply {
                            this.text = s
                            textSize = 14f
                            setPadding(20, 16, 20, 16)
                            setTextColor(getColor(android.R.color.black))
                        }
                        card.setOnClickListener {
                            copyToClipboard(s)
                            Toast.makeText(this, "Copied — paste it into your chat", Toast.LENGTH_SHORT).show()
                        }
                        list.addView(card)
                    }
                },
                onFailure = { e ->
                    moodText.text = "Couldn't load suggestions: ${e.message}"
                },
            )
        }
    }

    private fun copyToClipboard(text: String) {
        val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
        cm.setPrimaryClip(android.content.ClipData.newPlainText("suggestion", text))
    }

    override fun onDestroy() {
        bubble?.let { runCatching { windowManager.removeView(it) } }
        panel?.let { runCatching { windowManager.removeView(it) } }
        bubble = null
        panel = null
        super.onDestroy()
    }
}
