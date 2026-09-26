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
import android.graphics.Outline
import android.net.Uri
import android.view.ViewOutlineProvider
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import kotlin.math.roundToInt

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
        applyBubbleAppearance()
        windowManager.addView(bubble, bubbleParams)
    }

    /**
     * Applies the Fooview-style bubble settings (icon, size, transparency)
     * from [Prefs]. Called whenever the bubble is (re)created — the Start
     * button restarts the service so edits always take effect.
     */
    private fun applyBubbleAppearance() {
        val view = bubble ?: return
        val params = bubbleParams ?: return

        val sizePx = (Prefs.bubbleSizeDp(this) * resources.displayMetrics.density).roundToInt()
        params.width = sizePx
        params.height = sizePx
        view.alpha = Prefs.transparencyPct(this) / 100f

        val label = view.findViewById<TextView>(R.id.bubbleText)
        val image = view.findViewById<ImageView>(R.id.bubbleImage)
        when (Prefs.iconStyle(this)) {
            "chat" -> {
                label.visibility = View.VISIBLE
                label.text = "💬"
                image.visibility = View.GONE
            }
            "dot" -> {
                label.visibility = View.GONE
                image.visibility = View.GONE
            }
            "custom" -> {
                val uri = Prefs.customIconUri(this)
                val loaded = uri.isNotBlank() && runCatching {
                    image.setImageURI(Uri.parse(uri))
                    true
                }.getOrDefault(false)
                if (loaded) {
                    // Circular crop with zero dependencies.
                    image.outlineProvider = object : ViewOutlineProvider() {
                        override fun getOutline(v: View, outline: Outline) {
                            outline.setOval(0, 0, v.width, v.height)
                        }
                    }
                    image.clipToOutline = true
                    label.visibility = View.GONE
                    image.visibility = View.VISIBLE
                } else {
                    label.visibility = View.VISIBLE
                    label.text = "CA"
                    image.visibility = View.GONE
                }
            }
            else -> { // "initials"
                label.visibility = View.VISIBLE
                label.text = "CA"
                image.visibility = View.GONE
            }
        }
    }

    /**
     * Makes a view drag its window around by touch (used by the panel
     * header). Same tap-vs-drag threshold pattern as the bubble itself.
     */
    @SuppressLint("ClickableViewAccessibility")
    private fun makeDraggable(handle: View, params: WindowManager.LayoutParams) {
        var downX = 0
        var downY = 0
        var startX = 0
        var startY = 0
        handle.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX.toInt()
                    downY = event.rawY.toInt()
                    startX = params.x
                    startY = params.y
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (event.rawX.toInt() - downX)
                    params.y = startY + (event.rawY.toInt() - downY)
                    windowManager.updateViewLayout(panel, params)
                    true
                }
                else -> false
            }
        }
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
            // Top 60% of the screen only: anchored near the top, capped height
            // (the inner list scrolls). Still draggable via the header.
            gravity = Gravity.TOP or Gravity.START
            val bp = bubbleParams
            val density = resources.displayMetrics.density
            x = (bp?.x ?: 0) + 130
            y = (48 * density).roundToInt()
            height = (resources.displayMetrics.heightPixels * 0.6).toInt()
        }
        val panelView = panel!!
        panelView.alpha = Prefs.panelAlphaPct(this) / 100f
        panelView.findViewById<Button>(R.id.btnClose).setOnClickListener { togglePanel() }
        panelView.findViewById<Button>(R.id.btnRefresh).setOnClickListener { loadSuggestions() }
        setupToneSpinner(panelView)
        makeDraggable(panelView.findViewById(R.id.panelHeader), panelParams!!)
        windowManager.addView(panel, panelParams)
        loadSuggestions()
    }

    /** Tone selector inside the panel — changing it regenerates immediately. */
    private fun setupToneSpinner(panelView: View) {
        val spinner = panelView.findViewById<Spinner>(R.id.toneSpinner)
        val labels = resources.getStringArray(R.array.tone_labels)
        val values = resources.getStringArray(R.array.tone_values)
        spinner.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_item, labels
        ).also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        var initializing = true
        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>, v: View?, position: Int, id: Long) {
                if (initializing) return
                Prefs.setTone(this@OverlayService, values[position])
                loadSuggestions()
            }
            override fun onNothingSelected(parent: AdapterView<*>) {}
        }
        spinner.setSelection(values.indexOf(Prefs.tone(this)).coerceAtLeast(0))
        initializing = false
    }

    private fun loadSuggestions() {
        val panelView = panel ?: return
        val chatLabel = panelView.findViewById<TextView>(R.id.chatLabel)
        val moodText = panelView.findViewById<TextView>(R.id.moodText)
        val list = panelView.findViewById<LinearLayout>(R.id.suggestionList)
        val key = ChatBus.latestKey
        val snapshot = ChatBus.get(key)
        val text = snapshot?.text.orEmpty()
        if (text.isBlank()) {
            chatLabel.text = ""
            moodText.text = "No chat text captured yet — open a conversation in a supported dating app."
            return
        }
        chatLabel.text = ChatBus.labelFor(key, snapshot!!)
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
