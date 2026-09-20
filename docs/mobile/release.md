# Mobile release guide

How to ship a version of OpsWatch mobile to the App Store and Google Play, and how to get out of it if the release
goes wrong. All commands run from `apps/mobile` unless stated otherwise.

Steps marked **Requires owner action** need the owner's Apple, Google or Expo access.

## Before the first release ever

None of this has been done. Until every line is ticked, there is no release to make.

| # | Blocker | Where |
|---|---------|-------|
| 1 | Replace the `com.example.opswatch` bundle id and package — the `production` profile refuses to build until you do | [below](#3-replace-the-placeholder-identifiers) |
| 2 | Create the Expo account and EAS project (`eas init`), set `EXPO_OWNER` and `EAS_PROJECT_ID` | [expo-eas.md](expo-eas.md#expo-account-and-project) |
| 3 | Enrol in the Apple Developer Program | [ios.md](ios.md#apple-developer-account) |
| 4 | Create the Google Play developer account | [android.md](android.md#google-play-console) |
| 5 | **Run the app on iOS at least once** — it never has been | [ios.md](ios.md#first-run-on-ios-checklist) |
| 6 | Replace every image in `apps/mobile/assets/` (all Expo template placeholders) | [app-identity.md](app-identity.md#icons-and-splash) |
| 7 | Decide on an associated domain, or accept that only `opswatch://` links work | [app-identity.md](app-identity.md#universal-links-and-android-app-links) |
| 8 | Publish a privacy policy URL (mandatory on both stores) | [privacy.md](privacy.md) |
| 9 | Decide whether to install `expo-updates`; without it there is no OTA rollback | [expo-eas.md](expo-eas.md#ota-updates-with-eas-update) |

## 1. Versioning

Semantic versioning (`MAJOR.MINOR.PATCH`) for the user-visible version, changed in **two places that must agree**:

- `app.config.ts`: `const VERSION = '0.2.0';`
- `package.json`: `"version": "0.2.0"`

Rules:

| Change | Version |
|--------|---------|
| Bug fixes only, no new screen or capability | PATCH |
| New screens, new capability support, new contract fields consumed | MINOR |
| Dropping support for a server `apiVersion`, or anything that makes an older server unusable | MAJOR |
| Any native change: a new native module, an Expo SDK upgrade, a permission, a change to `app.config.ts` native settings | At least MINOR, always a new store build |

The version is also the EAS Update runtime version (`runtimeVersion: { policy: 'appVersion' }`). That is the reason
for the last row: a JavaScript bundle must never be able to land on a binary whose native code differs.

The app's `apiVersion` is separate (`API_VERSION = 1` in the contract) and does not move with the app version; the
Connect screen refuses a server whose `apiVersion` differs ([api-contract.md](api-contract.md)).

## 2. Build numbers

Each store upload needs a number the store has never seen: iOS `buildNumber`, Android `versionCode` (an integer that
must always increase). They are independent of the version and are not reset by it.

`eas.json` sets `"appVersionSource": "remote"` and `"autoIncrement": true` on the `production` profile, which means:

- **EAS owns both numbers** and raises them on every production build. This is the intended path.
- `OPSWATCH_IOS_BUILD_NUMBER` and `OPSWATCH_ANDROID_VERSION_CODE` are ignored by EAS builds; they only affect local
  builds, where `app.config.ts` defaults both to `1`.
- If you ever switch `appVersionSource` to `"local"`, those two variables become the source of truth and must be
  raised by hand for every upload.

## 3. Replace the placeholder identifiers

`com.example.opswatch` is rejected by both stores, and **neither id can be changed after the first release**. Pick one
reverse-DNS name you control and use it on both platforms, for example `com.yourcompany.opswatch`.

`app.config.ts` reads them from the environment:

```ts
const iosBundleId = env('OPSWATCH_IOS_BUNDLE_ID') ?? 'com.example.opswatch';
const androidPackage = env('OPSWATCH_ANDROID_PACKAGE') ?? 'com.example.opswatch';
```

Change them in every place they are set, in this order:

1. **EAS environment variables**, for cloud builds. `eas.json` deliberately sets no identifiers, so nothing in the
   repo shadows them and no organisation's ids live in version control. A `production` build with either still unset
   is refused by `app.config.ts` before anything is compiled.
2. **Your shell / CI**, for local builds and `expo prebuild`:

   ```bash
   export OPSWATCH_IOS_BUNDLE_ID=com.yourcompany.opswatch
   export OPSWATCH_ANDROID_PACKAGE=com.yourcompany.opswatch
   ```

3. **Regenerate the native projects** so nothing stale survives:

   ```bash
   rm -rf ios android
   npx expo prebuild --clean
   npx expo config --type public | grep -E 'bundleIdentifier|"package"'   # confirm both
   ```

4. **Maestro**: `maestro test -e APP_ID=com.yourcompany.opswatch e2e/maestro` (the flows take `APP_ID` as a variable,
   so nothing in the repository needs editing).
5. **Anything referring to the old id by hand**: `adb shell pm clear <package>`, and the
   `sha256_cert_fingerprints` / `appIDs` entries in `assetlinks.json` and `apple-app-site-association` if you use
   universal links ([app-identity.md](app-identity.md#universal-links-and-android-app-links)).
6. **Uninstall the old build** from every emulator and device: a different id installs as a second app.

The App Store Connect record and the Play Console app must be created with the final ids; they cannot be renamed
afterwards.

## 4. Environment configuration

Everything the build needs is public. There are no secrets in the binary.

| Variable | Needed for | Set where |
|----------|-----------|-----------|
| `OPSWATCH_IOS_BUNDLE_ID`, `OPSWATCH_ANDROID_PACKAGE` | Every build; **required** for the `production` profile | EAS environment variables, or the shell for a local build |
| `EXPO_OWNER`, `EAS_PROJECT_ID` | EAS builds, push tokens, EAS Update | EAS environment variables or the build shell |
| `OPSWATCH_ASSOCIATED_DOMAIN` | Universal links / App Links | Same; leave unset to disable them |
| `EXPO_PUBLIC_DEFAULT_SERVER_URL` | Optional: pre-fills the server field | Leave unset for store builds unless you ship to one known server |
| `OPSWATCH_IOS_BUILD_NUMBER`, `OPSWATCH_ANDROID_VERSION_CODE` | Local builds only (see §2) | Shell |
| `EXPO_TOKEN` | `mobile-release.yml` in CI | GitHub repository secret |

Signing material — App Store Connect API key, Google service account JSON, upload keystore, APNs key, FCM service
account — lives in EAS credentials or the owner's password manager, never in the repository
([expo-eas.md](expo-eas.md#environment-variables-and-secrets)).

## 5. Signing

| Platform | Key | Where it lives | Backup |
|----------|-----|----------------|--------|
| iOS | Distribution certificate + provisioning profile per bundle id | EAS-managed (recommended): created on the first `eas build -p ios` | EAS holds them; `npx eas-cli credentials -p ios` to inspect or reset |
| Android | Upload key | EAS-managed keystore, created on the first `eas build -p android` | **Download it and store it in a password manager.** `npx eas-cli credentials -p android` |
| Android | App signing key | Google, through Play App Signing (mandatory for new apps) | Google's; a lost upload key can be reset through Play Console support |

## 6. Run the checks

```bash
npm ci
npm run check            # lint + typecheck + tests (the CI gate)
npm run doctor           # expo-doctor, 21 checks
npm run export:web && npm run e2e:web
maestro test -e APP_ID=<your package> e2e/maestro    # on an emulator/simulator with a preview build installed
```

`.github/workflows/mobile.yml` runs the first and third of these on every pull request touching the app; running them
locally before a release is still worth it, because the Maestro flows are not in CI.

## 7. Build

**Requires owner action.**

```bash
npx eas-cli build -p ios --profile production
npx eas-cli build -p android --profile production
```

For a directly installable test binary: `npx eas-cli build -p android --profile preview` (APK). Or trigger
`.github/workflows/mobile-release.yml` from GitHub with the platform and profile you want; it builds and does not
submit.

## 8. Test the release binaries

Install preview/production binaries (not development builds) on real devices and run the
[release checklist](testing.md#release-checklist). Release builds differ from development ones: no plain HTTP opt-in,
no dev menu, production logging.

At least one iPhone and one Android phone. For this release in particular, iOS has never been run at all: budget time
for [the first-run checklist](ios.md#first-run-on-ios-checklist) before anything else.

## 9. Confirm the permissions

Read the permissions out of the binary you are about to ship, not out of this document:

```bash
# Android, from the release APK/AAB
npx expo prebuild --platform android
grep uses-permission android/app/src/main/AndroidManifest.xml
# and the merged manifest under android/app/build/intermediates/merged_manifests/ after a build
```

Expected: `INTERNET` and `POST_NOTIFICATIONS` declared by the app; connectivity, vibration and notification-support
permissions merged by libraries; `SYSTEM_ALERT_WINDOW`, storage and microphone absent because they are blocked. The
full inventory with reasons is in [privacy.md](privacy.md#android-permissions-actually-in-the-release-build); the
store forms must match it.

On iOS, check the generated `Info.plist`: no `NSFaceIDUsageDescription`, OpsWatch's own
`NSLocalNetworkUsageDescription`, `ITSAppUsesNonExemptEncryption = false`.

## 10. TestFlight

**Requires owner action.**

```bash
npx eas-cli submit -p ios --latest
```

Wait for processing, add the build to the internal testing group, then run the checklist again from TestFlight.

## 11. Play internal testing

**Requires owner action.**

```bash
npx eas-cli submit -p android --latest
```

The first Android upload is manual in Play Console. `eas.json` submits to the `internal` track as a **draft**, so
nothing goes live on its own. Add testers to the internal testing track and install from Play.

## 12. Store checklist

Tick before submitting for review, on both stores.

**Both**

- [ ] Version and build number are new, and the binary under test is the one being submitted
- [ ] Final bundle id / package, not `com.example.*`
- [ ] Icons and splash are OpsWatch artwork, not the Expo template
- [ ] Release notes ("What's new") written in English and French
- [ ] Screenshots captured **from the demo**, so no real infrastructure appears
- [ ] Privacy policy URL live and reachable
- [ ] Review notes explain how to use the app without a server: Connect screen → **Explore the demo**
- [ ] Data-handling answers match [privacy.md](privacy.md); no analytics, no ads, no tracking declared anywhere
- [ ] The [release checklist](testing.md#release-checklist) passed on store-distributed builds on both platforms
- [ ] The target OpsWatch server version supports every capability this release relies on

**App Store**

- [ ] App Store Connect record created with the final bundle id
- [ ] iPhone screenshots at the largest required size; iPad screenshots (the app declares `supportsTablet`)
- [ ] App Privacy questionnaire answered
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption = false` is in the build; confirm it applies to you
- [ ] Age rating, support URL, copyright
- [ ] No missing privacy-manifest reasons reported after upload

**Google Play**

- [ ] App content: privacy policy, app access (demo instructions), ads = none, content rating, target audience
- [ ] Data safety form filled from [privacy.md](privacy.md#google-play-data-safety-answers-draft)
- [ ] Feature graphic, phone screenshots (2+), tablet screenshots
- [ ] Closed-test requirement satisfied if the account is a new personal one
- [ ] Pre-launch report shows no new warning

## 13. Submit and release

**Requires owner action.**

- iOS: in App Store Connect, attach the build to the new version and submit for review. Release with a **phased
  release** over 7 days (it can be paused) or manually after approval.
- Android: promote the tested release from internal (or closed) testing to production with a **staged rollout**, for
  example 10 % → 50 % → 100 %, watching Play Console vitals (crashes, ANRs) between steps.

## 14. Tag the release

From the repository root, on the commit that was built:

```bash
git tag -a mobile-v0.1.0 -m "OpsWatch mobile 0.1.0"
git push origin mobile-v0.1.0
```

Mobile tags use the `mobile-v` prefix so they never collide with server/web tags.

## 15. Document the release

Move the entries under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) into a new section
`## 0.1.0 (YYYY-MM-DD)` with the iOS and Android build numbers, and the minimum OpsWatch server version it was tested
with.

## Rollback and recovery

Store binaries cannot be recalled, and a bad version reaches users until something stops it. In order of speed:

| Speed | Problem | Action |
|-------|---------|--------|
| Minutes, no app change | A feature is broken, unsafe or too expensive server-side | **Server-side kill switch**: set that feature's flag to `false` in `GET /api/v1/server` `features`. Every app hides it on the next refresh and shows "Not available on this server" — no store, no update, no user action. This works today and is the only instant lever the project has |
| Minutes | A bad release is still rolling out | **Halt it.** Android: Play Console → the release → **Halt rollout** (users who already updated keep the bad version; a new staged rollout with a higher `versionCode` replaces it). iOS: App Store Connect → **Pause phased release** (and "Remove from sale" only in the extreme case) |
| Hours, if enabled | JavaScript-only bug | **EAS Update**: publish the fix to the `production` channel, or `npx eas-cli update:rollback`. ⚠️ **`expo-updates` is not installed**, so this does not exist yet: installed builds have no update client and will never fetch anything. Until that decision is made, treat every bug as needing a store build ([expo-eas.md](expo-eas.md#ota-updates-with-eas-update)) |
| A day or more | Native crash, or a JS bug with no OTA path | **Expedited fix build**: fix, bump the PATCH version, build, submit. On iOS request an expedited review in App Store Connect and say why; on Android, submit to production with the rollout at a low percentage first. A crash before the JS loads can never be fixed by an update anyway |
| — | Wrong build released | Ship the previous good code as a **new version with a higher build number**. Stores never allow re-releasing an older build number, so there is no "revert" — only "forward to the old code" |

Order of operations during an incident: kill the feature server-side first (it is instant and reversible), halt the
rollout second, then decide between an update and a build. Record what happened in
[CHANGELOG.md](CHANGELOG.md) afterwards.
