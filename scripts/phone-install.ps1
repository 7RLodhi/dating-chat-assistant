# Installs the latest debug APK on a USB-connected Android phone, grants the
# overlay permission, starts the bubble (via the app's Start button), and
# reports crashes. Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\phone-install.ps1 -Apk android\chat-assist-0.61.0.apk
param(
    [Parameter(Mandatory = $true)] [string] $Apk,
    [string] $Package = "com.chatassist.overlay",
    [string] $Device = ""
)

$ErrorActionPreference = "Stop"
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }

$serials = @(& $adb devices | Select-String "\tdevice$" | ForEach-Object { ($_.Line -split "\t")[0] })
if ($Device) { $serials = @($Device) }
if ($serials.Count -eq 0) { throw "No phone detected. Connect it over USB with USB debugging on." }
if ($serials.Count -gt 1) { throw "More than one device connected; pass -Device <serial>." }
$s = $serials[0]
function Adb { & $adb -s $s @args }

Write-Output "Installing $(Split-Path $Apk -Leaf) on $s ..."
$install = Adb install -r $Apk 2>&1 | Out-String
if ($install -notmatch "Success") { throw "Install failed: $install" }

$ver = (Adb shell dumpsys package $Package | Select-String "versionName=" | Select-Object -First 1).Line.Trim()
Write-Output "Installed: $ver"

Adb shell appops set $Package SYSTEM_ALERT_WINDOW allow | Out-Null
Write-Output "Overlay permission: granted"

# Collapse the notification shade if it is open, or it hides the app.
Adb shell cmd statusbar collapse | Out-Null
Adb shell am start -n "$Package/.MainActivity" | Out-Null
Start-Sleep -Seconds 2

# Start from the top of the setup screen (it may be left scrolled down from
# a previous run), then scroll down until the Start button is on screen.
for ($i = 0; $i -lt 6; $i++) {
    Adb shell input swipe 540 900 540 1900 300 | Out-Null
    Start-Sleep -Milliseconds 400
}
$tapped = $false
for ($attempt = 0; $attempt -le 40 -and -not $tapped; $attempt++) {
    Adb shell uiautomator dump /sdcard/ui.xml | Out-Null
    $xml = (Adb shell cat /sdcard/ui.xml) -join ""
    # Buttons render in capitals ("START BUBBLE"), so match case-insensitively.
    $m = [regex]::Match($xml, 'text="Start bubble"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', 'IgnoreCase')
    if ($m.Success) {
        $x = [int](([int]$m.Groups[1].Value + [int]$m.Groups[3].Value) / 2)
        $y = [int](([int]$m.Groups[2].Value + [int]$m.Groups[4].Value) / 2)
        $screenH = [int]([regex]::Match($xml, 'bounds="\[0,0\]\[(\d+),(\d+)\]"').Groups[2].Value)
        if ($screenH -gt 0 -and $y -lt $screenH - 50) {
            Adb shell input tap $x $y | Out-Null
            $tapped = $true
            break
        }
    }
    # Scroll the setup list down (finger moves up from the lower screen).
    Adb shell input swipe 540 1800 540 900 400 | Out-Null
    Start-Sleep -Milliseconds 700
}
if ($tapped) { Write-Output "Start bubble: tapped" } else { Write-Output "Start bubble: not found after scrolling" }
Start-Sleep -Seconds 3

$crashes = @(Adb logcat -d -t 300 | Select-String "FATAL EXCEPTION|AndroidRuntime.*$Package")
if ($crashes.Count -gt 0) {
    Write-Output "CRASHES FOUND:"
    $crashes | Select-Object -First 5 | ForEach-Object { $_.Line }
} else {
    Write-Output "Crashes: none"
}
