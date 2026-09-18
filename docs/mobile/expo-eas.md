# Expo and EAS

EAS (Expo Application Services) builds, signs, submits and updates the app in the cloud, which is also how iOS builds
are produced without a Mac. None of this is set up yet: there is no Expo organisation or EAS project for OpsWatch.

Run the EAS CLI with `npx eas-cli <command>` (or install it globally with `npm install -g eas-cli` and use `eas`).
All commands run from `apps/mobile`.

## Expo account and project

> **Requires owner action.** Create an Expo account (and, for a team, an organisation) at expo.dev.

```bash
cd apps/mobile
npx eas-cli login
npx eas-cli init
```

`eas init` creates the EAS project and prints its id. Because `app.config.ts` is dynamic, EAS cannot write the id into
it: set it yourself, along with the owner, wherever builds run (shell, CI, or EAS environment variables):

```bash
export EXPO_OWNER=your-expo-account-or-org
export EAS_PROJECT_ID=00000000-0000-0000-0000-000000000000
```

`app.config.ts` puts `EAS_PROJECT_ID` in `extra.eas.projectId` (needed by EAS Update and by push tokens) and
`EXPO_OWNER` in `owner`. The slug is `opswatch`.

## Build profiles

`apps/mobile/eas.json` (being added) defines three profiles:

| Profile | Purpose | Distribution | Output |
|---------|---------|-------------|--------|
| `development` | Development client (`developmentClient: true`) for daily work | Internal | iOS: simulator or registered devices; Android: APK |
| `preview` | Release-like build for testers | Internal | Android APK; iOS ad hoc (registered devices) |
| `production` | Store builds, `autoIncrement` of build numbers | Store | Android AAB; iOS App Store build |

The `development` profile needs `expo-dev-client` in `package.json`. It is not a dependency at the time of writing;
add it with `npx expo install expo-dev-client`.

About versions: `autoIncrement` raises the iOS build number and Android `versionCode` on each production build. When
`eas.json` uses `"appVersionSource": "remote"`, EAS stores those numbers itself and `OPSWATCH_IOS_BUILD_NUMBER` /
`OPSWATCH_ANDROID_VERSION_CODE` are ignored; with `"local"`, the values from `app.config.ts` are used. Check the
committed `eas.json` and follow [release.md](release.md) accordingly.

## Development builds

```bash
npx eas-cli build -p android --profile development
npx eas-cli build -p ios --profile development      # simulator or registered devices (Apple credentials for devices)
npm start                                            # then open the installed development build
```

Register iPhones for internal builds with `npx eas-cli device:create`.

## EAS Build

```bash
npx eas-cli build -p ios --profile production
npx eas-cli build -p android --profile production
npx eas-cli build -p all --profile preview
npx eas-cli build:list
```

The first build of each platform sets up credentials (EAS-managed recommended): [ios.md](ios.md#signing-certificates-provisioning-profiles),
[android.md](android.md#signing).

## EAS Submit

```bash
npx eas-cli submit -p ios --latest
npx eas-cli submit -p android --latest
```

- iOS: signs in with the Apple ID, or better an **App Store Connect API key** stored in EAS credentials. **Requires
  Apple credentials.**
- Android: needs a **Google service account key** (JSON) with access to the app in Play Console, uploaded to EAS
  credentials. The very first Android upload must be done manually in Play Console. **Requires Google Play access.**
- Submission settings (track, App Store Connect app id) belong in the `submit` section of `eas.json`, never keys.

## Environment variables and secrets

Every value in `app.config.ts` ends up inside the public app binary. So:

| Variable | Kind | Where |
|----------|------|-------|
| `OPSWATCH_IOS_BUNDLE_ID`, `OPSWATCH_ANDROID_PACKAGE` | Public config | EAS environment variable (plain text) or profile `env` |
| `EAS_PROJECT_ID`, `EXPO_OWNER` | Public config | Same |
| `OPSWATCH_ASSOCIATED_DOMAIN` | Public config | Same |
| `OPSWATCH_IOS_BUILD_NUMBER`, `OPSWATCH_ANDROID_VERSION_CODE` | Public config | Same, or EAS `autoIncrement` |
| `EXPO_PUBLIC_DEFAULT_SERVER_URL` | Public config | Optional; only pre-fills the server field |

**Nothing secret goes in the app.** There are no API keys to embed: the app talks only to the user's OpsWatch server
with the user's own session. Store-side credentials (App Store Connect API key, Google service account, signing
keys, APNs key, FCM service account) live in EAS credentials or the owner's password manager, never in the repository,
`eas.json`, `app.config.ts` or `EXPO_PUBLIC_*` variables. EAS "secret" visibility is for build-time values that never
reach the binary; OpsWatch currently has none.

## OTA updates with EAS Update

EAS Update ships JavaScript and asset changes to installed builds without a store review.

State today:

- `runtimeVersion: { policy: 'appVersion' }` is configured: an update only reaches builds with the same app version
  (`0.1.0`), so a JS bundle can never land on a binary with different native code if the version is bumped with every
  native change.
- **`expo-updates` is not installed yet.** To enable EAS Update: `npx expo install expo-updates`, then
  `npx eas-cli update:configure`, then new builds. **Requires owner decision.**

Recommendations:

- One channel per profile: `development`, `preview`, `production` (set `"channel"` in each `eas.json` build profile).
- Publish to `preview` first, test on a preview build, then publish the same change to production:

  ```bash
  npx eas-cli update --channel preview --message "Fix problem list empty state"
  npx eas-cli update --channel production --message "Fix problem list empty state"
  ```

- **Never auto-publish to production** (for example from CI on every merge). A person decides.
- Use `--rollout-percentage` on `update:republish` or the EAS dashboard's rollout controls for gradual releases.
- **Native changes need a new build**: a new or upgraded native module, a permission, `app.config.ts` native settings,
  an Expo SDK upgrade. Bump the version (which changes the runtime version) and ship through the stores.
- Store rules: updates may fix bugs and adjust behaviour, not change the app's purpose.

### Rollback

```bash
npx eas-cli update:rollback                                  # interactive: previous update or the embedded one
npx eas-cli update:republish --group <update-group-id>       # republish a known-good update on its branch
npx eas-cli update:list --branch production
```

Considerations:

- A rollback reaches users when their app next checks for updates (usually on launch), not instantly.
- Rolling back to the embedded update returns to the JavaScript shipped in the store binary.
- An update cannot fix a native crash that happens before the update loads; that needs a new build
  ([release.md](release.md#rollback-and-recovery)).
- Server-side feature flags in `GET /api/v1/server` hide a broken feature immediately, without any app change.
