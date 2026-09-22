# OpsWatch mobile changelog

All notable changes to the mobile app. Versions follow [Semantic Versioning](https://semver.org/). Release tags use
the `mobile-v` prefix ([release.md](release.md)).

## Unreleased

Not yet published to any store. Nothing in this list has run on iOS ([ios.md](ios.md)).

### The app

- Expo SDK 57 app for iOS and Android, English and French, light and dark themes.
- Connect to any self-hosted OpsWatch server over HTTPS; capability discovery through `GET /api/v1/server`.
- Sign-in with email and password; Google sign-in with PKCE when the server supports it.
- Home, Morning Brief, Problems, Alerts, Services, Errors, Logs, Infrastructure, Deployments, Incidents, Synthetics,
  SLOs, Investigations, Evidence, Ask OpsWatch, Search, Settings.
- Offline cache of glanceable lists, marked stale when not live.
- Deep links through an allow-list; local notifications and notification routing (remote push pending server support).
- Demo mode and a contract mock server, both implementing the whole contract from the same fixtures.

### Added in the hardening pass

- Demo capability switches (Settings, demo mode only): turn a capability off and watch the app degrade as it would
  against a server that lacks it.
- Demo fixtures that are deliberately incomplete — an alert with no start time or service, a check that has never
  run, a deployment with no commit, a resource with no metrics — so the "no data" states are exercised.
- "This server does not provide X" and "the app has not been able to ask this server" are now different states: only
  the second offers a retry.
- Haptic confirmation when an action succeeds or fails (`expo-haptics`), and a themed native root background
  (`expo-system-ui`) so no white flash shows in dark mode.
- A contract parity test against `packages/contract`, skipped until that package is on this branch and runnable
  against another checkout with `OPSWATCH_CONTRACT_DIR`; Metro and Jest are already wired for an out-of-tree contract.
- `expo-dev-client` for development builds; `@types/jest` pinned to the version the SDK expects (`expo-doctor` 21/21).

### Fixed and hardened

- Sign-out clears the session locally — token out of memory and out of the Keychain — before any network call, then
  revokes it server-side with the old token. A hanging network can no longer leave the app signed in.
- The HTTP client refuses an answer that came from another origin, so a redirect cannot carry the bearer token
  elsewhere; the request timeout now covers reading the body; a rate-limited server's `Retry-After` is obeyed, capped
  at 30 s.
- Notifications: duplicates suppressed within 60 s, the notification's environment selected before its object opens,
  registration refreshed only when the push token, preferences or server change, and switching notifications off
  unregisters the device instead of only silencing it.
- Offline cache: persisted only for an allow-list of list queries, bounded to 24 queries and 24 hours, keyed by
  server and user, and restored only once the session is known (a cold start no longer threw the cache away).
- Deep links: an id made only of dots is refused; both platforms read the associated domain from the same config key.
- The Keychain key is derived from the sanitised server URL instead of a 32-bit hash that could collide.
- Recent searches, local favorites and the selected environment are cleared on every session end.
- Android: `SYSTEM_ALERT_WINDOW`, merged in by a dependency, is blocked; the permissions in a real release build are
  documented in [privacy.md](privacy.md).
- iOS project: no Face ID permission (the app never uses biometrics) and OpsWatch's own local-network prompt wording.
  Verified by generating the project only — the app has still never been run on iOS.

### Verified

- Lint, typecheck, 1167 tests in 53 suites (the 66-test parity suite skipped); `expo-doctor` 21/21.
- Web export toured at six device profiles; WCAG AA contrast checked for 20 colour pairs in both palettes.
- A release APK built and run on an Android 15 emulator (Pixel 7, x86_64): demo mode, tabs, deep links, dark mode,
  the offline banner, tablet geometry and landscape. Cold start 670–770 ms.
- **iOS: never run.** No simulator, no device, no EAS build.
