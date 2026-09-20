# Expo and EAS

EAS (Expo Application Services) builds, signs, submits and updates the app in the cloud, which is also how iOS builds
are produced without a Mac. None of it has been used yet: there is no Expo organisation and no EAS project for
OpsWatch. The configuration is in place; the account is not.

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
`EXPO_OWNER` in `owner`. The slug is `opswatch`. Without a project id the app still works; only push registration
reports that this build has no push project.

## Build profiles

`apps/mobile/eas.json` is committed. It requires EAS CLI `>= 16.0.0`, builds on Node 22.19.0, and sets
`appVersionSource: "remote"`.

| Profile | Extends | Purpose | Distribution | Output |
|---------|---------|---------|--------------|--------|
| `base` | — | Shared settings: Node version and the `OPSWATCH_IOS_BUNDLE_ID` / `OPSWATCH_ANDROID_PACKAGE` env values | — | — |
| `development` | `base` | Development client (`developmentClient: true`), channel `development` | Internal | iOS simulator (`ios.simulator: true`); Android APK |
| `development-device` | `development` | The same for a registered iPhone (`ios.simulator: false`) | Internal | iOS device build |
| `preview` | `base` | Release-like build for testers, channel `preview` | Internal | Android APK (`buildType: "apk"`); iOS ad hoc |
| `production` | `base` | Store builds, channel `production`, `autoIncrement: true` | Store | Android AAB; iOS App Store build |

> **`base` sets no identifiers.** It used to pin both to `com.example.opswatch`, which silently overrode any EAS
> environment variable of the same name; it no longer does, so setting them in the EAS project is enough. A
> `production` build with either still unset is refused by `app.config.ts`
> ([release.md](release.md#3-replace-the-placeholder-identifiers)).

About versions: `appVersionSource: "remote"` means **EAS stores the iOS build number and the Android `versionCode`
itself**, and `autoIncrement` on the `production` profile raises them for each production build.
`OPSWATCH_IOS_BUILD_NUMBER` and `OPSWATCH_ANDROID_VERSION_CODE` are then ignored for EAS builds; they still apply to
local builds from `app.config.ts`.

`expo-dev-client` is a dependency of the app, so the `development` profile needs no extra setup — and `npx expo start`
targets a development build by default ([development.md](development.md#expo-go-or-a-development-build)).

## Development builds

```bash
npx eas-cli build -p android --profile development
npx eas-cli build -p ios --profile development           # simulator build, no Apple account needed
npx eas-cli build -p ios --profile development-device     # registered devices (Apple credentials)
npm start                                                 # then open the installed development build
```

Register iPhones for device builds with `npx eas-cli device:create`.

## EAS Build

```bash
npx eas-cli build -p ios --profile production
npx eas-cli build -p android --profile production
npx eas-cli build -p all --profile preview
npx eas-cli build:list
```

The first build of each platform sets up credentials (EAS-managed recommended): [ios.md](ios.md#signing-certificates-provisioning-profiles),
[android.md](android.md#signing).

### From CI

`.github/workflows/mobile-release.yml` runs the same thing manually from GitHub: choose a platform (`all`, `ios`,
`android`) and a profile (`preview`, `production`), and it runs `npm run check` and then
`eas build --non-interactive --no-wait`. It needs the `EXPO_TOKEN` repository secret and an initialised EAS project.
It never submits anything to a store, and no signing material is stored in the repository or in GitHub.

## EAS Submit

```bash
npx eas-cli submit -p ios --latest
npx eas-cli submit -p android --latest
```

- iOS: signs in with the Apple ID, or better an **App Store Connect API key** stored in EAS credentials. **Requires
  Apple credentials.**
- Android: needs a **Google service account key** (JSON) with access to the app in Play Console, uploaded to EAS
  credentials. The very first Android upload must be done manually in Play Console. **Requires Google Play access.**
- Submission settings live in `eas.json`'s `submit.production`: Android is set to the `internal` track with
  `releaseStatus: "draft"`; the iOS block is empty and will need the App Store Connect app id. Never keys.

## Environment variables and secrets

Every value in `app.config.ts` ends up inside the public app binary. So:

| Variable | Kind | Where |
|----------|------|-------|
| `OPSWATCH_IOS_BUNDLE_ID`, `OPSWATCH_ANDROID_PACKAGE` | Public config | EAS environment variables (plain text). Required for the `production` profile, which refuses to build without them |
| `EAS_PROJECT_ID`, `EXPO_OWNER` | Public config | EAS environment variable or the build shell |
| `OPSWATCH_ASSOCIATED_DOMAIN` | Public config | Same |
| `OPSWATCH_IOS_BUILD_NUMBER`, `OPSWATCH_ANDROID_VERSION_CODE` | Public config | Local builds only while `appVersionSource` is `remote` |
| `EXPO_PUBLIC_DEFAULT_SERVER_URL` | Public config | Optional; only pre-fills the server field |

**Nothing secret goes in the app.** There are no API keys to embed: the app talks only to the user's OpsWatch server
with the user's own session. Store-side credentials (App Store Connect API key, Google service account, signing
keys, APNs key, FCM service account) live in EAS credentials or the owner's password manager, never in the repository,
`eas.json`, `app.config.ts` or `EXPO_PUBLIC_*` variables. EAS "secret" visibility is for build-time values that never
reach the binary; OpsWatch currently has none.

## OTA updates with EAS Update

EAS Update ships JavaScript and asset changes to installed builds without a store review.

State today:

- **`expo-updates` is not installed.** No build can receive an update, and `eas update` has nothing to publish to.
  Enabling it: `npx expo install expo-updates`, then `npx eas-cli update:configure`, then new builds. **Requires
  owner decision.**
- `runtimeVersion: { policy: 'appVersion' }` is already configured, so once updates exist an update will only reach
  builds with the same app version (`0.1.0`) — which is only safe if the version is bumped with every native change.
- The three build profiles already declare their channels (`development`, `preview`, `production`).

Recommendations, for when it is enabled:

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
- Server-side feature flags in `GET /api/v1/server` hide a broken feature immediately, without any app change, and
  work today — unlike EAS Update.
