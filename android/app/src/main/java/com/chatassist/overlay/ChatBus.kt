package com.chatassist.overlay

/**
 * In-process bus between ChatReaderService (accessibility) and OverlayService
 * (UI). The reader pushes freshly extracted conversation text; the overlay
 * pulls it when the user opens the panel or taps refresh. No persistence —
 * the latest snapshot only.
 */
object ChatBus {
    @Volatile
    var latestApp: String = ""

    @Volatile
    var latestText: String = ""

    @Volatile
    var latestAt: Long = 0L

    @Synchronized
    fun publish(appPackage: String, text: String) {
        // Ignore duplicate snapshots so we don't spam the backend.
        if (appPackage == latestApp && text == latestText) return
        latestApp = appPackage
        latestText = text
        latestAt = System.currentTimeMillis()
    }
}
