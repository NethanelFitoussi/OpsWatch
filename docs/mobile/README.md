# OpsWatch mobile

OpsWatch mobile is the iOS and Android companion to a self-hosted OpsWatch server. It answers, in a few
seconds: *Is everything healthy? What is broken? Why? How serious? What changed? Do I need to act?*

It talks to one OpsWatch server that you choose, and nothing else. It never calls AWS, GitHub, Cloudflare or an
AI provider directly, and never stores a provider credential on the device. It reads; it does not administer
integrations (that stays on the web app).

The app lives in [`apps/mobile`](../../apps/mobile): an Expo SDK 57 / React Native 0.86 project with expo-router,
TypeScript strict, TanStack Query and zod. It is a standalone npm project with its own `package.json` and lockfile.

## Status

| Area | Status |
|------|--------|
| App | In development on branch `feature/mobile` |
| Stores | Nothing published to the App Store or Google Play |
| Accounts | No Expo/EAS project, Apple Developer or Google Play account exists yet ([app-identity.md](app-identity.md)) |
| Identifiers | Bundle id and package are `com.example.opswatch` placeholders, rejected by the stores |
| Server API | The `/api/v1` contract is defined; the server implements it incrementally ([api-contract.md](api-contract.md)) |
| Shared contract | `src/api/contract.ts` is still a local copy. `packages/contract` exists on the server team's branch, not on this one; parity is checked and currently skipped ([api-contract.md](api-contract.md#parity-with-packagescontract)) |
| Push notifications | Not enabled: no server implements `features.push`, and the demo and mock server report it as `false` ([notifications.md](notifications.md)) |
| Android | Release APK built and run on an Android 15 emulator ([testing.md](testing.md#what-has-actually-been-verified)) |
| iOS | **Never run.** Developed on Linux; the iOS project has only been generated and inspected statically. A maintainer with a Mac is needed ([ios.md](ios.md)) |

Until the server serves `/api/v1`, use the built-in **demo** or the local **mock server** ([development.md](development.md)).

## Features

The app only shows a feature when the server advertises it in `GET /api/v1/server` (capability discovery). It keeps
two cases apart: *this server does not provide the feature* (shown as unavailable, nothing to retry) and *the app has
not been able to ask this server what it provides* (shown as unknown, with a retry). Missing data is never shown as
zero.

- **Home**: environment badge (production stands out), overall status, critical/warning counts, most important
  problem, changes since yesterday, synthetics, active alerts, recent incidents and deployments.
- **Morning Brief**: what changed over the period.
- **Problems**, **Alerts** (with acknowledge when the server allows it), **Services**: the main tabs.
- **More**: Errors (stack traces), Logs (search), Infrastructure, Deployments, Incidents, Synthetics, SLOs,
  Ask OpsWatch (AI, when enabled), Search, Settings.
- Detail screens, Investigations (observed facts, correlations, hypotheses) and repository Evidence.
- Environments (connection × region), favorites, English and French, light and dark themes.
- Sign-in with email and password, or Google when the server supports it.
- Offline: a cache of the most recent glanceable lists (at most 24 of them, at most 24 h old), clearly marked as stale.
- Deep links (`opswatch://…`) through an allow-list; notifications carry references only.
- Demo mode with realistic fixtures and a permanent **DEMO DATA** banner, plus capability switches that let a
  contributor watch the app degrade as it would against a server without those features.

## Quick start

Requirements: **Node 22** (`.nvmrc` pins it; `package.json` requires `>=22.12`) and npm. For a device you also need
either Expo Go, an Android emulator, or an iOS simulator (macOS only). Full setup, from an empty machine, is in
[development.md](development.md).

```bash
git clone -b feature/mobile git@github.com:NethanelFitoussi/OpsWatch.git   # drop -b once merged into main
cd OpsWatch/apps/mobile
nvm use                  # Node 22
npm ci                   # exact versions from package-lock.json
cp .env.example .env     # optional: every value in it is optional
npm start                # Metro / the Expo dev server
```

Then press **`a`** for an Android emulator, **`i`** for an iOS simulator (macOS), or scan the QR code with a phone.
`expo-dev-client` is a dependency, so `npm start` targets a **development build**; press **`s`** first to switch the
dev server to **Expo Go** if that is what you have installed.

On the Connect screen, tap **Explore the demo**: fictional data, no server, no account, no AWS. That is the whole
app, working, in about two minutes.

To point it at something real instead, see [Connecting to a server](development.md#connecting-to-an-opswatch-server).

## The commands, in one place

Every command runs from `apps/mobile`. Each one is linked to the document that explains it.

| What you want | Command | Notes |
|---|---|---|
| Install | `npm ci` | Never `npm install` unless you mean to change the lockfile |
| Run it | `npm start` | [development.md](development.md#run) |
| Run it against fake data | `npm start`, then **Explore the demo** | No server needed ([demo mode](development.md#demo-mode)) |
| Run a fake OpsWatch server | `npm run mock-server` | Real HTTP on `:4010` ([development.md](development.md#mock-server)) |
| **Full quality gate** | `npm run check` | Lint, typecheck and the whole test suite ([testing.md](testing.md)) |
| Just the tests | `npm test` | |
| Android, on an emulator, from source | `npm run android` | A real native build; needs the Android SDK and a JDK |
| iOS, on a simulator, from source | `npm run ios` | A real native build; **macOS only** |
| Android release APK, locally | `cd android && ./gradlew assembleRelease` | [android.md](android.md#build-locally) |
| Android release AAB, for the Play Store | `eas build --platform android --profile production` | Cloud build ([expo-eas.md](expo-eas.md)) |
| iOS release build, for TestFlight | `eas build --platform ios --profile production` | Cloud build; needs an Apple account ([ios.md](ios.md)) |
| Check the config | `npx expo config --type public` | Shows the identifiers that would be built |
| Check the toolchain | `npm run doctor` | `expo-doctor` |
| Regenerate store screenshots | `npm run store:android` (Play) · `npm run store:capture` (previews) | [store-assets.md](store-assets.md) |

The `production` profile refuses to build while the store identifiers are still `com.example.opswatch`. That is
deliberate: an identifier cannot be changed after a first release ([release.md](release.md)).

## Documentation

| Document | Content |
|----------|---------|
| [development.md](development.md) | Prerequisites, running on simulators, emulators and devices, demo, mock server |
| [architecture.md](architecture.md) | Layers, data flow, errors, session, offline cache, deep links, i18n, theming, tests |
| [api-contract.md](api-contract.md) | The `/api/v1` endpoints mobile uses, capability flags, change process, gaps |
| [ios.md](ios.md) | Xcode, the first-ever iOS run checklist, Apple Developer account, signing, TestFlight, App Store |
| [android.md](android.md) | Android Studio, signing, Play App Signing, Play Console tracks, Data safety |
| [expo-eas.md](expo-eas.md) | Expo account, EAS Build/Submit/Update, profiles, environment variables, rollback |
| [testing.md](testing.md) | Automated tests, manual device testing, full release checklist, what is actually verified |
| [release.md](release.md) | Versioning, identifiers, signing, store checklist, release steps and rollback |
| [privacy.md](privacy.md) | What the app receives, stores and sends; permissions; draft store privacy answers |
| [security.md](security.md) | Mobile security review checklist and status |
| [notifications.md](notifications.md) | Notification architecture, payload rules, enabling remote push |
| [app-identity.md](app-identity.md) | Placeholders the owner must replace: ids, domains, icons, versions |
| [troubleshooting.md](troubleshooting.md) | Common errors and fixes |
| [merge-notes.md](merge-notes.md) | Merging `feature/mobile` with the web/API work |
| [store-assets.md](store-assets.md) | Store screenshots: the pipeline, what is genuine, and how to regenerate |
| [RECOVERY.md](RECOVERY.md) | Where the branch stands, the constraints it is bound by, and how to continue it |
| [CHANGELOG.md](CHANGELOG.md) | Mobile release notes |

## License

[MIT](../../LICENSE), like the rest of OpsWatch.
