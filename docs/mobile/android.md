# Android

How to run, build and publish OpsWatch on Android. Nothing has been published yet, and no Google Play developer
account exists for the project. Steps marked **Requires Google Play access** can only be done by the owner.

Android is the platform this app has actually been run on: a release APK built with `expo prebuild` +
`./gradlew assembleRelease` and installed on an Android 15 emulator (Pixel 7, x86_64) on 2026-09-20. What that run
covered is listed in [testing.md](testing.md#what-has-actually-been-verified).

## Android Studio, SDK and emulator

1. Install Android Studio. On first launch, install the Android SDK, SDK Platform-Tools and an emulator system image.
2. Put the SDK tools on your `PATH` ([development.md](development.md#prerequisites)).
3. Device Manager → create a virtual device (a Pixel phone and, for layout checks, a tablet).
4. Start it and check `adb devices` lists it. Then either:
   - `npm start` and press `s` for Expo Go, then `a` — no native toolchain needed; or
   - `npm run android` (`expo run:android`), which compiles a debug build with the development client and installs it.

On the emulator, `10.0.2.2` is the host's `localhost` (or use `adb reverse tcp:<port> tcp:<port>`).

## Package name

The placeholder `com.example.opswatch` is rejected by Google Play. Choose a reverse-DNS id you control; it can never
change once the app is on Play. Set it for every build:

```bash
export OPSWATCH_ANDROID_PACKAGE=com.yourcompany.opswatch
```

`eas.json` also carries the placeholder in `build.base.env`, so change it there as well (or override it with an EAS
environment variable) before any cloud build ([expo-eas.md](expo-eas.md), [app-identity.md](app-identity.md)).

## Signing

Play uses two keys:

- **Upload key**: signs what you upload to Play.
- **App signing key**: held by Google through **Play App Signing** (mandatory for new apps); Google re-signs the
  app delivered to users. If the upload key is lost, it can be reset through Play Console support.

### EAS-managed (recommended)

On the first `eas build -p android`, EAS generates an upload keystore and stores it. Inspect, download a backup, or
replace it with:

```bash
npx eas-cli credentials -p android
```

**Requires owner action:** download a backup of the keystore from EAS and keep it in a password manager.

### Self-managed

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore opswatch-upload.jks -alias opswatch-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

- Store the `.jks` file, its password and the alias in a password manager, plus an offline backup.
- Never commit it. `apps/mobile/.gitignore` ignores `*.jks`, `*.keystore`, `*.p8`, `*.p12`, `*.key`, `*.pem` and
  `*.mobileprovision`, as well as the generated `/android` and `/ios` folders.
- Upload it to EAS with `npx eas-cli credentials -p android` so cloud builds use it.

## Builds

The profiles below are the ones in `apps/mobile/eas.json` ([expo-eas.md](expo-eas.md#build-profiles)).

| Profile | Output | Use |
|---------|--------|-----|
| `development` | APK with the development client, internal distribution | Daily development on emulators and phones |
| `development-device` | Same, for registered iOS devices; on Android identical to `development` | Mostly an iOS distinction |
| `preview` | APK (`android.buildType: "apk"`), internal distribution | Share a release-like build with testers by link |
| `production` | AAB (Android App Bundle), `autoIncrement` | Google Play |

```bash
cd apps/mobile
npx eas-cli build -p android --profile development
npx eas-cli build -p android --profile preview
npx eas-cli build -p android --profile production
```

**AAB vs APK:** Google Play requires an AAB for new apps; Play builds per-device APKs from it. An APK can be installed
directly (`adb install app.apk`, or open the EAS link on the phone), so it is used for internal testing outside Play.

Local builds need no Expo account:

```bash
npm run android                                     # debug build, installs and launches
npx expo prebuild --platform android                # generate the (git-ignored) android/ project
cd android && ./gradlew assembleRelease             # release APK, app/build/outputs/apk/release/
adb install -r app/build/outputs/apk/release/app-release.apk
```

That is exactly how the verified release run was produced. The release APK measured 48 MB, and cold start on the
Android 15 emulator was 670–770 ms.

## Google Play Console

**Requires Google Play access.**

1. Create a Google Play developer account (one-time registration fee; identity verification). New personal accounts
   must run a closed test with a minimum number of testers for a minimum period before production access is granted;
   check the current requirement in Play Console.
2. Create the app: name **OpsWatch**, default language, app (not game), free.
3. Complete the app content declarations: privacy policy URL, app access (explain how reviewers sign in: the demo via
   **Explore the demo**, or a test server and account), ads (**none**), content rating questionnaire, target audience,
   Data safety (below).
4. The first upload of an AAB can be done manually in Play Console; later uploads can use `eas submit`, which needs a
   Google service account key with access to the app ([expo-eas.md](expo-eas.md#eas-submit)).

## Testing tracks

| Track | Audience | Notes |
|-------|----------|-------|
| Internal testing | Up to 100 testers by email list | Available within minutes; start here |
| Closed testing | Invited testers or Google Groups | Required step for new personal accounts before production |
| Open testing | Anyone with the link | Optional |
| Production | Everyone | Use a staged rollout |

```bash
npx eas-cli submit -p android --latest
```

`eas.json`'s `submit.production.android` sets `track: "internal"` and `releaseStatus: "draft"`, so a submission lands
as a draft on the internal track and never goes live by itself.

## Store listing and assets

| Asset | Requirement |
|-------|-------------|
| App icon | 512×512 PNG, 32-bit |
| Feature graphic | 1024×500 JPG or PNG |
| Phone screenshots | At least 2 |
| Tablet screenshots | Recommended (the app supports tablets) |
| Text | Short description (80 characters), full description (4000 characters) |

Check Play Console for current limits. Capture screenshots from the demo so no real infrastructure appears.
Launcher icons come from `assets/android-icon-foreground.png`, `android-icon-background.png` and
`android-icon-monochrome.png` (adaptive icon, background colour `#0B1220`), currently placeholders
([app-identity.md](app-identity.md)).

## Data safety

**Requires Google Play access.** Fill the Data safety form from the draft in
[privacy.md](privacy.md#google-play-data-safety-answers-draft).

## Permissions

`app.config.ts` declares two permissions and blocks four:

| Permission | Why |
|------------|-----|
| `INTERNET` | Talk to the OpsWatch server |
| `POST_NOTIFICATIONS` | Show notifications on Android 13+; requested at runtime only when the user enables notifications |

Blocked: `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` — each is
something a dependency would otherwise merge into the manifest. `SYSTEM_ALERT_WINDOW` ("draw over other apps") was
found in an earlier release build and has been blocked since.

Libraries still merge a few harmless permissions of their own (connectivity state, vibration, notification support).
The inventory read from a real release manifest is in
[privacy.md](privacy.md#android-permissions-actually-in-the-release-build); re-read it there after adding or
upgrading a dependency. `allowBackup` is `false` so the offline cache never goes to device backups, and cleartext
HTTP is refused by Android in release builds.

## Updating a release

1. Increase `VERSION` in `app.config.ts` and `package.json` for a user-visible release.
2. **`versionCode` must increase for every upload.** With `appVersionSource: "remote"` in `eas.json`, EAS owns it and
   `autoIncrement` raises it; `OPSWATCH_ANDROID_VERSION_CODE` is only used for local builds. Play rejects a
   `versionCode` it has already seen.
3. Build, submit to internal testing, test, promote to production with a staged rollout. Full steps:
   [release.md](release.md).
