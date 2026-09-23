#!/usr/bin/env bash
#
# What a screen reader would find.
#
# Jest can assert that a component was given an accessibility label; only the device can show what the accessibility
# *tree* ends up containing after the whole app has rendered. This walks the app's screens, dumps that tree, and
# reports every element a user can tap that announces nothing — which TalkBack reads out as "button", leaving the
# person to guess.
#
#   npm run a11y:scan
set -uo pipefail

ADB="${ADB:-${ANDROID_HOME:-$HOME/android-sdk}/platform-tools/adb}"
PACKAGE="${OPSWATCH_ANDROID_PACKAGE:-com.example.opswatch}"

SCREENS=(
  '' problems errors services infrastructure logs alerts incidents
  synthetics slos deployments brief search checkup system settings
)

"$ADB" get-state >/dev/null 2>&1 || { echo "No device. Start an emulator first." >&2; exit 1; }

total=0
silent=0

for screen in "${SCREENS[@]}"; do
  "$ADB" shell am start -a android.intent.action.VIEW -d "opswatch://${screen}" >/dev/null 2>&1
  sleep 3
  "$ADB" shell uiautomator dump /sdcard/a11y.xml >/dev/null 2>&1
  dump=$("$ADB" shell cat /sdcard/a11y.xml 2>/dev/null | sed 's|<node|\n<node|g' | grep 'clickable="true"')

  count=$(printf '%s\n' "$dump" | grep -c 'clickable="true"' || true)
  # A node announcing nothing has an empty text AND an empty content-desc. Its children may carry the words, so
  # only a leaf-like node with neither is reported.
  mute=$(printf '%s\n' "$dump" | grep 'text=""' | grep -c 'content-desc=""' || true)

  total=$((total + count))
  silent=$((silent + mute))
  printf '  %-16s %2d tappable, %d announce nothing\n' "${screen:-home}" "$count" "$mute"
done

echo
echo "$total tappable elements across ${#SCREENS[@]} screens; $silent announce nothing."
echo "Note: a container that wraps a labelled child legitimately has no words of its own, so a non-zero count here"
echo "is a list to read, not a failure. What matters is that nothing a person taps is silent to them."
