# Chat Assist Overlay — Android app (v1 scaffold)

Native floating-overlay companion to the web app. A draggable bubble floats
over Tinder / Hinge / Bumble / Snapchat / Instagram / WhatsApp; an
AccessibilityService reads the visible chat text (those six apps only); the
overlay sends it to your suggestion backend and shows replies you can
tap-to-copy. **Read-only by design: the app never types, taps, or sends
anything into other apps.**

Snapchat notes: only typed chat messages carry text — photo/video snaps and
voice notes can't be read. View-once messages are captured only while visible
on screen. Delivery statuses (Delivered/Opened/…) and date headers are
filtered out automatically.

Instagram notes: "Seen" receipts and the message-box hint are filtered.
Suggested quick-reply chips look identical to short real messages, so they
are left in — delete the odd stray row if one slips through.

WhatsApp notes: message timestamps glued inside bubbles ("Hello\n10:30 pm")
are stripped automatically, as are encryption notices, unread dividers,
presence lines and date headers. Voice notes and quoted blocks have no
separable text; quoted replies appear as plain lines.

## Project layout

```
android/
  settings.gradle.kts / build.gradle.kts / gradle.properties
  local.properties            # YOUR SDK path (gitignored, machine-specific)
  app/
    build.gradle.kts          # applicationId com.chatassist.overlay, minSdk 29
    src/main/AndroidManifest.xml
    src/main/java/com/chatassist/overlay/
      MainActivity.kt         # onboarding: 2 permissions + appearance + test
      OverlayService.kt       # foreground service, bubble + suggestion panel
      ChatReaderService.kt    # accessibility reader (3 whitelisted packages)
      ChatBus.kt              # latest-snapshot bus between reader and overlay
      ApiClient.kt            # zero-dependency client for /api/suggest
      Prefs.kt                # bubble/panel appearance + tone settings
      parsers/ChatParser.kt   # generic tree-walk + Tinder/Hinge/Bumble tweaks
    src/main/res/...
```

## Build here (this machine already has everything)

Prerequisites present: Android Studio (`C:\Program Files\Android\Android Studio`),
SDK + build-tools + platforms. JDK note: Studio's bundled `jbr/` on this
machine is incomplete for command-line builds — use a portable Eclipse
Temurin 21 instead (no admin needed):
`C:\Users\aarog\AppData\Local\Temp\opencode\jdk\jdk-21.0.12.1+1`
(permanent home recommended if you rebuild often).

