# iOS

How to run, build and publish OpsWatch on iOS. Nothing has been published yet, and no Apple account exists for the
project. Steps marked **Requires Apple credentials** can only be done by the owner (or someone they grant access to).

## What needs a Mac

| Task | Mac needed? |
|------|-------------|
| iOS Simulator | Yes (Xcode runs only on macOS) |
| Local iOS builds (`npx expo run:ios`, Xcode archive) | Yes |
| EAS cloud builds (`eas build -p ios`) | No: builds run on Expo's macOS machines |
| Installing an internal build on a registered iPhone | No (link from EAS) |
| TestFlight and App Store Connect | No (web + TestFlight app) |

The app was developed on Linux: iOS has been verified through shared code, tests and the web export, not on an
iOS device. Run the [testing checklist](testing.md#release-checklist) on a real iPhone before any release.

## Simulator (macOS)

1. Install Xcode from the Mac App Store, open it once, accept the license and let it install components.
2. Install an iOS simulator runtime (Xcode → Settings → Components, or the equivalent section in your Xcode version).
3. From `apps/mobile`: `npm run ios` (Expo Go in the simulator), or build a development build, see below.

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

With EAS, set it as an EAS environment variable (plain text, not secret) or in the build profile's `env` in
`eas.json`, so cloud builds see it. See [app-identity.md](app-identity.md) and [expo-eas.md](expo-eas.md).

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

A development build contains the app's own native config (URL scheme, keychain options, notifications). It needs
`expo-dev-client` in `apps/mobile/package.json` (not a dependency at the time of writing; add it with
`npx expo install expo-dev-client`) and the `development` profile in `eas.json` ([expo-eas.md](expo-eas.md)).

```bash
# Simulator build (no Apple account needed if the profile sets "ios": { "simulator": true })
npx eas-cli build -p ios --profile development

# Device build: requires Apple credentials and registered devices
npx eas-cli device:create
npx eas-cli build -p ios --profile development
```

On a Mac you can also build locally: `npx expo run:ios` (generates the ignored `ios/` folder).

## Production build

**Requires Apple credentials.**

```bash
cd apps/mobile
npx eas-cli build -p ios --profile production
```

The build number comes from `OPSWATCH_IOS_BUILD_NUMBER` or EAS `autoIncrement` ([release.md](release.md)).

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
to `Info.plist`. The app only uses encryption provided by the operating system (HTTPS, Keychain), so App Store Connect
does not ask the export compliance question for each build. The owner should confirm this answer applies to them.

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
2. Every upload needs a higher build number (`OPSWATCH_IOS_BUILD_NUMBER`, or EAS `autoIncrement`).
3. Build, submit, test in TestFlight, submit the new version for review. Full steps: [release.md](release.md).

JavaScript-only fixes can ship through EAS Update once it is set up ([expo-eas.md](expo-eas.md#ota-updates-with-eas-update)).
