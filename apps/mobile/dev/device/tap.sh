#!/usr/bin/env bash
# Taps the on-screen element whose text or content-description matches $1 (a grep -E pattern).
#
# Device QA scripts used to tap fixed coordinates, which silently went stale whenever a screen
# gained a paragraph: the tap landed on nothing, the run continued, and the screenshot at the end
# looked like a product bug rather than a stale script. This resolves the element first and fails
# loudly when it is not on screen.
set -euo pipefail
ADB="${ADB:-${ANDROID_HOME:-$HOME/android-sdk}/platform-tools/adb}"
pattern="$1"

"$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
# clickable="true" first: a label often also appears in body copy, and tapping the prose does nothing.
# One node per line. (`tr '>' '>\n'` looks like it would do this and does not: tr truncates the
# longer set, so it replaces '>' with '>' and leaves the document on a single line — which then
# matches at the root node and taps the middle of the screen.)
dump=$("$ADB" shell cat /sdcard/ui.xml 2>/dev/null | sed 's|<node|\n<node|g' \
  | grep -iE "(text|content-desc)=\"[^\"]*${pattern}[^\"]*\"")
match=$(printf '%s\n' "$dump" | grep 'clickable="true"' | head -1)
[ -z "$match" ] && match=$(printf '%s\n' "$dump" | head -1)
bounds=$(printf '%s\n' "$match" \
  | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 \
  | grep -oE '[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+' || true)

if [ -z "$bounds" ]; then
  echo "tap.sh: nothing on screen matches /${pattern}/" >&2
  exit 1
fi
x1=${bounds%%,*}; rest=${bounds#*,}
y1=${rest%%]*}; rest=${rest#*[}
x2=${rest%%,*}; y2=${rest#*,}
"$ADB" shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
echo "tapped /${pattern}/ at $(( (x1 + x2) / 2 )),$(( (y1 + y2) / 2 ))"
