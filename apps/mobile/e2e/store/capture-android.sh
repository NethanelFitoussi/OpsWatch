#!/usr/bin/env bash
#
# Google Play screenshots, from a real Android emulator running a real release build.
#
# These are the assets Play receives, and they are genuine: real Android, the real app, the real status bar and
# navigation bar. The web renders under store-assets/*/preview-web are for reviewing layout at other sizes; they are
# not a substitute, because a browser has no Android chrome.
#
#   npm run store:android
#
# Needs: an emulator already running (see docs/mobile/android.md), a JDK 17 and the Android SDK.
set -euo pipefail

cd "$(dirname "$0")/../.."

ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
PACKAGE="${OPSWATCH_ANDROID_PACKAGE:-com.example.opswatch}"
LOCALE="${OPSWATCH_STORE_LOCALE:-en}"
OUT="$(cd ../.. && pwd)/mobile/store-assets/google-play/$LOCALE/android-emulator"
# The same instant the web capture pins, so both sets tell the same story at the same moment.
INSTANT=1773740520000

# Play accepts a phone screenshot between 16:9 and 9:16. The emulator's own 1080x2400 is 9:20 — taller than Play
# allows — so it is resized to 1080x1920 for the capture and restored afterwards.
WIDTH=1080
HEIGHT=1920

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

"$ADB" get-state >/dev/null 2>&1 || { echo "No device. Start an emulator first (docs/mobile/android.md)." >&2; exit 1; }

say "1/5  Building a release APK with the clock pinned"
EXPO_PUBLIC_SCREENSHOT_AT="$INSTANT" npx expo export --clear --platform android --output-dir /tmp/opswatch-store-bundle >/dev/null
(cd android && EXPO_PUBLIC_SCREENSHOT_AT="$INSTANT" JAVA_HOME="${JAVA_HOME:-$HOME/jdk/jdk-17.0.20.1+1}" ANDROID_HOME="$ANDROID_HOME" ./gradlew assembleRelease -q)

BUNDLE=android/app/build/generated/assets/react/release/index.android.bundle
grep -q "$INSTANT" "$BUNDLE" || { echo "The APK's bundle is not pinned to $INSTANT. Gradle reused a stale bundle; delete $(dirname "$BUNDLE") and retry." >&2; exit 1; }

say "2/5  Installing, and resizing the screen to ${WIDTH}x${HEIGHT}"
"$ADB" install -r android/app/build/outputs/apk/release/app-release.apk >/dev/null
"$ADB" shell pm clear "$PACKAGE" >/dev/null
"$ADB" shell wm size "${WIDTH}x${HEIGHT}" >/dev/null
"$ADB" shell wm density 420 >/dev/null
"$ADB" shell settings put system font_scale 1.0 >/dev/null
# Android's own SystemUI demo mode: a fixed clock, full signal, no notification icons. Without it the status bar
# carries the wall clock and whatever the emulator happened to be doing, which differs between runs and is the
# first thing that makes a capture look like a developer screenshot rather than a product one.
"$ADB" shell settings put global sysui_demo_allowed 1 >/dev/null
sysui() { "$ADB" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null 2>&1 || true; }
sysui enter
sysui clock -e hhmm 0941
sysui battery -e level 100 -e plugged false
sysui network -e wifi show -e level 4
sysui network -e mobile show -e datatype none -e level 4
sysui notifications -e visible false
trap '"$ADB" shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null 2>&1 || true; "$ADB" shell wm size reset >/dev/null 2>&1 || true; "$ADB" shell wm density reset >/dev/null 2>&1 || true' EXIT

say "3/5  Entering the demo"
"$ADB" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 12
ADB="$ADB" ./dev/device/tap.sh 'Explore the demo' >/dev/null
sleep 8

# A non-English set switches language through the app's own setting, exactly as the web capture does, so the
# screenshots show what that user really gets. Without this the locale would only change the output directory and
# the images would be English filed under the wrong language.
if [ "$LOCALE" != "en" ]; then
  case "$LOCALE" in
    fr) LANGUAGE_LABEL='Français' ;;
    *)  echo "No language label known for locale '$LOCALE'. Add one to $0." >&2; exit 1 ;;
  esac
  "$ADB" shell am start -a android.intent.action.VIEW -d "opswatch://settings" >/dev/null 2>&1
  sleep 5
  ADB="$ADB" ./dev/device/tap.sh "$LANGUAGE_LABEL" --scroll >/dev/null
  sleep 3
fi

say "4/5  Capturing"
mkdir -p "$OUT"
shot() {
  local name="$1" path="$2" settle="$3"
  "$ADB" shell am start -a android.intent.action.VIEW -d "opswatch://${path}" >/dev/null 2>&1
  sleep 5
  "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  if ! "$ADB" shell cat /sdcard/ui.xml 2>/dev/null | grep -q "$settle"; then
    echo "  ! $name: '$settle' not on screen — capturing anyway, check the image" >&2
  fi
  "$ADB" shell screencap -p "/sdcard/$name.png" >/dev/null
  "$ADB" pull "/sdcard/$name.png" "$OUT/$name.png" >/dev/null
  "$ADB" shell rm "/sdcard/$name.png" >/dev/null 2>&1 || true
  echo "  ✓ $name"
}

# Kept in step with e2e/store/story.ts; the validator fails if the two sets disagree.
shot 01-production-health ''                      'Is Production healthy'
shot 02-what-changed      'brief'                 'brief'
shot 03-problems          'problems'              'Problems'
shot 04-problem-detail    'problems/prb-checkout-5xx' 'checkout-api'
shot 05-errors            'errors/err-checkout-currency' 'TypeError'
shot 06-checkup           'checkup'               'checks ran'
shot 07-system-status     'system'                'Collecting'

say "5/5  Validating"
cd "$(dirname "$0")/../.." && npm run --silent store:validate

echo
echo "Google Play assets: $OUT"