**Option A — Android Studio (easiest):** File → Open → select the `android/`
folder → let Gradle sync (downloads AGP/deps on first run) → Run ▶ or
Build → Build APK(s). APK lands in
`%LOCALAPPDATA%\AndroidBuild\chat-assist-app\outputs\apk\debug\`
(build outputs are deliberately outside OneDrive — its sync locks files
mid-build; see `layout.buildDirectory` in `app/build.gradle.kts`).

**Option B — command line:**
```powershell
$env:JAVA_HOME = "C:\Users\aarog\AppData\Local\Temp\opencode\jdk\jdk-21.0.12.1+1"
C:\Users\aarog\AppData\Local\Temp\opencode\gradle\gradle-8.10.2\bin\gradle.bat renameDebugApk
# APK: %LOCALAPPDATA%\AndroidBuild\chat-assist-app\outputs\apk\debug\app-debug-<versionName>.apk
# (renameDebugApk runs assembleDebug first, then stamps the version into the file name)
```
(`local.properties` already points at this machine's SDK. AGP 8.5.2 needs
Gradle 8.7+ and JDK 17+.)

## Install on your phone

1. Copy `app-debug-<version>.apk` (from the build dir above) to the phone (USB / Drive /
   WhatsApp-to-self) and tap it, **or** with USB debugging on: `adb install app-debug-<version>.apk`
   (`adb` lives in `%LOCALAPPDATA%\Android\Sdk\platform-tools\`).
2. Allow "Install unknown apps" when prompted (debug builds only; no Play
   Store needed for personal testing).
3. Open **Chat Assist Overlay** and grant, in order:
   1. **Display over other apps** → Allow
   2. **Accessibility → Chat Assist Overlay** → enable (read the on-screen
      explanation first — it states exactly what is read and why)
4. Tap **Send test suggestion request** to verify the backend URL works
   without opening Tinder.
5. Tap **Start bubble** (it spawns docked to the middle of the right edge —
   drag it anywhere), open a chat → tap bubble → suggestions. Tap a
   suggestion to copy it, then paste it into the chat yourself. The tone
   dropdown lives in the panel header — changing it regenerates immediately.
6. **Move the panel:** drag it by its title bar — it lives in the top 60% of
   the screen and the suggestion list scrolls inside it. **Resize it:** drag
   the ◢ grip in the bottom-right corner; the size is remembered for next
   time (clamped to the screen).
7. **Steer the vibe:** the tone dropdown inside the panel (Auto/Casual/…/
   Spicy 18+) regenerates suggestions immediately on change.
8. **Customize** (same screen, Fooview-style): bubble icon (initials / 💬 /
   minimal dot / gallery image), bubble size (40–96 dp) and transparency
   (20–100%), panel opacity (20–80%). Then tap **Start bubble** again to apply.
9. **Multiple matches:** the app remembers the latest conversation per chat
   (keyed by app + contact name shown in the header) — switch chats and the
   panel shows which chat its suggestions belong to ("Sneha • Tinder").
   Memory is in-RAM only (max 10 chats); a process restart starts fresh.

## Tuning per-app parsers

`parsers/ChatParser.kt` walks each app's accessibility tree generically
(left = match, right = you, top-to-bottom). When a dating app redesigns its
chat UI, extraction degrades — fix it per app in `TinderParser`,
`HingeParser`, `BumbleParser`, `SnapchatParser`, `InstagramParser`, or
`WhatsAppParser`. Three filter tiers, in increasing caution:
`skipTextSubstrings` for unmistakable multi-word chrome, `skipExactTexts`
for whole-text UI labels (delivery statuses, presence lines) that must never
swallow real messages containing those words, and `skipPatterns` for anchored
regexes like locale date headers. Add new apps by subclassing and registering
the package in `ChatReaderService.SUPPORTED_PACKAGES` **and** in
`res/xml/accessibility_service_config.xml`.

## Backend contract

`POST {backendUrl}` with
`{mode:"reply", conversationText, tone, goal:"keep_it_light", language:"auto"}`
expects `{suggestions:[{text,tone}], conversation_read:{summary}}` — the same
contract as the web app's `/api/suggest`, so any improvement there (tones,
Hinglish, name puns) flows to the overlay for free. The URL is fixed to the
production web app (a former onboarding override field was removed — a
typo'd URL silently broke suggestions).

## Tap-to-paste (default on)

Tapping a suggestion fills the foreground chat input directly (found as the
lowest visible editable field). Turn it off under **Automation** in the
app to go back to tap-to-copy. Safeguards, all deliberate:
- The paste is refused unless a supported dating app is actually in front —
  it can never land text in any other app.
- No send action is ever performed. You always review and press send.
- If the chat box can't be found, it falls back to clipboard copy with a
  toast explaining what happened.
- One tap = at most one paste. No queues, no loops, no autonomous behavior.

## Behavior notes

- **Bubble auto-visibility:** the bubble shows only on conversation screens
  inside supported apps — never on homepages, lists, feeds, or this app's
  own screens. Open a chat and it appears; leave the chat and it's gone. No
  manual toggling. It also hides while its own panel is open so it never
  covers panel content. Hides are verified against actually-visible windows
  500ms later, so transient toasts/usage-reminders can't take the bubble down.
- **Explicit start/stop:** the service runs only after you tap Start, and
  stays dead after drop-to-close — opening a dating app never restarts it on
  its own, so nothing runs (or drains) behind your back.
- **Drop-to-close:** drag the bubble to the ✕ target at the bottom-center to
  dismiss the overlay entirely (bubble + panel, service stops). Reopen anytime
  from the app's Start button.
- **Conversation-only capture:** the reader publishes only screens showing a
  chat input — chat lists, Status/Calls tabs, feeds and contact-info screens
  are ignored (plus per-app list markers as backup). Same rule purges junk
  rows saved by older builds on startup.
- **One row per chat:** keys merge case-insensitively, so "NIDHIII…" /
  "Nidhiii…" can never list twice; matches keep hand-added notes and learned
  summaries across re-captures.
- **Per-app switches:** the app's Apps section enables/disables each dating
  app individually (default all on). Unchecked apps get no bubble, no
  capture, no paste, and no panel — instantly, no restart.
- **Bubble-visible ⟺ snapshot-exists:** the conversation verdict flips true
  only when a snapshot is actually stored, so a dropped frame (contaminated,
  list-screen, crash) can never again strand a visible bubble over a dead
  panel. Parse crashes are counted in the capture log ("exception") instead
  of swallowed silently.
- **Tap-to-flip attribution:** tapping a chat row in the panel reassigns it
  to the other side, stores the correction positionally (survives
  re-captures), and regenerates suggestions from the corrected text.
- **👍/👎 taste votes:** every suggestion card carries vote buttons; votes
  crystallize into LEARNED TASTE (same tone/length/emoji rules as the web
  app) and steer all future generations on the device.
- **Feed-contamination gate:** mid-transition frames (friend-list rows mixed
  into chat) are dropped, never published — and a clean capture heals an
  already-stored dirty snapshot at any length.
- **Generous timeouts:** suggestion calls allow 45s (healthy ones take
  8-12s, double on grammar-retry); timeouts report as "servers are slow",
  not raw errors.

- **Panel auto-dismiss:** the panel collapses by itself when you leave all
  supported apps (home, app switch, any other app). The bubble stays — tap it
  to reopen. Switching between two supported apps keeps the panel open but
  showing the previous chat until you tap Refresh (auto-refresh on switch is
  a planned follow-up).
- **Privacy model:** the reader observes every foreground-window change, but
  only the *package name* — message text is extracted exclusively inside the
  six supported apps, never anywhere else. This is also stated verbatim in
  the on-device accessibility description.

## Troubleshooting

**`mergeDebugResources` fails with "Failed to delete some children":**
this project's `app/build/` lives under OneDrive, whose sync locks files
while Gradle tries to clean them. Fix: delete `android/app/build/` and
rebuild. (Long-term: right-click the `android` folder in Explorer →
"Always keep on this device" so OneDrive stops treating build outputs as
cloud placeholders.)

## Before any public/Play Store release

- Play Store **Accessibility API review** is strict — prepare the
  declaration/justification early; expect manual review cycles.
- Dating-app ToS review (read-only assistive use is the defensible side,
  but get explicit guidance).
- Sign release builds (debug key is fine for sideloading only).
