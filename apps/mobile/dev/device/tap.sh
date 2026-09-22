#!/usr/bin/env bash
# Taps the on-screen element whose text or content-description matches $1 (a grep -E pattern).
#
# Device QA scripts used to tap fixed coordinates, which silently went stale whenever a screen gained a paragraph:
# the tap landed on nothing, the run continued, and the screenshot at the end looked like a product bug rather than
# a stale script. This resolves the element first and fails loudly when it is not on screen.
#
#   tap.sh 'Explore the demo'             # must be visible now
#   tap.sh 'Français' --scroll            # scroll to the top, then look down the screen for it
set -euo pipefail
ADB="${ADB:-${ANDROID_HOME:-$HOME/android-sdk}/platform-tools/adb}"
pattern="$1"
scroll="${2:-}"

# The bounds of the first match, or empty. Prefers a clickable node, because a label usually appears in body copy as
# well and tapping the prose does nothing.
find_bounds() {
  "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  # One node per line. (`tr '>' '>\n'` looks like it would do this and does not: tr truncates the longer set, so it
  # replaces '>' with '>' and leaves the document on a single line — which then matches at the root node and taps
  # the middle of the screen.)
  local dump match
  dump=$("$ADB" shell cat /sdcard/ui.xml 2>/dev/null | sed 's|<node|\n<node|g' \
    | grep -iE "(text|content-desc)=\"[^\"]*${pattern}[^\"]*\"") || true
  match=$(printf '%s\n' "$dump" | grep 'clickable="true"' | head -1) || true
  [ -z "$match" ] && match=$(printf '%s\n' "$dump" | head -1)
  printf '%s\n' "$match" \
    | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 \
    | grep -oE '[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+' || true
}

bounds=$(find_bounds)

if [ -z "$bounds" ] && [ "$scroll" = "--scroll" ]; then
  # Back to the top, then a screenful at a time. Bounded, so a target that is not there fails rather than loops.
  for _ in 1 2 3 4 5 6; do "$ADB" shell input swipe 540 500 540 1600 120 >/dev/null 2>&1; done
  sleep 1
  for _ in 1 2 3 4 5 6 7 8; do
    bounds=$(find_bounds)
    [ -n "$bounds" ] && break
    "$ADB" shell input swipe 540 1500 540 700 200 >/dev/null 2>&1
    sleep 1
  done
fi

if [ -z "$bounds" ]; then
  echo "tap.sh: nothing on screen matches /${pattern}/${scroll:+ (after scrolling)}" >&2
  exit 1
fi

x1=${bounds%%,*}; rest=${bounds#*,}
y1=${rest%%]*}; rest=${rest#*[}
x2=${rest%%,*}; y2=${rest#*,}
"$ADB" shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
echo "tapped /${pattern}/ at $(( (x1 + x2) / 2 )),$(( (y1 + y2) / 2 ))"
