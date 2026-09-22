# Store assets

The screenshots for the App Store and Google Play, and the pipeline that regenerates them.

Nothing here has been submitted anywhere. The point is that when someone decides to publish, the assets already
exist and can be rebuilt after any UI change with one command, instead of being recreated by hand at the worst
possible moment.

## What is in the repository, and how genuine each part is

This distinction matters more than anything else on this page, so it is first.

| Path | What it is | Genuine? |
|---|---|---|
| `mobile/store-assets/google-play/<locale>/android-emulator/` | **The Google Play set.** Captured from a real Android emulator running a real release APK: real Android, real status bar, real navigation bar | **Yes — ready to upload** |
| `mobile/store-assets/apple/preview-web/<locale>/apple-6.9/` | Layout previews at the exact 6.9-inch pixel size, rendered in a browser | **No.** Correct layout, but no iOS status bar, no Dynamic Island, no native chrome |
| `mobile/store-assets/apple/preview-web/<locale>/apple-6.5/` | The same at 6.5 inches | No |
| `mobile/store-assets/google-play/preview-web/<locale>/play-phone/` | The same at Play's phone size, for comparing against the emulator set | No |
| `mobile/store-assets/apple/app-store/` | Where the real Apple assets go | **Empty.** See [Generating the Apple set](#generating-the-apple-set-macos-only) |

**The Apple set has never been generated.** This app has never run on iOS at all ([ios.md](ios.md)); there is no Mac
here. The previews are useful — they catch clipped text and bad spacing at Apple's aspect ratios, which is most of
what goes wrong — but they are not screenshots of the app running on iOS and must not be uploaded as if they were.

Each `.png` has a `.txt` beside it holding that screen's caption and its full text. See
[Regenerating](#regenerating-after-a-ui-change) for why the text file is the thing to read in a diff.

## The screen story

One definition, `apps/mobile/e2e/store/story.ts`, used by every target, so the two stores tell the same story and a
screen added once appears in both. The order is the filename, which is the order a store lists them in.

| # | Screen | What it says |
|---|---|---|
| 01 | Production health | Is production healthy, and do I need to act? |
| 02 | What changed | What changed since yesterday, without reading a dashboard |
| 03 | Problems | Every open problem, worst first, with what it affects |
| 04 | Problem detail | Why OpsWatch thinks this is a problem: the evidence |
| 05 | Errors | Exceptions grouped by fingerprint, with the frame that is yours |
| 06 | Services | Every service, its health, and what is wrong with it |
| 07 | Infrastructure | The infrastructure underneath, and what is struggling |
| 08 | System status | Whether OpsWatch itself is collecting — so you know if you can trust the rest |

**Only capabilities that genuinely exist.** Every screen here works today against the demo and against a server that
implements the corresponding capability. Nothing is a placeholder, a disabled control or a "coming soon", and nothing
is behind a server feature that is not implemented — Ask OpsWatch and push notifications are therefore absent, because
no server provides them yet ([api-contract.md](api-contract.md)).

## The data

Screenshot mode is **the demo**, with time held still. It is the same demo client, the same fixtures and the same
capability set the app really has — not a second fake-data system built for the camera
(`apps/mobile/src/demo/screenshot-mode.ts`).

Setting `EXPO_PUBLIC_SCREENSHOT_AT` to an epoch in milliseconds pins two things: the demo builds its dataset at that
instant and never rebuilds it, and the app's shared clock stops there. Polling is switched off too, because a refetch
landing between the page settling and the shutter changes the screen. Every relative time on screen —
"4 min ago", "ongoing for 43 min" — then follows from the pinned instant.

The instant is **2026-03-17T09:42:00Z**, an ordinary weekday mid-morning. Unset — which is every build that is not
being photographed — none of this exists and the app behaves normally.

**No real data can appear**, and this is structural rather than a promise: the screenshots can only contain what the
demo fixtures contain. `npm run store:validate` scans that dataset for anything shaped like an AWS key, a bearer
token, a GitHub or AI provider key, a private IP address, a 12-digit account id, a localhost or LAN URL, or an email
address outside the fictional demo domains. That proves the data *could not* have been private, which is stronger
than checking that a particular image happens not to show it.

**The DEMO DATA banner stays.** It is in every screenshot, and deliberately: the app really does show it in demo mode,
and hiding it would present fictional numbers as though they were a real estate's. For a monitoring tool, being
visibly honest about that is worth more than the strip of pixels it costs.

## Regenerating

### Google Play — the real set

Needs a running Android emulator, a JDK 17 and the Android SDK ([android.md](android.md#setting-up-android-from-nothing)).

```bash
cd apps/mobile
npm run store:android
```

It builds a release APK with the clock pinned, checks the APK's JavaScript bundle really contains the pinned instant
(Gradle will happily package a stale bundle — see [android.md](android.md#make-sure-you-are-testing-the-apk-you-just-built)),
resizes the emulator to 1080×1920, walks the story by deep link, captures, restores the screen size and validates.

The emulator's own 1080×2400 is 9:20 — taller than Play accepts — so the capture resizes it. Play takes a phone
screenshot between 16:9 and 9:16.

### The layout previews

```bash
cd apps/mobile
npm run store:capture          # English
npm run store:capture:fr       # French
npm run store:validate
```

`store:capture` exports the web build **with the clock pinned** and then captures. Running `npm run store:web` on its
own photographs whatever `dist-web` happens to contain, which is how a set was once produced with a live clock and
nobody noticed — so the run now refuses a build whose clock is not pinned, and says so.

`npm run store:capture` is `npm run store:export` followed by the capture, so the export cannot be skipped by
accident.

> Metro caches inlined `EXPO_PUBLIC_*` values, so an export without `--clear` can silently reuse the previous
> instant. `store:export` passes `--clear` for that reason.

### French

The French set is captured by switching the language through **the app's own setting**, not through a
capture-only override, so the screenshots show what a French user actually gets and no code path exists purely to be
photographed. English is the primary set; French is a complete parallel set under `<locale>/fr/`.

```bash
cd apps/mobile
npm run store:capture:fr                              # previews
OPSWATCH_STORE_LOCALE=fr npm run store:android        # the Play set
```

**What is and is not translated in the French set.** The app's own words are French — navigation, labels, statuses,
relative times, number formatting. The *content* is not: headlines like "Checkout is failing for about 7 % of
requests" come from the demo dataset, which is written once in English, exactly as a real server would send whatever
it holds. That is the truthful picture of a French user's screen against an English-speaking server, and it is worth
knowing before someone files it as a bug. Translating the fixtures is possible and would make a more flattering
French set; it has not been done.

### Regenerating after a UI change

Run the commands above and read the `.txt` files in the diff, not the images.

The **content** is deterministic: the same instant, the same fixtures, the same words every run — verified by
capturing twice and comparing. The **pixels** are not. A browser's rasteriser antialiases a fraction differently from
run to run, which no reader can see and which makes every PNG differ in git. So the `.txt` beside each image is the
reviewable artefact: if it has not changed, nothing a user would notice has changed; if it has, the diff says exactly
what.

## Generating the Apple set (macOS only)

**Not possible here, and not attempted.** This is the procedure for whoever has a Mac. Nothing below has been run —
see [testing.md](testing.md#which-documented-commands-have-been-run).

Apple wants an exact pixel size per device class. A 6.9-inch iPhone set (1290 × 2796) is the one App Store Connect
requires; 6.5-inch (1242 × 2688) is still accepted and worth having.

```bash
# 1. A simulator of the right class. Names change between Xcode versions, so list first.
xcrun simctl list devices available | grep -i "iPhone"
xcrun simctl boot "iPhone 16 Pro Max"          # 6.9-inch, 1290 × 2796

# 2. A development build with the clock pinned, exactly as the other targets pin it.
cd apps/mobile
EXPO_PUBLIC_SCREENSHOT_AT=1773740520000 npx expo run:ios --configuration Release --device "iPhone 16 Pro Max"

# 3. A clean status bar. Without this the screenshots carry whatever time and battery the simulator had,
#    which differs between runs and looks like a developer capture.
xcrun simctl status_bar "iPhone 16 Pro Max" override \
  --time "09:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3

# 4. Walk the story and capture. The routes are the `path` values in e2e/store/story.ts.
OUT=../../mobile/store-assets/apple/app-store/en/6.9
mkdir -p "$OUT"
for shot in "01-production-health:/" "02-what-changed:/brief" "03-problems:/problems" \
            "04-problem-detail:/problems/prb-checkout-5xx" "05-errors:/errors/err-checkout-currency" \
            "06-services:/services" "07-infrastructure:/infrastructure" "08-system-status:/system"; do
  name="${shot%%:*}"; path="${shot#*:}"
  xcrun simctl openurl booted "opswatch://${path#/}"
  sleep 4
  xcrun simctl io booted screenshot --type=png "$OUT/$name.png"
done

# 5. Same checks as every other target.
cd apps/mobile && npm run store:validate
```

Then add `apple-6.9` real output to `SIZES` in `apps/mobile/e2e/store/validate.ts` if you place it under a different
directory name, so the size check covers it.

For the French set, switch the language in Settings first, exactly as the web capture does, and write to
`.../app-store/fr/6.9`.

**Before uploading, confirm by eye:** the status bar is the overridden one, there is no debug menu, no Expo launcher,
nothing is clipped, and the Dynamic Island does not overlap content. Then replace the `preview-web` images in any
listing draft with these.

## Validation

```bash
cd apps/mobile && npm run store:validate
```

| Check | What it catches |
|---|---|
| Exact pixel size per target | An asset a store will reject outright |
| Portrait orientation | A capture taken while the device was rotated |
| Aspect ratio within 16:9–9:16 **for Play only** | Play's rule. Apple's iPhone sizes are deliberately taller than 9:16, so applying Play's range to them rejects valid assets — a mistake this validator made until it was corrected |
| The set matches the story | A screen added to the story and never captured, or a stale file left behind |
| File size sanity | A blank or failed capture that still produced a PNG |
| The demo dataset holds no credential, private address, account id or outside email | Anything private reaching a public listing |

The capture run itself refuses a build whose clock was not pinned.

## Adding a screen later

As the server implements repository evidence, AI, notifications, incidents or SLOs, the mobile screens for them stop
being gated and become photographable. To add one:

1. Add an entry to `apps/mobile/e2e/store/story.ts` — name, caption, route, and a testID to wait for.
2. Add the matching `shot` line to `apps/mobile/e2e/store/capture-android.sh`.
3. Re-run the commands above. The validator fails until every target has the new screen, so a half-updated set
   cannot be shipped.

Do not add a screen that only works in the demo. Everything in the story must work against a server that implements
the capability, or the listing advertises something a buyer will not get.
