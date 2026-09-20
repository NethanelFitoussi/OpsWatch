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

Requirements: Node 22 through [nvm](https://github.com/nvm-sh/nvm), and either Expo Go, an iOS simulator (macOS) or
an Android emulator. Details in [development.md](development.md).

```bash
git clone -b feature/mobile git@github.com:NethanelFitoussi/OpsWatch.git   # drop -b once merged into main
cd OpsWatch/apps/mobile
nvm use
npm ci
npm start
```

`expo-dev-client` is a dependency, so `npm start` targets a development build. Press `s` to switch the dev server to
**Expo Go**, then press `a` (Android emulator), `i` (iOS simulator, macOS only) or scan the QR code. On the Connect
screen, choose **Explore the demo** to use the app without a server.

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
| [CHANGELOG.md](CHANGELOG.md) | Mobile release notes |

## License

[MIT](../../LICENSE), like the rest of OpsWatch.
