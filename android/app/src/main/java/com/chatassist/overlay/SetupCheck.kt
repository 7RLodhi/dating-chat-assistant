package com.chatassist.overlay

import android.content.Context
import android.provider.Settings

/**
 * The two setup steps the bubble depends on. Shared by the setup screen and
 * the overlay service so both agree on when the bubble is really usable.
 */
object SetupCheck {
    fun overlayGranted(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

    fun accessibilityEnabled(ctx: Context): Boolean {
        // Package-prefix match instead of the exact flattened component:
        // survives short-form entries, renames, and OEM string quirks in
        // the secure setting that made the strict check report "not
        // enabled" on devices where the service was actually running.
        val enabled = Settings.Secure.getString(
            ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        )
        return enabled?.split(":")?.any { it.startsWith("${ctx.packageName}/") } == true
    }

    /** Steps 1 and 2 both done: the bubble works everywhere, including inside this app. */
    fun complete(ctx: Context): Boolean = overlayGranted(ctx) && accessibilityEnabled(ctx)
}
