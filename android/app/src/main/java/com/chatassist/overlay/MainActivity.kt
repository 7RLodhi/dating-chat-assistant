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
import android.widget.TextView
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusOverlay = findViewById(R.id.statusOverlay)
        statusA11y = findViewById(R.id.statusA11y)
        inputBackendUrl = findViewById(R.id.inputBackendUrl)
        testResult = findViewById(R.id.testResult)

        inputBackendUrl.setText(Prefs.backendUrl(this))

        findViewById<Button>(R.id.btnOverlay).setOnClickListener {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        findViewById<Button>(R.id.btnA11y).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        findViewById<Button>(R.id.btnStart).setOnClickListener {
            Prefs.setBackendUrl(this, inputBackendUrl.text.toString())
            requestNotificationPermissionIfNeeded()
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
