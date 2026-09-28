package com.chatassist.overlay

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.graphics.Outline
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.ViewOutlineProvider
import android.widget.Button
import org.json.JSONObject
import android.widget.ImageView
import android.widget.LinearLayout
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
        const val ACTION_HIDE_BUBBLE = "com.chatassist.overlay.HIDE_BUBBLE"
        private const val NOTIF_ID = 1
        private const val CHANNEL_ID = "bubble"

        /** True when the overlay service is currently alive. */
        fun isRunning(ctx: android.content.Context): Boolean {
            val manager = ctx.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            return manager.getRunningServices(Int.MAX_VALUE)
                .any { it.service.className == OverlayService::class.java.name }
        }
    }

    private lateinit var windowManager: WindowManager
    private var bubble: View? = null
    private var panel: View? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var panelParams: WindowManager.LayoutParams? = null
    /** Drop-to-close target, visible only while the bubble is being dragged. */
    private var trash: View? = null
    private var trashParams: WindowManager.LayoutParams? = null
    private var trashHover = false
    /** Pixel size of the bubble (set when its appearance is applied). */
    private var bubbleSizePx = 0

    override fun onBind(intent: Intent?): IBinder? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * The bubble (and panel) exist only inside supported apps. Window events
     * from anything else leave everything untouched EXCEPT real app switches
     * (home, another app), which hide.
     *
     * Exempt (never react): our own windows (panel/trash must not trigger);
     * keyboards — Gboard-style ("inputmethod") AND standalone ones like
     * SwiftKey (com.touchtype.swiftkey) and Samsung (honeyboard), found via
     * a real flight log where SwiftKey hid the bubble for whole typing
     * sessions; and com.android.systemui, which fires constantly on some
     * OEM skins (Nothing OS sent 6 in 4 minutes) for status-bar/gesture
     * noise while the dating app is still frontmost. That systemui storm
     * was the hide-and-seek. Lock screen needs no handling: the window
     * manager keeps overlays beneath the keyguard by itself.
     */
    private fun isExemptForeground(pkg: String): Boolean {
        if (pkg == packageName) return true
        if (pkg == "com.android.systemui") return true
        val lower = pkg.lowercase()
        return lower.contains("inputmethod") ||
            lower.contains("keyboard") ||
            lower.contains("swiftkey") ||
            lower.contains("touchtype") ||
            lower.contains("honeyboard") ||
            lower.contains("fleksy") ||
            lower.contains("swype")
    }

    private val foregroundListener: (String) -> Unit = { pkg ->
        mainHandler.post {
            if (isExemptForeground(pkg)) return@post
            if (pkg in ChatBus.SUPPORTED_PACKAGES) {
                syncBubbleVisibility("fg-event")
                return@post
            }
            // Unsupported package — but it may be transient (usage-reminder
            // toast, permission sheet) with the dating app still underneath.
            // Verify 500ms later against actual windows, not the event, and
            // only then collapse + hide. A real switch-away still shows a
            // gone window by then; a return in between cancels the hide.
            mainHandler.postDelayed({
                if (ChatBus.supportedVisible) return@postDelayed
                if (panel != null) togglePanel()
                syncBubbleVisibility("verified-gone")
            }, 500)
        }
    }

    override fun onCreate() {
        super.onCreate()
        ChatBus.setAppContext(this)
        ChatBus.addForegroundListener(foregroundListener)
        ChatBus.addSnapshotListener(snapshotListener)
    }

    /**
     * Auto-refresh on chat switch: a newly published DIFFERENT chat reloads
     * the panel (rows + suggestions) without a manual Refresh. Same-chat
     * updates (scrolling — RecyclerView recycles off-screen rows so the
     * captured slice changes — or new messages) only refresh the rows.
     * Suggestions wait for an explicit Refresh, otherwise every scroll stop
     * burns an API call and flickers the cards while you're reading.
     */
    private var renderedKey: String? = null
    private var pendingKey: String? = null

    private val snapshotListener: (String) -> Unit = {
        mainHandler.post {
            if (panel == null) return@post
            val key = ChatBus.latestKey
            refreshChatSection()
            if (key == renderedKey) return@post
            if (loadingSuggestions) {
                pendingKey = key
            } else {
                loadSuggestions()
            }
        }
    }

    /** Visible if and only if a supported app is in front (and panel closed). */
    private fun syncBubbleVisibility(cause: String) {
        if (panel != null) {
            bubble?.visibility = View.GONE
            ChatBus.noteBubbleVisibility(false, "$cause + panel open")
            return
        }
        val visible = ChatBus.foregroundPackage in ChatBus.SUPPORTED_PACKAGES
        bubble?.visibility = if (visible) View.VISIBLE else View.GONE
        ChatBus.noteBubbleVisibility(visible, "$cause fg=${ChatBus.foregroundPackage}")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Our own activities send this when they come forward so the bubble
        // never floats over our own UI (the foreground listener ignores our
        // package on purpose — panel/trash windows must not trigger it).
        if (intent?.action == ACTION_HIDE_BUBBLE) {
            mainHandler.post {
                if (panel == null) {
                    bubble?.visibility = View.GONE
                    ChatBus.noteBubbleVisibility(false, "own activity open")
                }
            }
            return START_STICKY
        }
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
            // Spawn docked to the vertical center of the right edge — the
            // natural thumb spot — instead of top-left. Still draggable.
            // (Kept as TOP|START with a computed x so the existing drag math
            // stays correct; END gravity would invert horizontal dragging.)
            gravity = Gravity.TOP or Gravity.START
            val metrics = resources.displayMetrics
            val sizePx = (Prefs.bubbleSizeDp(this@OverlayService) * metrics.density).roundToInt()
            x = metrics.widthPixels - sizePx
            y = (metrics.heightPixels - sizePx) / 2
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
                    if (!moved && dx * dx + dy * dy > 100) {
                        moved = true
                        showTrash()
                    }
                    if (moved) {
                        p.x = startX + dx
                        p.y = startY + dy
                        windowManager.updateViewLayout(bubble, p)
                        updateTrashHover()
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val dropOnTrash = trashHover
                    hideTrash()
                    if (!moved) togglePanel()
                    else if (dropOnTrash) stopOverlayCompletely()
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    hideTrash()
                    false
                }
                else -> false
            }
        }
        applyBubbleAppearance()
        windowManager.addView(bubble, bubbleParams)
        // Start hidden unless a supported app is already in front — the
        // foreground listener takes over from here.
        syncBubbleVisibility("bubble-created")
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
        bubbleSizePx = sizePx
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

    /**
     * Makes the panel resizable by dragging its corner grip. Size is clamped
     * to the screen and persisted on release, so reopening restores it.
     */
    @SuppressLint("ClickableViewAccessibility")
    private fun makeResizable(handle: View, params: WindowManager.LayoutParams) {
        val density = resources.displayMetrics.density
        val metrics = resources.displayMetrics
        val minW = (220 * density).roundToInt()
        val minH = (160 * density).roundToInt()
        var downX = 0
        var downY = 0
        var startW = 0
        var startH = 0
        handle.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX.toInt()
                    downY = event.rawY.toInt()
                    startW = if (params.width > 0) params.width else handle.rootView.width
                    startH = if (params.height > 0) params.height else handle.rootView.height
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.width = (startW + (event.rawX.toInt() - downX))
                        .coerceIn(minW, metrics.widthPixels)
                    params.height = (startH + (event.rawY.toInt() - downY))
                        .coerceIn(minH, metrics.heightPixels)
                    windowManager.updateViewLayout(panel, params)
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    Prefs.setPanelSizeDp(
                        this,
                        (params.width / density).roundToInt(),
                        (params.height / density).roundToInt(),
                    )
                    true
                }
                else -> false
            }
        }
    }

    /**
     * Messenger-style drop-to-close: while the bubble is dragged, a ✕ target
     * sits at the bottom-center; dropping the bubble on it stops the overlay
     * entirely (reopen from the app's Start button). The target is
     * NOT_TOUCHABLE — purely visual, it never intercepts touches.
     */
    private fun showTrash() {
        if (trash != null) return
        val density = resources.displayMetrics.density
        val sizePx = (72 * density).roundToInt()
        val view = TextView(this).apply {
            text = "✕"
            gravity = Gravity.CENTER
            textSize = 28f
            setTextColor(getColor(android.R.color.white))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(getColor(android.R.color.darker_gray))
            }
        }
        val metrics = resources.displayMetrics
        trashParams = WindowManager.LayoutParams(
            sizePx,
            sizePx,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (metrics.widthPixels - sizePx) / 2
            y = metrics.heightPixels - sizePx - (110 * density).roundToInt()
        }
        trash = view
        trashHover = false
        windowManager.addView(view, trashParams)
    }

    private fun updateTrashHover() {
        val view = trash ?: return
        val tp = trashParams ?: return
        val bp = bubbleParams ?: return
        // Rectangle overlap of the two VISIBLE windows — not the finger
        // position, which sits wherever the bubble was grabbed and can be a
        // full bubble-size away from its center. Finger-point testing only
        // fired at the target's edge; this fires when they visually overlap.
        val over = bp.x < tp.x + tp.width && bp.x + bubbleSizePx > tp.x &&
            bp.y < tp.y + tp.height && bp.y + bubbleSizePx > tp.y
        if (over != trashHover) {
            trashHover = over
            val scale = if (over) 1.3f else 1f
            view.scaleX = scale
            view.scaleY = scale
            (view.background as? GradientDrawable)?.setColor(
                getColor(if (over) android.R.color.holo_red_dark else android.R.color.darker_gray)
            )
        }
    }

    private fun hideTrash() {
        trash?.let { runCatching { windowManager.removeView(it) } }
        trash = null
        trashParams = null
        trashHover = false
    }

    /** Full dismiss: removes bubble + panel and stops the service. */
    private fun stopOverlayCompletely() {
        hideTrash()
        panel?.let { runCatching { windowManager.removeView(it) } }
        panel = null
        bubble?.let { runCatching { windowManager.removeView(it) } }
        bubble = null
        bubbleParams = null
        panelParams = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun togglePanel() {
        if (panel != null) {
            windowManager.removeView(panel)
            panel = null
            // Panel-open guarantees a supported context (leaving auto-fires
            // collapse first), so show directly — trusting the possibly stale
            // foreground reading here is what wedged the bubble hidden. The
            // foreground listener re-syncs right after when collapsing.
            bubble?.visibility = View.VISIBLE
            ChatBus.noteBubbleVisibility(true, "panel closed")
            return
        }
        val inflater = LayoutInflater.from(this)
        panel = inflater.inflate(R.layout.overlay_panel, null)
        panelParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // NOT_FOCUSABLE is load-bearing: the panel must never steal input
            // focus, or (a) the keyboard refuses to open for the app behind,
            // (b) back button/gesture goes to the panel instead of the app,
            // and (c) rootInActiveWindow becomes our own panel so tap-to-paste
            // can't find the chat box. Taps on buttons/cards/spinner still
            // work — touch delivery doesn't need focus, only key events/IME
            // do, and the panel has no text input.
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            // Top 60% of the screen by default: anchored near the top, capped
            // height (the inner list scrolls). A saved manual resize replaces
            // both dimensions; still draggable via the header either way.
            gravity = Gravity.TOP or Gravity.START
            val bp = bubbleParams
            val density = resources.displayMetrics.density
            x = (bp?.x ?: 0) + 130
            y = (48 * density).roundToInt()
            val savedW = Prefs.panelWidthDp(this@OverlayService)
            val savedH = Prefs.panelHeightDp(this@OverlayService)
            if (savedW > 0 && savedH > 0) {
                val metrics = resources.displayMetrics
                width = (savedW * density).roundToInt()
                    .coerceIn((220 * density).roundToInt(), metrics.widthPixels)
                height = (savedH * density).roundToInt()
                    .coerceIn((160 * density).roundToInt(), metrics.heightPixels)
            } else {
                height = (resources.displayMetrics.heightPixels * 0.6).toInt()
            }
        }
        val panelView = panel!!
        panelView.alpha = Prefs.panelAlphaPct(this) / 100f
        // Build version inline left of Refresh — screenshots then always
        // tell us which release produced them.
        panelView.findViewById<TextView>(R.id.versionText).text = "v${appVersionName()}"
        setupCloseButton(panelView, panelParams!!)
        panelView.findViewById<Button>(R.id.btnRefresh).setOnClickListener {
            // Re-capture first: if the reader missed this chat (debounced
            // switch, settled screen), Refresh heals it instead of
            // re-showing the previous match's data. Forced: manual Refresh
            // must visibly regenerate, never silently re-serve the cache.
            ChatBus.requestCapture()
            refreshChatSection()
            loadSuggestions(force = true)
        }
        setupToneButton(panelView)
        // Chat starts collapsed on every open (the live chat is already
        // visible behind the panel; rows are one tap away if needed).
        chatExpanded = false
        summaryExpanded = false
        wireChatSection(panelView)
        wireSummarySection(panelView)
        renderChatSection(panelView)
        renderStoredSummary(panelView)
        makeResizable(panelView.findViewById(R.id.resizeHandle), panelParams!!)
        makeDraggable(panelView.findViewById(R.id.panelHeader), panelParams!!)
        // The Mood label drags too (hold it like the ✕ button) — only the
        // tone button consumes its own taps for the tone list.
        makeDraggable(panelView.findViewById(R.id.moodLabel), panelParams!!)
        windowManager.addView(panel, panelParams)
        // The bubble would sit under/over the panel and steal taps — hide it
        // until the panel closes.
        syncBubbleVisibility("panel opened")
        loadSuggestions()
    }

    /**
     * Close button with dual behavior: tap closes the panel, press-and-hold
     * drags it (same threshold pattern as the bubble). A plain click
     * listener can't do both, so touch is handled directly.
     */
    @SuppressLint("ClickableViewAccessibility")
    private fun setupCloseButton(panelView: View, params: WindowManager.LayoutParams) {
        val close = panelView.findViewById<Button>(R.id.btnClose)
        var downX = 0
        var downY = 0
        var startX = 0
        var startY = 0
        var moved = false
        close.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX.toInt()
                    downY = event.rawY.toInt()
                    startX = params.x
                    startY = params.y
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX.toInt() - downX
                    val dy = event.rawY.toInt() - downY
                    if (dx * dx + dy * dy > 100) moved = true
                    if (moved) {
                        params.x = startX + dx
                        params.y = startY + dy
                        windowManager.updateViewLayout(panel, params)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) togglePanel()
                    true
                }
                else -> false
            }
        }
    }

    /**
     * Tone selector as an in-panel expanding list. A Spinner was tried first,
     * but its popup window cannot operate inside a non-focusable overlay —
     * taps either did nothing or fired while dragging. Only the small button
     * toggles the list; every other header touch still drags the panel.
     */
    private fun setupToneButton(panelView: View) {
        val labels = resources.getStringArray(R.array.tone_labels)
        val values = resources.getStringArray(R.array.tone_values)
        val button = panelView.findViewById<TextView>(R.id.toneButton)
        val options = panelView.findViewById<LinearLayout>(R.id.toneOptions)
        fun refreshLabel() {
            val i = values.indexOf(Prefs.tone(this)).coerceAtLeast(0)
            button.text = "${labels[i]} ▾"
        }
        refreshLabel()
        options.removeAllViews()
        for (i in labels.indices) {
            options.addView(TextView(this).apply {
                text = labels[i]
                textSize = 15f
                setPadding(24, 14, 8, 14)
                setTextColor(getColor(android.R.color.black))
                setOnClickListener {
                    Prefs.setTone(this@OverlayService, values[i])
                    refreshLabel()
                    options.visibility = View.GONE
                    // Forced: a tone switch must regenerate in the new tone,
                    // never re-serve the previous tone's cached batch.
                    loadSuggestions(force = true)
                }
            })
        }
        button.setOnClickListener {
            options.visibility =
                if (options.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }
    }

    // Guards overlapping requests (double-tapped Refresh rendered the same
    // batch twice). Reset on every callback path below.
    private var loadingSuggestions = false
    private var loadingFacts = false
    private var chatExpanded = true
    private var summaryExpanded = false

    private fun updateChatToggle(toggle: TextView, count: Int) {
        val arrow = if (chatExpanded) "▾" else "▸"
        toggle.text = if (count > 0) "💬 Chat ($count) $arrow" else "💬 Chat $arrow"
    }

    private fun updateSummaryToggle(toggle: TextView) {
        val arrow = if (summaryExpanded) "▾" else "▸"
        toggle.text = "📋 Summary $arrow"
    }

    private fun wireChatSection(panelView: View) {
        val toggle = panelView.findViewById<TextView>(R.id.chatToggle)
        val scroll = panelView.findViewById<View>(R.id.chatScroll)
        scroll.visibility = if (chatExpanded) View.VISIBLE else View.GONE
        toggle.setOnClickListener {
            chatExpanded = !chatExpanded
            scroll.visibility = if (chatExpanded) View.VISIBLE else View.GONE
            updateChatToggle(toggle, displayedChatRows.size)
        }
    }

    private fun wireSummarySection(panelView: View) {
        val toggle = panelView.findViewById<TextView>(R.id.summaryToggle)
        val scroll = panelView.findViewById<View>(R.id.summaryScroll)
        updateSummaryToggle(toggle)
        scroll.visibility = if (summaryExpanded) View.VISIBLE else View.GONE
        toggle.setOnClickListener {
            summaryExpanded = !summaryExpanded
            scroll.visibility = if (summaryExpanded) View.VISIBLE else View.GONE
            updateSummaryToggle(toggle)
            if (summaryExpanded) loadFacts()
        }
    }

    /** Re-renders chat rows + stored summary (no network). */
    private fun refreshChatSection() {
        val panelView = panel ?: return
        renderChatSection(panelView)
        renderStoredSummary(panelView)
        if (summaryExpanded) loadFacts()
    }

    private data class ChatRow(val speaker: String, val body: String)

    /** Currently displayed (corrected) rows — backs tap-to-flip. */
    private var displayedChatKey: String? = null
    private var displayedChatRows: List<ChatRow> = emptyList()
    /** A speaker flip landed mid-flight: reload once the call returns. */
    private var pendingReload = false

    private fun renderChatSection(panelView: View) {
        val rows = panelView.findViewById<LinearLayout>(R.id.chatRows)
        val toggle = panelView.findViewById<TextView>(R.id.chatToggle)
        rows.removeAllViews()
        val snapshot = ChatBus.get(ChatBus.latestKey)
        val text = ChatBus.applySpeakerFixes(
            snapshot?.text.orEmpty(), snapshot?.speakerFixes.orEmpty()
        )
        val lines = text.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList().takeLast(30)
        val built = mutableListOf<ChatRow>()
        for (line in lines) {
            val upper = line.uppercase()
            val isUser = upper.startsWith("[USER]")
            val body = if (isUser || upper.startsWith("[MATCH]")) {
                line.substringAfter("]:", line).trim()
            } else {
                line
            }
            if (body.isEmpty()) continue
            built.add(ChatRow(if (isUser) "USER" else "MATCH", body))
        }
        displayedChatKey = ChatBus.latestKey
        displayedChatRows = built
        if (built.isEmpty()) {
            rows.addView(hintView("No chat text captured yet — open a conversation."))
        } else {
            for ((index, row) in built.withIndex()) {
                val isUser = row.speaker == "USER"
                rows.addView(TextView(this).apply {
                    this.text = if (isUser) "You: ${row.body}" else "Match: ${row.body}"
                    textSize = 13f
                    setPadding(8, 6, 8, 6)
                    gravity = if (isUser) Gravity.END else Gravity.START
                    setTextColor(
                        if (isUser) getColor(android.R.color.holo_blue_dark)
                        else getColor(android.R.color.black)
                    )
                    setOnClickListener { flipSpeaker(index) }
                })
            }
            rows.addView(TextView(this).apply {
                this.text = "Tap a message to correct its side"
                textSize = 11f
                setPadding(8, 4, 8, 2)
                gravity = Gravity.CENTER
                setTextColor(getColor(android.R.color.darker_gray))
            })
        }
        updateChatToggle(toggle, built.size)
    }

    /**
     * Tap-to-flip: reassigns one row to the other speaker, stores the
     * correction (survives re-captures), and regenerates suggestions from
     * the corrected text.
     */
    private fun flipSpeaker(index: Int) {
        val panelView = panel ?: return
        val key = displayedChatKey ?: return
        // Panel moved on while open: re-sync rows first, flip on next tap.
        if (key != ChatBus.latestKey || ChatBus.get(key) == null) {
            refreshChatSection()
            Toast.makeText(this, "Chat updated — tap the message again", Toast.LENGTH_SHORT).show()
            return
        }
        val rows = displayedChatRows.toMutableList()
        if (index !in rows.indices) return
        rows[index] = rows[index].copy(
            speaker = if (rows[index].speaker == "USER") "MATCH" else "USER"
        )
        val grouped = linkedMapOf<String, MutableList<String>>()
        for ((speaker, body) in rows) {
            grouped.getOrPut(body) { mutableListOf() }.add(speaker)
        }
        ChatBus.updateSpeakerFixes(key, grouped)
        renderChatSection(panelView)
        Toast.makeText(
            this,
            if (rows[index].speaker == "USER") "Marked as yours — regenerating" else "Marked as theirs — regenerating",
            Toast.LENGTH_SHORT,
        ).show()
        if (loadingSuggestions) pendingReload = true else loadSuggestions()
    }

    private fun hintView(msg: String): TextView = TextView(this).apply {
        text = msg
        textSize = 12f
        setPadding(8, 6, 8, 6)
        setTextColor(getColor(android.R.color.darker_gray))
    }

    /**
     * Timeouts get their own wording: with healthy requests taking 8-12s,
     * "timed out" means "servers are slow, your chat is fine" — not a bug to
     * report. Everything else keeps the technical detail for debugging.
     */
    private fun friendlyLoadError(e: Throwable, what: String): String {
        val msg = e.message.orEmpty()
        if (e is java.net.SocketTimeoutException ||
            msg.contains("timed out", ignoreCase = true) ||
            msg.contains("timeout", ignoreCase = true)
        ) {
            return "Timed out — servers are slow right now. Tap Refresh to retry."
        }
        return if (what == "summary") "Couldn't load summary: $msg"
        else "Couldn't load suggestions: $msg"
    }

    private fun renderStoredSummary(panelView: View) {
        val rows = panelView.findViewById<LinearLayout>(R.id.summaryRows)
        rows.removeAllViews()
        val snapshot = ChatBus.get(ChatBus.latestKey)
        val raw = snapshot?.factsJson
        if (raw.isNullOrBlank()) {
            rows.addView(hintView("Tap 📋 Summary to load what the AI has learned about this match."))
            return
        }
        val sheet = runCatching { ApiClient.buildFactSheet(JSONObject(raw)) }.getOrNull()
        if (sheet == null) {
            rows.addView(hintView("Saved summary looks corrupt — tap 📋 Summary to reload."))
            return
        }
        renderFactSheet(rows, sheet, snapshot?.userNote.orEmpty())
    }

    private fun renderFactSheet(rows: LinearLayout, sheet: FactSheet, note: String = "") {
        rows.removeAllViews()
        if (note.isNotBlank()) {
            rows.addView(TextView(this).apply {
                text = "Your notes"
                textSize = 11f
                setPadding(8, 6, 8, 0)
                setTextColor(getColor(android.R.color.darker_gray))
            })
            rows.addView(TextView(this).apply {
                text = note
                textSize = 13f
                setPadding(8, 0, 8, 6)
                setTextColor(getColor(android.R.color.black))
            })
        }
        if (sheet.summary.isNotBlank()) {
            rows.addView(TextView(this).apply {
                text = sheet.summary
                textSize = 13f
                setPadding(8, 6, 8, 10)
                setTextColor(getColor(android.R.color.black))
            })
        }
        if (sheet.rows.isEmpty() && sheet.summary.isBlank()) {
            rows.addView(hintView("Nothing learned yet — chat a bit more, then Refresh."))
            return
        }
        for ((label, value) in sheet.rows) {
            rows.addView(TextView(this).apply {
                text = label
                textSize = 11f
                setPadding(8, 6, 8, 0)
                setTextColor(getColor(android.R.color.darker_gray))
            })
            rows.addView(TextView(this).apply {
                text = value
                textSize = 13f
                setPadding(8, 0, 8, 6)
                setTextColor(getColor(android.R.color.black))
            })
        }
    }

    /** Fetches (or reuses) the learned fact sheet for the current chat. */
    private fun loadFacts() {
        if (loadingFacts) return
        val panelView = panel ?: return
        val rows = panelView.findViewById<LinearLayout>(R.id.summaryRows)
        val key = ChatBus.latestKey
        val snapshot = ChatBus.get(key)
        // Corrected text: facts must learn from what you verified, not raw.
        val text = ChatBus.applySpeakerFixes(
            snapshot?.text.orEmpty(), snapshot?.speakerFixes.orEmpty()
        )
        if (text.isBlank()) {
            rows.removeAllViews()
            rows.addView(hintView("No chat text captured yet — open a conversation first."))
            return
        }
        // Stored sheet for this exact text: render instantly, no network.
        val stored = snapshot?.factsJson
        if (!stored.isNullOrBlank() && snapshot?.factsText == text) {
            renderStoredSummary(panelView)
            return
        }
        loadingFacts = true
        rows.removeAllViews()
        rows.addView(hintView("Learning summary…"))
        val previous = stored?.let { runCatching { JSONObject(it) }.getOrNull() }
        // Hand-added notes ride along as bio so learning merges them in.
        val note = snapshot?.userNote.orEmpty()
        ApiClient.fetchFacts(Prefs.backendUrl(this), text, previous, callback = { result ->
            loadingFacts = false
            val pv = panel ?: return@fetchFacts
            result.fold(
                onSuccess = { (json, sheet) ->
                    ChatBus.updateFacts(key, json.toString(), text)
                    if (ChatBus.latestKey == key) {
                        renderFactSheet(
                            pv.findViewById(R.id.summaryRows), sheet,
                            ChatBus.get(key)?.userNote.orEmpty(),
                        )
                    }
                },
                onFailure = { e ->
                    if (ChatBus.latestKey == key) {
                        rows.removeAllViews()
                        rows.addView(hintView(friendlyLoadError(e, "summary") + " — tap 📋 Summary to retry."))
                    }
                },
            )
        }, bio = note)
    }

    /** True when the match has said anything substantive (not just labels). */
    private fun hasMatchContent(text: String): Boolean =
        text.lineSequence().any { line ->
            line.trimStart().startsWith("[MATCH]", ignoreCase = true) &&
                line.substringAfter("]:", "").isNotBlank()
        }

    /**
     * Loads suggestions, from cache when possible. `force` (manual Refresh,
     * tone switch) always hits the network: Refresh must visibly DO
     * something, and the tone is part of what makes a batch fresh. Auto
     * paths (chat switch, flip reload) use the cache to save API calls.
     */
    private fun loadSuggestions(force: Boolean = false) {
        if (loadingSuggestions) return
        val panelView = panel ?: return
        val chatLabel = panelView.findViewById<TextView>(R.id.chatLabel)
        val moodText = panelView.findViewById<TextView>(R.id.moodText)
        val list = panelView.findViewById<LinearLayout>(R.id.suggestionList)
        val key = ChatBus.latestKey
        val snapshot = ChatBus.get(key)
        // Everything downstream reads the CORRECTED text (tap-to-flip
        // applied), so rows, mood, suggestions and cache agree with each
        // other — and flipping a row invalidates the cache by itself.
        val text = ChatBus.applySpeakerFixes(
            snapshot?.text.orEmpty(), snapshot?.speakerFixes.orEmpty()
        )
        renderedKey = key
        pendingKey = null
        if (snapshot == null) {
            chatLabel.text = ""
            moodText.text = "No chat text captured yet — open a conversation in a supported dating app."
            return
        }
        // Empty window (only your messages so far, match hasn't replied — or
        // a fresh message-less chat): opening lines + name puns instead of
        // replies to nothing. A known chat title is enough; only a
        // title-less blank means nothing was captured at all.
        val opener = !hasMatchContent(text)
        chatLabel.text = ChatBus.labelFor(key, snapshot)
        // Smart refresh: same request as last time → re-render the stored
        // batch instantly instead of burning another API call. Taste, gender
        // and TONE ride the fingerprint (a tone switch must regenerate, not
        // re-serve the previous tone's batch); the "v2" scheme prefix retires
        // batches cached before those rules existed.
        val taste = Prefs.tasteProfile(this)
        val tone = Prefs.tone(this)
        val mode = if (opener) "opener" else "reply"
        // Gender rides the fingerprint too: declaring it later must
        // regenerate, not re-serve the ungendered batch.
        val genderTag = Prefs.userGender(this).takeIf { it == "male" || it == "female" } ?: ""
        val fingerprint = if (opener) {
            "v2|$tone|opener|${snapshot.title.orEmpty()}|t${taste.hashCode()}|g$genderTag"
        } else {
            "v2|$tone|reply|$text|t${taste.hashCode()}|g$genderTag"
        }
        if (!force && snapshot.suggestMode == mode && snapshot.suggestFor == fingerprint &&
            snapshot.suggestItems.isNotEmpty()
        ) {
            moodText.text = snapshot.suggestMood.ifBlank { "Suggestions ready — tap one to copy." }
            renderSuggestionCards(list, snapshot.suggestItems.mapIndexed { i, s ->
                SuggestionItem(s, snapshot.suggestTones.getOrElse(i) { "casual" })
            })
            return
        }
        moodText.text = if (opener) "Thinking of openers…" else "Thinking…"
        list.removeAllViews()
        loadingSuggestions = true
        // Declared gender (male/female/unspecified) — the server validates.
        val userGender = Prefs.userGender(this)
        if (opener) {
            ApiClient.fetchSuggestions(
                Prefs.backendUrl(this),
                "", tone,
                mode = "opener",
                matchName = snapshot.title.orEmpty(),
                callback = { result -> onSuggestionsLoaded(result, moodText, list, key, mode, fingerprint) },
                tasteProfile = taste,
                userGender = userGender,
            )
        } else {
            ApiClient.fetchSuggestions(
                Prefs.backendUrl(this),
                text, tone,
                callback = { result -> onSuggestionsLoaded(result, moodText, list, key, mode, fingerprint) },
                tasteProfile = taste,
                userGender = userGender,
            )
        }
    }

    private fun onSuggestionsLoaded(
        result: Result<SuggestionResult>,
        moodText: TextView,
        list: LinearLayout,
        key: String,
        mode: String,
        fingerprint: String,
    ) {
        loadingSuggestions = false
        renderedKey = key
        result.fold(
            onSuccess = { r ->
                    moodText.text = r.mood.ifBlank { "Suggestions ready — tap one to copy." }
                    val items = r.suggestions.take(5)
                    ChatBus.updateSuggestions(
                        key, mode, fingerprint, r.mood,
                        items.map { it.text }, items.map { it.tone },
                    )
                    renderSuggestionCards(list, items)
                },
                onFailure = { e ->
                    moodText.text = friendlyLoadError(e, "suggestions")
                },
            )
        // A chat switch arrived mid-flight, or a speaker flip did: serve it.
        val pk = pendingKey
        pendingKey = null
        val pr = pendingReload
        pendingReload = false
        if (panel != null && ((pk != null && pk != key) || pr)) {
            refreshChatSection()
            loadSuggestions()
        }
    }

    /**
     * Tappable suggestion cards with 👍/👎 votes, shared by fresh and cached
     * batches. Votes crystallize into LEARNED TASTE (same rules as web) and
     * steer every future generation on this device.
     */
    private fun renderSuggestionCards(list: LinearLayout, suggestions: List<SuggestionItem>) {
        list.removeAllViews()
        for (item in suggestions.take(5)) {
                        val row = LinearLayout(this).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = android.view.Gravity.CENTER_VERTICAL
                        }
                        val card = TextView(this).apply {
                            this.text = item.text
                            textSize = 14f
                            setPadding(20, 16, 20, 16)
                            setTextColor(getColor(android.R.color.black))
                        }
                        card.setOnClickListener {
                            if (Prefs.autoPaste(this)) {
                                ChatBus.requestPaste(item.text) { ok ->
                                    if (ok) {
                                        Toast.makeText(
                                            this,
                                            "Pasted into chat — review and press send",
                                            Toast.LENGTH_SHORT,
                                        ).show()
                                    } else {
                                        copyToClipboard(item.text)
                                        Toast.makeText(
                                            this,
                                            "Couldn't find the chat box — copied instead",
                                            Toast.LENGTH_SHORT,
                                        ).show()
                                    }
                                }
                            } else {
                                copyToClipboard(item.text)
                                Toast.makeText(this, "Copied — paste it into your chat", Toast.LENGTH_SHORT).show()
                            }
                        }
                        fun voteButton(emoji: String, up: Boolean): Button {
                            return Button(this).apply {
                                text = emoji
                                textSize = 14f
                                minWidth = 0
                                minimumWidth = 0
                                setPadding(8, 8, 8, 8)
                                setOnClickListener {
                                    Prefs.recordTasteVote(
                                        this@OverlayService, item.tone, item.text, up
                                    )
                                    // One vote per card — lock both buttons.
                                    for (i in 0 until row.childCount) {
                                        (row.getChildAt(i) as? Button)?.let {
                                            it.isEnabled = false
                                            it.alpha = 0.4f
                                        }
                                    }
                                    Toast.makeText(
                                        this@OverlayService,
                                        if (up) "Noted 👍 — more like this" else "Noted 👎 — less like this",
                                        Toast.LENGTH_SHORT,
                                    ).show()
                                }
                            }
                        }
                        val upBtn = voteButton("👍", true)
                        val downBtn = voteButton("👎", false)
                        row.addView(
                            card,
                            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
                        )
                        row.addView(upBtn)
                        row.addView(downBtn)
                        list.addView(row)
                    }
    }

    private fun copyToClipboard(text: String) {
        val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
        cm.setPrimaryClip(android.content.ClipData.newPlainText("suggestion", text))
    }

    private fun appVersionName(): String {
        return try {
            val info = if (android.os.Build.VERSION.SDK_INT >= 33) {
                packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION") packageManager.getPackageInfo(packageName, 0)
            }
            info.versionName ?: "?"
        } catch (_: Exception) {
            "?"
        }
    }

    override fun onDestroy() {
        ChatBus.removeForegroundListener(foregroundListener)
        ChatBus.removeSnapshotListener(snapshotListener)
        hideTrash()
        bubble?.let { runCatching { windowManager.removeView(it) } }
        panel?.let { runCatching { windowManager.removeView(it) } }
        bubble = null
        panel = null
        super.onDestroy()
    }
}
