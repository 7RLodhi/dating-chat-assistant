package com.chatassist.overlay

import android.Manifest
import android.app.ActivityManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.SeekBar
import android.widget.TextView
import android.view.View
import org.json.JSONObject
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat

/**
 * Onboarding + status screen. The overlay needs two permissions, granted in
 * this order (each explains itself on the next system screen):
 *  1. "Display over other apps" — lets the bubble float above dating apps.
 *  2. Accessibility service — lets the app read the visible chat text of
 *     supported dating apps only. Read-only: nothing is ever sent or tapped
 *     automatically.
 * The "Send test" button verifies the backend URL without needing Tinder.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusOverlay: TextView
    private lateinit var statusA11y: TextView
    private lateinit var statusCapture: TextView
    private lateinit var a11yHint: TextView
    private lateinit var statusBattery: TextView
    private lateinit var testResult: TextView
    private lateinit var btnStart: Button
    private lateinit var versionFooter: TextView
    private lateinit var iconGroup: RadioGroup
    private lateinit var sizeSeek: SeekBar
    private lateinit var sizeValue: TextView
    private lateinit var alphaSeek: SeekBar
    private lateinit var alphaValue: TextView
    private lateinit var panelAlphaSeek: SeekBar
    private lateinit var panelAlphaValue: TextView
    private lateinit var autoPasteSwitch: androidx.appcompat.widget.SwitchCompat
    private lateinit var matchList: LinearLayout
    private lateinit var matchEmptyHint: TextView

    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) {
            syncAppearanceUi() // cancelled: revert the radio to the saved style
            return@registerForActivityResult
        }
        try {
            contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: Exception) {
            // Persist not granted — the URI still works for this session.
        }
        Prefs.setCustomIconUri(this, uri.toString())
        Prefs.setIconStyle(this, "custom")
        iconGroup.check(R.id.radioCustom)
        markAppearanceDirty()
    }

    /** Start is enabled when the bubble isn't running, or after an appearance edit. */
    private var appearanceDirty = false

    private fun markAppearanceDirty() {
        appearanceDirty = true
        updateStartButton()
    }

    private fun isOverlayRunning(): Boolean {
        val manager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        return manager.getRunningServices(Int.MAX_VALUE)
            .any { it.service.className == OverlayService::class.java.name }
    }

    private fun updateStartButton() {
        if (::btnStart.isInitialized) {
            btnStart.isEnabled = !isOverlayRunning() || appearanceDirty
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        ChatBus.setAppContext(this)

        statusOverlay = findViewById(R.id.statusOverlay)
        statusA11y = findViewById(R.id.statusA11y)
        statusCapture = findViewById(R.id.statusCapture)
        a11yHint = findViewById(R.id.a11yHint)
        statusBattery = findViewById(R.id.statusBattery)
        testResult = findViewById(R.id.testResult)
        btnStart = findViewById(R.id.btnStart)
        versionFooter = findViewById(R.id.versionFooter)
        iconGroup = findViewById(R.id.iconGroup)
        sizeSeek = findViewById(R.id.sizeSeek)
        sizeValue = findViewById(R.id.sizeValue)
        alphaSeek = findViewById(R.id.alphaSeek)
        alphaValue = findViewById(R.id.alphaValue)
        panelAlphaSeek = findViewById(R.id.panelAlphaSeek)
        panelAlphaValue = findViewById(R.id.panelAlphaValue)
        autoPasteSwitch = findViewById(R.id.autoPasteSwitch)
        matchList = findViewById(R.id.matchList)
        matchEmptyHint = findViewById(R.id.matchEmptyHint)
        findViewById<Button>(R.id.btnCaptureLog).setOnClickListener {
            startActivity(android.content.Intent(this, CaptureLogActivity::class.java))
        }
        autoPasteSwitch.isChecked = Prefs.autoPaste(this)
        autoPasteSwitch.setOnCheckedChangeListener { _, checked ->
            Prefs.setAutoPaste(this, checked)
        }
        val genderGroup: RadioGroup = findViewById(R.id.genderGroup)
        when (Prefs.userGender(this)) {
            "male" -> genderGroup.check(R.id.radioMale)
            "female" -> genderGroup.check(R.id.radioFemale)
            else -> genderGroup.check(R.id.radioGenderSkip)
        }
        genderGroup.setOnCheckedChangeListener { _, checkedId ->
            Prefs.setUserGender(
                this,
                when (checkedId) {
                    R.id.radioMale -> "male"
                    R.id.radioFemale -> "female"
                    else -> "unspecified"
                },
            )
        }

        versionFooter.text = "v${appVersionName()} (${appVersionCode()})"
        syncAppearanceUi()

        iconGroup.setOnCheckedChangeListener { _, checkedId ->
            // Programmatic checks from syncAppearanceUi must not count as edits.
            val next = when (checkedId) {
                R.id.radioChat -> "chat"
                R.id.radioDot -> "dot"
                R.id.radioCustom -> "custom"
                else -> "initials"
            }
            if (next == "custom" && Prefs.customIconUri(this).isBlank()) {
                // No image yet — open the picker (its callback saves + marks dirty).
                pickImage.launch("image/*")
                return@setOnCheckedChangeListener
            }
            if (Prefs.iconStyle(this) != next) {
                Prefs.setIconStyle(this, next)
                markAppearanceDirty()
            }
        }
        sizeSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seek: SeekBar, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                Prefs.setBubbleSizeDp(this@MainActivity, progress)
                sizeValue.text = "${Prefs.bubbleSizeDp(this@MainActivity)} dp"
                markAppearanceDirty()
            }
            override fun onStartTrackingTouch(seek: SeekBar) {}
            override fun onStopTrackingTouch(seek: SeekBar) {}
        })
        alphaSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seek: SeekBar, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                Prefs.setTransparencyPct(this@MainActivity, progress)
                alphaValue.text = "${Prefs.transparencyPct(this@MainActivity)}%"
                markAppearanceDirty()
            }
            override fun onStartTrackingTouch(seek: SeekBar) {}
            override fun onStopTrackingTouch(seek: SeekBar) {}
        })
        panelAlphaSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seek: SeekBar, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                Prefs.setPanelAlphaPct(this@MainActivity, progress)
                panelAlphaValue.text = "${Prefs.panelAlphaPct(this@MainActivity)}%"
                markAppearanceDirty()
            }
            override fun onStartTrackingTouch(seek: SeekBar) {}
            override fun onStopTrackingTouch(seek: SeekBar) {}
        })

        findViewById<Button>(R.id.btnOverlay).setOnClickListener {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        findViewById<Button>(R.id.btnA11y).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        findViewById<Button>(R.id.btnBattery).setOnClickListener {
            // Direct exemption request; falls back to the system list.
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:$packageName"),
                    )
                )
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        }
        btnStart.setOnClickListener {
            requestNotificationPermissionIfNeeded()
            // Restart (not just start) so bubble appearance edits below
            // always take effect on the running bubble.
            stopService(Intent(this, OverlayService::class.java))
            startForegroundServiceCompat()
            appearanceDirty = false
            updateStartButton()
        }
        findViewById<Button>(R.id.btnTest).setOnClickListener {
            testResult.text = "Sending…"
            ApiClient.fetchSuggestions(
                Prefs.backendUrl(this),
                "[MATCH]: hey! how was your weekend?\n[USER]: pretty good, went hiking",
                Prefs.tone(this),
                callback = { result ->
                    testResult.text = result.fold(
                        onSuccess = { "OK: ${it.suggestions.first().text}" },
                        onFailure = { "Failed: ${it.message}" },
                    )
                },
            )
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        syncAppearanceUi()
        updateStartButton()
        ChatBus.loadFromPrefs()
        renderMatchList()
        // Keep the bubble out of our own UI (the overlay ignores our package
        // by design, so activities announce themselves explicitly).
        if (OverlayService.isRunning(this)) {
            startService(
                android.content.Intent(this, OverlayService::class.java)
                    .setAction(OverlayService.ACTION_HIDE_BUBBLE)
            )
        }
    }

    /**
     * Match list, synced with the overlay panel through [ChatBus]: same chat
     * snapshots, same fact sheets. A summary fetched here (or in the panel)
     * is stored on the shared snapshot, so both places show it.
     */
    private fun renderMatchList() {
        matchList.removeAllViews()
        val chats = ChatBus.all()
        matchEmptyHint.visibility = if (chats.isEmpty()) View.VISIBLE else View.GONE
        for ((key, snapshot) in chats) {
            matchList.addView(buildMatchCard(key, snapshot))
        }
    }

    private fun buildMatchCard(key: String, snapshot: ChatBus.ChatSnapshot): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 12, 16, 12)
        }
        val header = TextView(this).apply {
            text = ChatBus.labelFor(key, snapshot)
            textSize = 16f
            setTextColor(getColor(R.color.ink))
        }
        header.setTypeface(header.typeface, android.graphics.Typeface.BOLD)
        val lines = snapshot.text.lineSequence().map { it.trim() }
            .filter { it.isNotEmpty() }.toList()
        val preview = TextView(this).apply {
            text = lines.lastOrNull()?.let { stripSpeaker(it) } ?: "No messages captured."
            textSize = 13f
            setTextColor(getColor(android.R.color.darker_gray))
            maxLines = 2
        }
        val summarySnippet = TextView(this).apply {
            textSize = 13f
            setTextColor(getColor(android.R.color.darker_gray))
        }
        val openHint = TextView(this).apply {
            text = "Tap to open ▸"
            textSize = 12f
            setTextColor(getColor(android.R.color.darker_gray))
        }

        fun refreshSnippet() {
            val raw = ChatBus.get(key)?.factsJson
            val summary = raw?.let { runCatching { ApiClient.buildFactSheet(JSONObject(it)).summary }.getOrNull() }
            summarySnippet.text =
                if (summary.isNullOrBlank()) "📋 No summary yet — tap to open."
                else "📋 $summary"
        }
        refreshSnippet()

        card.setOnClickListener {
            startActivity(
                android.content.Intent(this, MatchDetailActivity::class.java)
                    .putExtra(MatchDetailActivity.EXTRA_KEY, key)
            )
        }
        card.addView(header)
        card.addView(preview)
        card.addView(summarySnippet)
        card.addView(openHint)
        return card
    }

    private fun stripSpeaker(line: String): String {
        val upper = line.uppercase()
        if (upper.startsWith("[USER]") || upper.startsWith("[MATCH]")) {
            return line.substringAfter("]:", line).trim()
        }
        return line
    }


    private fun appVersionName(): String {
        return try {
            val info = if (Build.VERSION.SDK_INT >= 33) {
                packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION") packageManager.getPackageInfo(packageName, 0)
            }
            info.versionName ?: "?"
        } catch (_: Exception) {
            "?"
        }
    }

    private fun appVersionCode(): Long {
        return try {
            val info = if (Build.VERSION.SDK_INT >= 33) {
                packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION") packageManager.getPackageInfo(packageName, 0)
            }
            if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        } catch (_: Exception) {
            0L
        }
    }

    /** Reflects saved bubble settings in the radio group + sliders. */
    private fun syncAppearanceUi() {
        when (Prefs.iconStyle(this)) {
            "chat" -> iconGroup.check(R.id.radioChat)
            "dot" -> iconGroup.check(R.id.radioDot)
            "custom" -> iconGroup.check(R.id.radioCustom)
            else -> iconGroup.check(R.id.radioInitials)
        }
        sizeSeek.max = 96
        sizeSeek.min = 40
        sizeSeek.progress = Prefs.bubbleSizeDp(this)
        sizeValue.text = "${Prefs.bubbleSizeDp(this)} dp"
        alphaSeek.max = 100
        alphaSeek.min = 20
        alphaSeek.progress = Prefs.transparencyPct(this)
        alphaValue.text = "${Prefs.transparencyPct(this)}%"
        panelAlphaSeek.max = 80
        panelAlphaSeek.min = 20
        panelAlphaSeek.progress = Prefs.panelAlphaPct(this)
        panelAlphaValue.text = "${Prefs.panelAlphaPct(this)}%"
    }

    private fun refreshStatus() {
        val overlayOk = Settings.canDrawOverlays(this)
        statusOverlay.text = "1. Display over other apps: ${if (overlayOk) "granted ✓" else "not granted"}"
        val a11yOk = isAccessibilityEnabled()
        statusA11y.text = "2. Accessibility service: ${if (a11yOk) "enabled ✓" else "not enabled"}"
        a11yHint.visibility = if (a11yOk) android.view.View.GONE else android.view.View.VISIBLE
        // Proof of life independent of the toggle above: if captures flow,
        // the reader is alive no matter what any status string claims.
        val last = ChatBus.all().firstOrNull()
        statusCapture.text = if (last == null) {
            "Last capture: none yet — open a chat in a supported app."
        } else {
            val whenText = java.text.SimpleDateFormat("HH:mm, dd MMM", java.util.Locale.getDefault())
                .format(java.util.Date(last.second.at))
            "Last capture: $whenText • ${ChatBus.labelFor(last.first, last.second)}"
        }
        val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
        val exempt = pm.isIgnoringBatteryOptimizations(packageName)
        statusBattery.text =
            "3. Battery optimization: ${if (exempt) "off ✓ (bubble stays alive)" else "ON — bubble dies after minutes"}"
        findViewById<Button>(R.id.btnBattery).visibility =
            if (exempt) android.view.View.GONE else android.view.View.VISIBLE
    }

    private fun isAccessibilityEnabled(): Boolean {
        // Package-prefix match instead of the exact flattened component:
        // survives short-form entries, renames, and OEM string quirks in
        // the secure setting that made the strict check report "not
        // enabled" on devices where the service was actually running.
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
        return enabled?.split(":")?.any { it.startsWith("$packageName/") } == true
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    private fun startForegroundServiceCompat() {
        val intent = Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_START)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
    }
}
