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
      MainActivity.kt         # onboarding: 2 permissions + backend URL + test
      OverlayService.kt       # foreground service, bubble + suggestion panel
      ChatReaderService.kt    # accessibility reader (3 whitelisted packages)
      ChatBus.kt              # latest-snapshot bus between reader and overlay
      ApiClient.kt            # zero-dependency client for /api/suggest
      Prefs.kt                # backend URL + tone settings
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
Build → Build APK(s). APK lands in `app/build/outputs/apk/debug/`.

**Option B — command line:**
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
C:\path\to\gradle-8.10.2\bin\gradle.bat assembleDebug
# APK: app\build\outputs\apk\debug\app-debug.apk
```
(`local.properties` already points at this machine's SDK. AGP 8.5.2 needs
Gradle 8.7+ and JDK 17+.)

## Install on your phone

1. Copy `app-debug.apk` to the phone (USB / Drive / WhatsApp-to-self) and tap
   it, **or** with USB debugging on: `adb install app-debug.apk`
   (`adb` lives in `%LOCALAPPDATA%\Android\Sdk\platform-tools\`).
2. Allow "Install unknown apps" when prompted (debug builds only; no Play
   Store needed for personal testing).
3. Open **Chat Assist Overlay** and grant, in order:
   1. **Display over other apps** → Allow
   2. **Accessibility → Chat Assist Overlay** → enable (read the on-screen
      explanation first — it states exactly what is read and why)
4. Tap **Send test suggestion request** to verify the backend URL works
   without opening Tinder.
5. Tap **Start bubble**, open Tinder/Hinge/Bumble → bubble appears → open a
   chat → tap bubble → suggestions. Tap a suggestion to copy it, then paste
   it into the chat yourself.
6. **Move the panel:** drag it by its title bar — it lives in the top 60% of
   the screen and the suggestion list scrolls inside it.
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
Hinglish, name puns) flows to the overlay for free. Default URL is the
production web app; override it on the onboarding screen.

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
