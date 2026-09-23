# Mobile security review

The checklist to review before each release, with the current status. Status values: **Done** (implemented and
covered by code review/tests), **Partial**, **Open**, **Server** (depends on the OpsWatch server).

Everything below has been reviewed as code and, where it is observable, exercised on Android. **None of it has ever
been exercised on iOS**: no simulator, no device, no EAS build. Wherever iOS behaviour differs — Keychain
accessibility, the app-switcher snapshot, backups — treat this document as reviewed intent, not as an observation
([ios.md](ios.md)).

| # | Item | Status |
|---|------|--------|
| 1 | [Token storage](#token-storage) | Done |
| 2 | [Server URL validation](#server-url-validation) | Done |
| 3 | [Transport](#transport) | Done |
| 4 | [OAuth redirects](#oauth-redirects) | Done (app side); Server |
| 5 | [Deep links](#deep-links) | Done |
| 6 | [Local caching](#local-caching) | Partial (iOS backups) |
| 7 | [App logs](#app-logs) | Done |
| 8 | [Crash reports](#crash-reports) | Done (none) |
| 9 | [Push payloads](#push-payloads) | Done (app side); push not enabled |
| 10 | [Clipboard](#clipboard) | Done |
| 11 | [Screenshots and app switcher](#screenshots-and-app-switcher) | Partial |
| 12 | [Permissions asked for](#permissions-asked-for) | Done |
| 13 | [Secrets in config](#secrets-in-config) | Done |
| 14 | [Server-side requirements](#server-side-requirements) | Server |

## Token storage

- The session token is stored only through `expo-secure-store` (iOS Keychain / Android Keystore) with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: readable only while the device is unlocked, never migrated to another device or
  backup.
- One key per server, built from the URL itself: `opswatch.session.<sanitised lower-case URL, 96 chars>.<FNV-1a hash>`.
  The URL is sanitised rather than hashed, because a 32-bit hash can collide and a collision would hand one server's
  token to another; the hash is only a suffix that keeps the key short for long URLs.
- In memory, the token is held in one module-level holder read by the HTTP client at call time.
- Web (QA target only): memory only, never `localStorage`.
- A token found for a server is re-validated (`GET /me`) before use; a 401 anywhere ends the session and deletes it.
- Sign-out deletes the token **before** any network call, then revokes it server-side as best effort, so it works
  offline and cannot be delayed by a hanging network.
- An unreadable Keystore entry (for example after removing the lock screen) is treated as absent.

Code: `src/state/storage.ts`, `src/state/session.tsx`.

## Server URL validation

`src/lib/server-url.ts`: HTTPS required; plain HTTP only for loopback and private-network hosts, only when `__DEV__`,
only after the user ticks the opt-in (the switch itself is rendered only under `__DEV__`). URLs with credentials, a
query string or a fragment are refused; unsupported schemes are refused. The server must answer `GET /api/v1/server`
with `product: "opswatch"` before it is saved.

## Transport

- No code path disables certificate verification or pins a custom trust store; the OS validates certificates.
- iOS App Transport Security and Android's default cleartext policy apply in release builds. The generated
  `Info.plist` sets `NSAllowsArbitraryLoads: false`.
- Certificate pinning is not implemented: OpsWatch is self-hosted on arbitrary domains, so there is no fixed key to pin.
- Cookies are never sent (`credentials: 'omit'`); the bearer token is the only credential.
- **The answer must come from the origin the request went to.** `src/api/http.ts` compares `response.url`'s origin
  with the request's and treats a mismatch as `invalid_response`, so a redirect cannot carry the bearer token to
  another host.
- **The timeout covers the body.** The abort timer is cleared only after the response has been read and parsed, so a
  server that sends headers and then stalls is still cut off at the request's timeout.
- **`Retry-After` is honoured but bounded.** A 429 with a seconds value delays the next retry by that much, capped at
  30 s; longer or non-numeric values fall back to the normal jittered backoff, and the error surfaces instead of the
  app sleeping indefinitely.

## OAuth redirects

Google sign-in, when the server advertises `auth.google`:

1. The app creates a PKCE verifier (32 random bytes) and `state` (16 random bytes) with `expo-crypto`.
2. It opens `GET /api/v1/auth/google/start?redirectUri&codeChallenge&codeChallengeMethod=S256&state` in an
   ephemeral system browser session (`expo-web-browser`, `preferEphemeralSession`).
3. The server runs the Google OIDC flow itself and redirects to `opswatch://auth/callback?code=…&state=…` with a
   **server-minted one-time code** (never a Google token or a session token).
4. The app rejects a mismatched `state`, then exchanges `{ code, codeVerifier, redirectUri }` at
   `POST /api/v1/auth/google/exchange`.

Server requirements: the redirect URI is compared **exactly** against an allow-list containing
`opswatch://auth/callback`; the code is single-use, short-lived and bound to the PKCE challenge. Another app claiming
the `opswatch` scheme could receive the code but cannot redeem it without the verifier. The callback route is reserved
in `app/+native-intent.tsx`. In Expo Go the redirect is an `exp://` URL that the server should not allow-list.

This flow has never been run end to end: no server implements it yet.

## Deep links

`src/lib/deep-links.ts` and `app/+native-intent.tsx`: only allow-listed screens and `<type>/<id>` routes, ids matching
`^[A-Za-z0-9._:~-]{1,200}$` and never made of dots alone, query strings and fragments dropped, everything else opens
Home. Universal/app links are accepted only for the configured associated domain under `/m/`, and both platforms read
that domain from the same config value (`extra.associatedDomain`). Links can navigate, never act (no acknowledge, no
sign-in, no token). Pending destinations are kept in memory only.

## Local caching

- Done: only **list** queries of `health`, `brief`, `problems`, `services`, `incidents`, `environments` are persisted,
  and the set is bounded three ways: at most 24 hours old, at most 24 queries (`MAX_PERSISTED_QUERIES`, most recent
  first) and at most 2 MB per snapshot. Details, logs, stack traces, evidence and AI answers stay in memory.
- Done: the cache is keyed by server + signed-in user, and wiped on sign-out, session expiry and server change.
- Done: the environment id, the recent searches someone typed and device-local favorites are cleared on **every**
  session end, not only on a server change (`SessionEffects` calls `resetServerScoped` from the session-end listener).
- Done: Android `allowBackup: false`.
- Done: the cache is written to the OS cache directory rather than AsyncStorage, which both platforms sweep into
  device backups. `forgetBackedUpCache()` deletes the copy older versions left in AsyncStorage.
- Neither store is encrypted by the app. Both are inside the app sandbox and covered by the OS's file encryption
  (iOS Data Protection, Android file-based encryption). Accepted risk for glanceable, non-credential data.
- Preferences that are not the cache (server config, settings) do still live in AsyncStorage, and on iOS are part of a
  backup. They hold no credentials; the session token is Keychain-only.

## App logs

`src/lib/log.ts` is the only logger (ESLint forbids `console.log`). It redacts `Authorization` values, bearer tokens,
password/secret/token/API key/code verifier fields, AWS key ids and 40-character secrets, GitHub tokens, AI provider
keys and Expo push tokens. Debug output is printed only in development builds. The HTTP layer never logs headers or
bodies; contract errors report the failing path, never values. Device logs (Xcode console, `adb logcat`) are visible
to anyone with the unlocked device and a cable, which is why nothing sensitive is logged.

## Crash reports

No crash reporting SDK is included (`package.json`). Crashes are only visible through Apple's and Google's own
reports for users who opted in. If one is added later, it must go through the same redaction and be declared in
[privacy.md](privacy.md).

## Push payloads

Payload `data` carries only a reference `{ type, id, env? }` plus optional `category` and `severity` for foreground
filtering; titles should stay generic. The app validates the payload and builds the route itself through the
deep-link allow-list. A repeated delivery of the same reference is suppressed within 60 s, so a server retry cannot
push two screens or two banners. The Android channel `opswatch-alerts` uses private lock-screen visibility.

Switching notifications off in Settings both silences foreground presentation and calls `DELETE /me/devices/:id`, so
the server stops sending to a device the user has opted out on. The registration is refreshed only when the push
token, the preferences' content or the server changes. Remote push is not enabled anywhere yet
([notifications.md](notifications.md)).

## Clipboard

Copy is user-initiated only (copy buttons for error messages, stack traces, commit SHAs, diffs, synthetic targets, AI
answers); the app never reads the clipboard. Copied text leaves the app's control: other apps can read the clipboard
(iOS shows a paste notice; Android 13+ shows a copy confirmation and clears the clipboard after a while), and
Universal Clipboard may sync it to the user's other Apple devices. Users should avoid copying sensitive log content.

## Screenshots and app switcher

- Done: optional privacy cover (Settings → "Hide content in the app switcher", on by default) covers the app when it
  leaves the foreground, so the app switcher snapshot shows the OpsWatch mark and name only. Verified on Android;
  never observed on iOS.
- Not done: screenshots and screen recording are not blocked (no Android `FLAG_SECURE`, no iOS capture detection).
  Accepted for now: operators often share screenshots during incidents.

## Permissions asked for

The app declares `INTERNET` and `POST_NOTIFICATIONS` and blocks `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`,
`RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` (`app.config.ts`), so nothing a dependency merges in can quietly add
"draw over other apps" or storage access. The full inventory read from a release build is in
[privacy.md](privacy.md#android-permissions-actually-in-the-release-build).

On iOS the app declares no permission of its own beyond what the OS asks at runtime for notifications. The
`expo-secure-store` config plugin is configured with `faceIDPermission: false`, so the generated project contains no
`NSFaceIDUsageDescription`: OpsWatch never asks for biometric authentication, and a Face ID string would have claimed
otherwise in the App Store listing. The local-network description is OpsWatch's own wording, not the Expo
dev-launcher default, because a release build may legitimately need the local network to reach a server on the same
network. Both were checked in the generated `ios/OpsWatch/Info.plist`.

## Secrets in config

`app.config.ts`, `eas.json` and `EXPO_PUBLIC_*` values are public and end up in the binary. They hold identifiers only
(bundle id, package, EAS project id, associated domain, build numbers, default server URL). Signing keys, store API
keys, APNs and FCM credentials belong in EAS credentials or a password manager; `apps/mobile/.gitignore` ignores
`*.jks`, `*.keystore`, `*.p8`, `*.p12`, `*.key`, `*.pem`, `*.mobileprovision`, `.env*.local` and the generated
`ios/` and `android/` folders. The demo credentials (`demo@opswatch.dev` / `opswatch-demo`) and demo token are
fictional and only work with the demo client and mock server.

## Server-side requirements

Agreed with the server team; the app relies on them:

| Requirement | Why |
|-------------|-----|
| Bearer tokens with a mobile audience, accepted only on `/api/v1` bearer routes, never as a cookie | A leaked cookie or web token is not a mobile token and vice versa |
| Absolute token lifetime (not only rolling) and session revocation (`POST /auth/logout`, and revocation of all sessions) | Bounds the life of a stolen token; sign-out really ends the session |
| Login throttle on `POST /auth/login` and `POST /auth/google/exchange`, like the web sign-in | Same brute-force protection as the web |
| Exact redirect URI allow-list (`opswatch://auth/callback`), single-use short-lived PKCE-bound codes | Code interception is useless |
| `allowedActions` computed server-side | The app never decides authorisation |
| Errors never include secrets or provider credentials | Messages are displayed |
| Push payloads with references only (when push ships) | Lock screens and notification services see no content |
| `Retry-After` on 429 | The client obeys it, capped at 30 s, instead of guessing |

## Independent review, 2026-09-20

A reviewer who had not seen the implementation reasoning read every path end to end. Six defects were confirmed: five
are fixed, and the sixth (iOS backups) is an accepted residual, documented below with its reason. The rest of the
table is hardening the same pass produced.

| Finding | Severity | Status |
|---------|----------|--------|
| Turning notifications off neither unregistered the device nor silenced foreground banners | Medium | **Fixed.** Switching off calls `unregisterFromPush`, and `shouldPresent` returns false when notifications are disabled |
| Sign-out kept the token live for up to ~60 s on a hanging network (revocation was awaited before the local clear) | Medium | **Fixed.** The app signs out locally first — token out of memory and Keychain, state changed — then revokes server-side through a client still holding the old token. Covered by a test that holds `logout` open and asserts the app is already signed out |
| `isSafeId` accepted `.` and `..`, which a URL parser normalises into a path walk | Low | **Fixed.** Dot-only ids are refused; `parseDeepLink` already collapsed them to the list screen |
| The release Android build carried `SYSTEM_ALERT_WINDOW`, merged in from a dependency | Low | **Fixed.** Added to `blockedPermissions`; absent from the release manifest since |
| Recent searches and local favorites survived sign-out in plaintext AsyncStorage | Low | **Fixed.** They are cleared on every session end, not only on a server change |
| No iOS counterpart to the Android backup exclusion | Low | **Documented**, see below |
| Keychain key was a 32-bit hash of the server URL (collisions are cheap) | Hardening | **Fixed.** The key is the sanitised URL plus the hash as a suffix |
| No origin check on the response, so a redirect could carry the bearer token elsewhere | Hardening | **Fixed.** A response from another origin is refused as `invalid_response` |
| The response body was read outside the request timeout | Hardening | **Fixed.** The timer is cleared only after the body is parsed |
| Toggling one notification category re-registered the device | Hardening | **Fixed.** The effect is keyed on the preferences' content |
| Android app links were validated against an iOS config key | Hardening | **Fixed.** Both platforms read `extra.associatedDomain` |

### Also hardened in the same pass

Not review findings; changes made while going over the same paths. All are in the code today.

| Change | Where |
|--------|-------|
| The iOS project no longer asks for Face ID: the app never uses biometrics, and the string would have claimed otherwise in the store listing | `expo-secure-store` plugin, `faceIDPermission: false` |
| The local-network prompt is OpsWatch's own wording instead of the Expo dev-launcher's | `ios.infoPlist.NSLocalNetworkUsageDescription` |
| A rate-limited server's `Retry-After` is obeyed, capped at 30 s | `src/api/http.ts` |
| The same notification, delivered or replayed twice, shows one banner and opens one screen | `src/lib/notifications.ts`, `isRepeat` |
| A notification's environment is selected before its object is opened | `src/app-shell/notification-effects.tsx` |
| The offline cache is bounded in number as well as age (24 list queries, 24 h) | `src/api/query-provider.tsx` |
| The offline cache is out of device backups on both platforms: it moved to the OS cache directory | `src/state/cache-storage.ts` |

### Review 3 — the surface added after review 2 (2026-09-23)

Screenshot mode, System status, Checkup and the list filters. Three findings, all fixed.

| Finding | Severity | Status |
|---|---|---|
| **Screenshot mode could reach a production build.** `EXPO_PUBLIC_SCREENSHOT_AT` freezes the app's clock. In a build people use, every age would stop moving and a monitoring app would go on reporting hours-old data as "updated just now" — the one thing it exists not to do. An environment variable can be left behind in a shell, a CI job or an EAS project | **High** | **Fixed.** `app.config.ts` refuses to build the `production` profile while it is set, the way it already refuses a placeholder identifier |
| **System status rendered unbounded server strings.** The job name, its error code and the collector's host are free text the contract does not constrain. A long one pushed the screen apart — and reached the *accessibility label*, which a screen reader would have read out in full | Medium | **Fixed.** Bounded at 120 characters with a visible ellipsis, in the text, the testID and the accessibility label alike |
| **Checkup leaked unfilled placeholders.** A check that could not run carries no values, so the sentence a *finding* uses left `{version}` on screen. More generally, nothing guarantees a server sends the values a given sentence needs | Medium | **Fixed.** A not-run check shows the check's **name**; and any sentence that still contains an unfilled placeholder after substitution falls back to that name, so the class is closed rather than the instance |

Checked and found sound: the filters (a service id from a deep link is refused by `isSafeId` before it can become a
query parameter, and nothing undeclared is sent); System status is a *detail* query and so never reaches the offline
cache, which matters because it names an instance's hosts and jobs; and screenshot mode exposes no setter, so it
cannot be switched on by a server response, a deep link or a stored preference.

### Residual, accepted

- **The clipboard is not marked sensitive.** Copying a stack trace, a log line or a diff is always an explicit user
  action, but Android 13+ shows a preview of what was copied and iOS may sync it to the user's other devices through
  Universal Clipboard. expo-clipboard exposes no sensitivity flag today.
- **The app-switcher cover is rendered by JavaScript.** It reacts to `AppState`, so on iOS a snapshot can in principle
  be taken before React commits the cover. A native snapshot guard would close the remaining gap. Nobody has yet
  watched this happen on iOS at all.
