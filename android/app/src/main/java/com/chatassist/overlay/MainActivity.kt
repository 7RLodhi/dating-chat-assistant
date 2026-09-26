package com.chatassist.overlay

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.widget.Button
import android.widget.EditText
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.SeekBar
import android.widget.TextView
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
    private lateinit var inputBackendUrl: EditText
    private lateinit var testResult: TextView
    private lateinit var iconGroup: RadioGroup
    private lateinit var sizeSeek: SeekBar
    private lateinit var sizeValue: TextView
    private lateinit var alphaSeek: SeekBar
    private lateinit var alphaValue: TextView
    private lateinit var panelAlphaSeek: SeekBar
    private lateinit var panelAlphaValue: TextView

    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@registerForActivityResult
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
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusOverlay = findViewById(R.id.statusOverlay)
        statusA11y = findViewById(R.id.statusA11y)
        inputBackendUrl = findViewById(R.id.inputBackendUrl)
        testResult = findViewById(R.id.testResult)
        iconGroup = findViewById(R.id.iconGroup)
        sizeSeek = findViewById(R.id.sizeSeek)
        sizeValue = findViewById(R.id.sizeValue)
        alphaSeek = findViewById(R.id.alphaSeek)
        alphaValue = findViewById(R.id.alphaValue)
        panelAlphaSeek = findViewById(R.id.panelAlphaSeek)
        panelAlphaValue = findViewById(R.id.panelAlphaValue)

        inputBackendUrl.setText(Prefs.backendUrl(this))
        syncAppearanceUi()

        iconGroup.setOnCheckedChangeListener { _, checkedId ->
            when (checkedId) {
                R.id.radioInitials -> Prefs.setIconStyle(this, "initials")
                R.id.radioChat -> Prefs.setIconStyle(this, "chat")
                R.id.radioDot -> Prefs.setIconStyle(this, "dot")
                R.id.radioCustom -> {
                    // Only switch when an image is already chosen; otherwise
                    // open the picker (its callback sets the style on success).
                    if (Prefs.customIconUri(this).isBlank()) pickImage.launch("image/*")
                    else Prefs.setIconStyle(this, "custom")
                }
            }
        }
        sizeSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seek: SeekBar, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                Prefs.setBubbleSizeDp(this@MainActivity, progress)
                sizeValue.text = "${Prefs.bubbleSizeDp(this@MainActivity)} dp"
            }
            override fun onStartTrackingTouch(seek: SeekBar) {}
            override fun onStopTrackingTouch(seek: SeekBar) {}
        })
        alphaSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seek: SeekBar, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                Prefs.setTransparencyPct(this@MainActivity, progress)
                alphaValue.text = "${Prefs.transparencyPct(this@MainActivity)}%"
            }
            override fun onStartTrackingTouch(seek: SeekBar) {}
            override fun onStopTrackingTouch(seek: SeekBar) {}
        })
        panelAlphaSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seek: SeekBar, progress: Int, fromUser: Boolean) {
                if (!fromUser) return
                Prefs.setPanelAlphaPct(this@MainActivity, progress)
                panelAlphaValue.text = "${Prefs.panelAlphaPct(this@MainActivity)}%"
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
        findViewById<Button>(R.id.btnStart).setOnClickListener {
            Prefs.setBackendUrl(this, inputBackendUrl.text.toString())
            requestNotificationPermissionIfNeeded()
            // Restart (not just start) so bubble appearance edits below
            // always take effect on the running bubble.
            stopService(Intent(this, OverlayService::class.java))
            startForegroundServiceCompat()
        }
        findViewById<Button>(R.id.btnTest).setOnClickListener {
            Prefs.setBackendUrl(this, inputBackendUrl.text.toString())
            testResult.text = "Sending…"
            ApiClient.fetchSuggestions(
                Prefs.backendUrl(this),
                "[MATCH]: hey! how was your weekend?\n[USER]: pretty good, went hiking",
                Prefs.tone(this),
            ) { result ->
                testResult.text = result.fold(
                    onSuccess = { "OK: ${it.suggestions.first()}" },
                    onFailure = { "Failed: ${it.message}" },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        syncAppearanceUi()
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
    }

    private fun isAccessibilityEnabled(): Boolean {
        val expected = ComponentName(this, ChatReaderService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
        return enabled?.split(":")?.any { TextUtils.equals(it, expected) } == true
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
