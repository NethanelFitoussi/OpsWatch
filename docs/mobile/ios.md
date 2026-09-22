# iOS

> **This app has never run on iOS.** Not on a simulator, not on a device, not through an EAS build. It was written on
> Linux; every iOS statement below is either configuration that has been read, or a step that still has to be done by
> someone with a Mac. Treat the first iOS run as a test, not a formality — the checklist for it is
> [below](#first-run-on-ios-checklist).

How to run, build and publish OpsWatch on iOS. Nothing has been published, and no Apple account exists for the
project. Steps marked **Requires Apple credentials** can only be done by the owner (or someone they grant access to).

## What needs a Mac

| Task | Mac needed? |
|------|-------------|
| iOS Simulator | Yes (Xcode runs only on macOS) |
| Local iOS builds (`npm run ios`, Xcode archive) | Yes |
| EAS cloud builds (`eas build -p ios`) | No: builds run on Expo's macOS machines |
| Installing an internal build on a registered iPhone | No (link from EAS) |
| TestFlight and App Store Connect | No (web + TestFlight app) |

## What you need on the Mac

| Requirement | Why | Notes |
|---|---|---|
| macOS | Xcode runs nowhere else | |
| **Xcode**, from the Mac App Store | Compiler, simulators, signing | Open it once, accept the licence, and let it install the additional components it asks for |
| Xcode Command Line Tools | `xcodebuild`, `xcrun` | `xcode-select --install`, then `sudo xcode-select -s /Applications/Xcode.app` if it points elsewhere |
| An iOS simulator runtime | Running without a device | Xcode → Settings → Platforms → iOS |
| **CocoaPods** | Native dependencies | `brew install cocoapods` (or `sudo gem install cocoapods`). See below — you rarely run it yourself |
| Node 22 and `npm ci` | Everything else | [development.md](development.md#install) |
| Watchman *(optional)* | Faster file watching | `brew install watchman` |

### CocoaPods, and why you usually do not touch it

The `ios/` folder is **generated and git-ignored** (`apps/mobile/.gitignore`). It is produced by `expo prebuild` from
`app.config.ts` and the installed packages, and it contains a `Podfile` — the app's native dependencies really are
installed with CocoaPods, and the pinned platform is **iOS 16.4**.

You do not normally run `pod install` by hand, because the Expo commands do it for you:

```bash
cd apps/mobile
npm run ios                                   # expo run:ios: prebuild + pod install + build + launch
npx expo prebuild --platform ios              # regenerate ios/ and install pods
npx expo prebuild --platform ios --no-install # regenerate ios/ but skip npm and pods (what was done on Linux)
```

Run it yourself only after editing the `Podfile` directly, or when a pod install was interrupted:

```bash
cd apps/mobile/ios && pod install
```

Because `ios/` is generated, **never edit it expecting the change to last**: the next `expo prebuild` recreates it.
Native configuration belongs in `app.config.ts` or a config plugin. If the folder gets into a bad state, delete it and
regenerate — nothing is lost:

```bash
rm -rf apps/mobile/ios && cd apps/mobile && npx expo prebuild --platform ios
```

### When pods fail

| Symptom | Cause and fix |
|---|---|
| `CocoaPods could not find compatible versions` | Stale local spec repo: `pod repo update`, then `pod install` again |
| `Podfile.lock` conflicts after changing dependencies | Delete `ios/Pods` and `ios/Podfile.lock`, then `pod install`. Both are generated |
| The build picks up an old native module | `npx expo prebuild --platform ios --clean`, then build again |
| `xcodebuild` cannot find a scheme | The scheme is `OpsWatch`; pass `--scheme OpsWatch` to `expo run:ios` if a second one appears |
| Builds succeed but the app shows an old bundle | The JavaScript bundle is cached like Android's. The Android section explains the same trap: [android.md](android.md#make-sure-you-are-testing-the-apk-you-just-built) |

## What has been checked without a Mac

`npx expo prebuild --platform ios --no-install` generates the `ios/` folder (git-ignored). It was generated and read
on 2026-09-20; these are the facts that came out of it, and they are the only iOS facts this project has:

| Checked | Value |
|---------|-------|
| Deployment target | iOS 16.4 (Expo SDK 57 default) |
| Face ID | **No `NSFaceIDUsageDescription`.** The `expo-secure-store` plugin is configured with `faceIDPermission: false`, because the app never asks for biometric authentication and the default string would have claimed it does |
| Local network prompt | `NSLocalNetworkUsageDescription` is OpsWatch's own sentence ("OpsWatch connects to the OpsWatch server you configure…"), not the Expo dev-launcher default |
| URL schemes | `opswatch` (plus the bundle id and the `exp+opswatch` development scheme) |
| App Transport Security | `NSAllowsArbitraryLoads: false`, `NSAllowsLocalNetworking: true` |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` |
| Orientation | iPhone and iPad orientation sets present; `supportsTablet: true` |
| Push entitlement | `aps-environment` present in the generated entitlements (development) |

Nothing about behaviour follows from this: the Keychain accessibility flag, the app-switcher snapshot, Dynamic Type,
the notification permission dialog and universal links have never been observed on iOS.

## First run on iOS: checklist

For the first maintainer with a Mac. It is written to be followed top to bottom, in one sitting of roughly an hour.
Nothing here needs an Apple Developer account except where it says so.

### Before you start

1. macOS with **Xcode** from the Mac App Store. Open it once, accept the license, let it install components.
2. Install an **iOS simulator runtime** (Xcode → Settings → Components).
3. `sudo xcode-select -s /Applications/Xcode.app` so the command line tools point at it.
4. Node 22 (`nvm use` in `apps/mobile`), then `npm ci`.
5. Optional but useful: `brew install watchman`.

### Step 1 — the fastest possible look (Expo Go, 5 minutes)

```bash
cd apps/mobile
npm start          # press s to switch to Expo Go, then i
```

Tap **Explore the demo**. If the app renders and the tabs work, the shared JavaScript is fine on iOS and everything
after this is about native behaviour.

### Step 2 — a real build on the simulator

```bash
npm run ios        # expo run:ios: generates ios/, builds, installs, launches
```

This is the first time this project has been compiled by Xcode. If it fails, that failure is the most valuable thing
you will find today — capture the full error ([Reporting back](#reporting-back)).

### Step 3 — the mock server, over real HTTP

```bash
npm run mock-server        # another terminal
```

In the app: **Connect** → `http://localhost:4010` → tick **Allow plain HTTP for a server on this network** → test →
sign in with `demo@opswatch.dev` / `opswatch-demo`. On the simulator, `localhost` is the Mac.

### Step 4 — what to look for

Tick these on the simulator; the ones marked **device** need a real iPhone (step 5).

| # | What | How | What is correct |
|---|------|-----|-----------------|
| 1 | **App-switcher privacy cover** | Sign in, then swipe up (or press ⌘⇧H twice) to show the app switcher | The OpsWatch card shows the mark and the name, never a screen of data. Then turn the setting off in Settings → the card shows the screen again. This is JavaScript reacting to `AppState`; if iOS snapshots before React commits, you will see a flash of content — say so, it is a known theoretical gap |
| 2 | **Secure storage** | Sign in, force-quit, relaunch | Still signed in, straight to the tabs. Then Settings → Change server → relaunch → back at Connect. A prompt for Face ID or a passcode at any point is a **bug**: the app must never ask for biometrics |
| 3 | **Deep links** | `npx uri-scheme open opswatch://problems/prb-checkout-5xx --ios`, then `opswatch://admin/x`, then `opswatch://problems/..` | The first opens the problem; the other two open Home and nothing else happens |
| 4 | **Deep link while signed out** | Sign out, then run the first command again | Sign-in appears; after signing in, the problem opens |
| 5 | **Notification permission** | Settings → Notifications → switch on | The system prompt appears **only then**, never at launch. Deny it once and check the screen explains the state rather than staying silent |
| 6 | **Test notification** | Settings → Notifications → Show a test notification | A banner appears; tapping it opens the checkout problem. Send it twice quickly: one banner, one screen |
| 7 | **Dynamic Type** | Simulator → Settings → Accessibility → Display & Text Size → Larger Text, at the largest size | Home, Problems and a detail screen stay readable: no clipped status word, no truncated counts, no overlapping rows |
| 8 | **Landscape on iPad** | Run an iPad simulator — `npm run ios -- --device` prompts with the installed simulators — and rotate it | The layout uses the width instead of stretching phone-width controls; rotating back keeps the scroll position sane; nothing is cut off under the safe area |
| 9 | **Dark mode** | Simulator → Settings → Developer → Dark Appearance | Colours switch, and no white flash shows behind the app while it does |
| 10 | **Offline** | Turn the Mac's Wi-Fi off, or stop the mock server, then pull to refresh | Lists stay visible with the stale/offline banner and "Updated X ago"; detail screens show an offline error, not an empty screen |
| 11 | **VoiceOver** (device) | Enable VoiceOver, sweep Home | Every control is announced with a label; status is a word, not a colour |
| 12 | **Universal links** (device, optional) | Only once an associated domain is configured and the server serves `apple-app-site-association` ([app-identity.md](app-identity.md)) | `https://<domain>/m/problems/<id>` opens the app |

### Step 5 — on a real iPhone

Expo Go covers most of it. For the real thing (own URL scheme, Keychain options, notifications), build a development
build — a simulator build needs no Apple account, a device build does:

```bash
npx eas-cli build -p ios --profile development          # simulator build (eas.json sets ios.simulator: true)
npx eas-cli device:create                                # register the iPhone (Apple credentials)
npx eas-cli build -p ios --profile development-device    # device build (Apple credentials)
```

### Reporting back

Open one issue titled `iOS first run` and put in it, in this order:

1. macOS, Xcode and simulator/device versions, and the commit you built.
2. The checklist above with a verdict per line (pass / fail / not run).
3. For every failure: the exact command, the full error or a screen recording, and whether it also happens in Expo Go.
4. Anything that looked wrong but is not on the list — nobody has ever seen this app on iOS, so first impressions are
   data.
5. Then update [testing.md](testing.md#what-has-actually-been-verified): replace the "iOS run — Never done" row with
   what was actually run, and say so plainly in [README.md](README.md) and [security.md](security.md) too.

## Apple Developer account

> **Requires owner action.** Enrol in the Apple Developer Program (paid, yearly) as an individual or an
> organisation. An organisation needs a D-U-N-S number and takes longer. The App Store seller name comes from this
> enrolment.

Without it you cannot sign for devices, use TestFlight or submit to the App Store.

## Bundle identifier

The placeholder `com.example.opswatch` is rejected by Apple. Choose a reverse-DNS id you control (for example
`com.yourcompany.opswatch`); it cannot be changed after the first submission. Set it for every build:

```bash
export OPSWATCH_IOS_BUNDLE_ID=com.yourcompany.opswatch
```

For a cloud build, set `OPSWATCH_IOS_BUNDLE_ID` as an EAS environment variable; `eas.json` sets no identifier that
would shadow it, and the `production` profile refuses to build while it is the placeholder. See
[app-identity.md](app-identity.md) and [release.md](release.md).

## Signing, certificates, provisioning profiles

**Requires Apple credentials.** iOS needs a distribution certificate and a provisioning profile per bundle id and
distribution type (development, ad hoc, App Store).

Recommended: **EAS-managed credentials**. On the first `eas build -p ios`, EAS asks you to sign in with your Apple ID
and creates and stores the certificate and profiles. Inspect or reset them with:

```bash
npx eas-cli credentials -p ios
```

Self-managed credentials are possible (upload a `.p12` and a `.mobileprovision`), but then the owner must store the
certificate and its password in a password manager with an offline backup. `apps/mobile/.gitignore` ignores
`*.p12`, `*.p8`, `*.key`, `*.mobileprovision` and `*.pem`; still never copy them into the repository.

Associated domains (universal links) and push capabilities are added to the app id automatically by EAS when
`OPSWATCH_ASSOCIATED_DOMAIN` is set or push is configured.

## Development build

A development build contains the app's own native config (URL scheme, keychain options, notifications).
`expo-dev-client` is already a dependency, and `eas.json` already has the profiles:

```bash
# Simulator build (no Apple account needed: the development profile sets "ios": { "simulator": true })
npx eas-cli build -p ios --profile development

# Device build: requires Apple credentials and registered devices
npx eas-cli device:create
npx eas-cli build -p ios --profile development-device
```

On a Mac you can also build locally with `npm run ios`, which generates the git-ignored `ios/` folder.

## Production build

**Requires Apple credentials.**

```bash
cd apps/mobile
npx eas-cli build -p ios --profile production
```

`eas.json` sets `appVersionSource: "remote"` and `autoIncrement: true` on the production profile, so EAS owns the
build number and `OPSWATCH_IOS_BUILD_NUMBER` is ignored for those builds ([release.md](release.md#2-build-numbers)).

## App Store Connect app record

**Requires Apple credentials.** In App Store Connect, create a new app: platform iOS, name **OpsWatch** (must be
unique on the App Store; pick an alternative if taken), primary language, the bundle id chosen above, and an SKU
(any internal reference). `eas submit` can also create the record on the first submission.

## TestFlight

**Requires Apple credentials.**

```bash
npx eas-cli submit -p ios --latest     # uploads the latest production build to App Store Connect
```

After Apple's processing, the build appears in TestFlight. Internal testers (members of the App Store Connect team)
can install it right away. External testers need a short Beta App Review first. Fill the test information,
including a **demo account**: reviewers need a reachable OpsWatch server or can use **Explore the demo** on the
Connect screen; say so in the review notes.

## Store assets

| Asset | Requirement |
|-------|-------------|
| App icon | 1024×1024 PNG, no transparency: `apps/mobile/assets/icon.png` (currently an Expo template placeholder, see [app-identity.md](app-identity.md)) |
| iPhone screenshots | Required for the largest iPhone display size App Store Connect asks for (currently the 6.9-inch class); smaller sizes can be scaled from it |
| iPad screenshots | Required because `supportsTablet: true` (13-inch class) |
| Text | Name, subtitle, description, keywords, support URL, privacy policy URL, copyright |

Check App Store Connect's current screenshot specifications before capturing; take screenshots from the demo so no
real infrastructure appears.

## Privacy declarations

**Requires Apple credentials.** Answer the App Privacy questionnaire ("nutrition label") in App Store Connect from
the draft in [privacy.md](privacy.md#app-store-privacy-answers-draft). A privacy policy URL is mandatory.

Apple also requires a privacy manifest declaring "required reason" APIs. Native libraries ship their own manifests;
if App Store Connect reports a missing reason after upload, declare it under `ios.privacyManifests` in
`app.config.ts` (see Expo's privacy manifest guide) and rebuild.

## Export compliance

`app.config.ts` sets `ios.config.usesNonExemptEncryption: false`, which writes `ITSAppUsesNonExemptEncryption = false`
to `Info.plist` (confirmed in the generated project). The app only uses encryption provided by the operating system
(HTTPS, Keychain), so App Store Connect does not ask the export compliance question for each build. The owner should
confirm this answer applies to them.

## Submit for review and release

**Requires Apple credentials.**

1. In App Store Connect, create the version (for example 0.1.0), attach the TestFlight build, fill the metadata,
   screenshots, age rating, privacy answers and review notes (how to use the demo).
2. Submit for review.
3. Choose a release method: manual, automatic after approval, or **phased release** over 7 days (recommended). A phased
   release can be paused.

`npx eas-cli submit -p ios` uploads builds; the review submission itself is done in App Store Connect.

## Updating the app

1. Increase the version in `app.config.ts` (`VERSION`) and `package.json` for a user-visible release.
2. Every upload needs a higher build number — EAS `autoIncrement` handles it while `appVersionSource` is `remote`.
3. Build, submit, test in TestFlight, submit the new version for review. Full steps: [release.md](release.md).

JavaScript-only fixes could ship through EAS Update, but **`expo-updates` is not installed**, so that path does not
exist yet ([expo-eas.md](expo-eas.md#ota-updates-with-eas-update)).
