# Mobile release guide

The steps to ship a new version of OpsWatch mobile to the App Store and Google Play. All commands run from
`apps/mobile` unless stated otherwise. Before the first release, complete [app-identity.md](app-identity.md),
[expo-eas.md](expo-eas.md#expo-account-and-project), [ios.md](ios.md) and [android.md](android.md).

Steps marked **Requires owner action** need the owner's Apple, Google or Expo access.

## 1. Update the version

Use semantic versioning (`MAJOR.MINOR.PATCH`). Change it in both places:

- `app.config.ts`: `const VERSION = '0.2.0';`
- `package.json`: `"version": "0.2.0"`

The version is also the EAS Update runtime version (`runtimeVersion.policy: appVersion`): bump it whenever native code
or native config changes.

## 2. Build numbers

Each store upload needs a build number the store has never seen.

- EAS `autoIncrement` in the `production` profile (recommended), or
- set them explicitly: `OPSWATCH_IOS_BUILD_NUMBER` (iOS `buildNumber`) and `OPSWATCH_ANDROID_VERSION_CODE` (Android
  `versionCode`, an integer that must always increase).

If `eas.json` uses `"appVersionSource": "remote"`, EAS owns these numbers and the variables are ignored
([expo-eas.md](expo-eas.md#build-profiles)).

## 3. Lint

```bash
npm ci
npm run lint
```

## 4. Typecheck

```bash
npm run typecheck
```

## 5. Tests

```bash
npm run test:ci
npm run export:web && npm run e2e:web
maestro test e2e/maestro        # on an emulator/simulator with a preview build
npm run doctor
```

## 6. Build iOS

**Requires owner action** (Apple credentials).

```bash
npx eas-cli build -p ios --profile production
```

## 7. Build Android

**Requires owner action** (EAS project; Play upload key through EAS).

```bash
npx eas-cli build -p android --profile production
```

For a directly installable test binary: `npx eas-cli build -p android --profile preview` (APK).

## 8. Test the release binaries

Install preview/production binaries (not development builds) on real devices and run the
[release checklist](testing.md#release-checklist). Release builds differ from development: no plain HTTP, no dev menu,
production logging.

## 9. TestFlight

**Requires owner action.**

```bash
npx eas-cli submit -p ios --latest
```

Wait for processing, add the build to the internal testing group, then run the checklist items again from TestFlight.

## 10. Play internal testing

**Requires owner action.**

```bash
npx eas-cli submit -p android --latest
```

(The first Android upload is manual in Play Console.) Add testers to the internal testing track and install from Play.

## 11. Validate

- Checklist passes on both platforms, from the store-distributed builds.
- The target OpsWatch server version supports every feature the release relies on (capability flags).
- No new warning in App Store Connect or Play Console pre-launch report.

## 12. Metadata

Update what changed: release notes ("What's new") in English and French, screenshots if the UI changed (from the demo),
privacy answers if data handling changed ([privacy.md](privacy.md)), review notes (how to use the demo).

## 13. Submit

**Requires owner action.**

- iOS: in App Store Connect, attach the build to the new version and submit for review.
- Android: promote the tested release from internal (or closed) testing to production, or create a production
  release with the same AAB, and send it for review.

## 14. Release

- iOS: **phased release** over 7 days (can be paused), or manual release after approval.
- Android: **staged rollout**, for example 10 % → 50 % → 100 %, watching Play Console vitals (crashes, ANRs) between
  steps.

## 15. Tag the release

From the repository root, on the commit that was built:

```bash
git tag -a mobile-v0.1.0 -m "OpsWatch mobile 0.1.0"
git push origin mobile-v0.1.0
```

Mobile tags use the `mobile-v` prefix so they never collide with server/web tags.

## 16. Document the release

Move the entries under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) into a new section
`## 0.1.0 (YYYY-MM-DD)` with iOS and Android build numbers, and the minimum OpsWatch server version it was tested with.

## Rollback and recovery

Store binaries cannot be recalled. In order of speed:

| Problem | Action |
|---------|--------|
| A feature is broken or unsafe | **Server-side kill switch**: set the feature's flag to `false` in `GET /api/v1/server` `features`. The app hides it and shows "Not available on this server" on next refresh. No app change needed |
| JavaScript-only bug | **EAS Update** to the `production` channel with the fix, or roll back: `npx eas-cli update:rollback` ([expo-eas.md](expo-eas.md#rollback)). Requires `expo-updates` to be set up |
| Bad release still rolling out | iOS: **pause the phased release** in App Store Connect. Android: **halt the staged rollout** in Play Console |
| Native bug or crash at startup | **Expedited fix build**: fix, bump the patch version, build, submit. On iOS, request an expedited review in App Store Connect when justified |
| Wrong build released | Ship the previous good code as a new version with a higher build number; stores do not allow re-releasing an older build number |

After any incident, record it in [CHANGELOG.md](CHANGELOG.md).
