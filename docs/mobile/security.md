# Mobile security review

The checklist to review before each release, with the current status. Status values: **Done** (implemented and
covered by code review/tests), **Partial**, **Open**, **Server** (depends on the OpsWatch server).

| # | Item | Status |
|---|------|--------|
| 1 | [Token storage](#token-storage) | Done |
| 2 | [Server URL validation](#server-url-validation) | Done |
| 3 | [TLS](#tls) | Done |
| 4 | [OAuth redirects](#oauth-redirects) | Done (app side); Server |
| 5 | [Deep links](#deep-links) | Done |
| 6 | [Local caching](#local-caching) | Partial |
| 7 | [App logs](#app-logs) | Done |
| 8 | [Crash reports](#crash-reports) | Done (none) |
| 9 | [Push payloads](#push-payloads) | Done (app side); push not enabled |
| 10 | [Clipboard](#clipboard) | Done |
| 11 | [Screenshots and app switcher](#screenshots-and-app-switcher) | Partial |
| 12 | [Secrets in config](#secrets-in-config) | Done |
| 13 | [Server-side requirements](#server-side-requirements) | Server |

## Token storage

- The session token is stored only through `expo-secure-store` (iOS Keychain / Android Keystore) with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: readable only while the device is unlocked, never migrated to another device or
  backup. Key per server: `opswatch.session.<FNV-1a hash of the URL>` (the hash only names the key).
- In memory, the token is held in one module-level holder read by the HTTP client at call time.
- Web (QA target only): memory only, never `localStorage`.
- A token found for a server is re-validated (`GET /me`) before use; a 401 anywhere ends the session and deletes it.
- Sign-out calls `POST /auth/logout` (best effort), then deletes the token even offline.
- An unreadable Keystore entry (for example after removing the lock screen) is treated as absent.

Code: `src/state/storage.ts`, `src/state/session.tsx`.

## Server URL validation

`src/lib/server-url.ts`: HTTPS required; plain HTTP only for loopback and private-network hosts, only when `__DEV__`,
only after the user ticks the opt-in. URLs with credentials, a query string or a fragment are refused; unsupported
schemes are refused. The server must answer `GET /api/v1/server` with `product: "opswatch"` before it is saved.

## TLS

- No code path disables certificate verification or pins a custom trust store; the OS validates certificates.
- iOS App Transport Security and Android's default cleartext policy apply in release builds.
- Certificate pinning is not implemented: OpsWatch is self-hosted on arbitrary domains, so there is no fixed key to pin.
- Cookies are never sent (`credentials: 'omit'`); the bearer token is the only credential.

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

## Deep links

`src/lib/deep-links.ts` and `app/+native-intent.tsx`: only allow-listed screens and `<type>/<id>` routes, ids matching
`^[A-Za-z0-9._:~-]{1,200}$`, query strings and fragments dropped, everything else opens Home. Universal/app links are
accepted only for the configured associated domain under `/m/`. Links can navigate, never act (no acknowledge, no
sign-in, no token). Pending destinations are kept in memory only.

## Local caching

- Done: only list queries of `health`, `brief`, `problems`, `services`, `incidents`, `environments` are persisted, in
  AsyncStorage, for at most 24 h, keyed by server + user, wiped on sign-out, expiry and server change. Details, logs,
  stack traces, evidence and AI answers stay in memory.
- Done: Android `allowBackup: false`.
- AsyncStorage is not encrypted by the app. It is inside the app sandbox and covered by the OS's file encryption
  (iOS Data Protection, Android file-based encryption). Accepted risk for glanceable, non-credential data.
- **Open:** `resetServerScoped()` in `src/state/settings.tsx` (environment id, recent searches, local favorites) is not
  called on server change, so recent search texts from one server remain visible after switching to another.

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
deep-link allow-list. The Android channel `opswatch-alerts` uses private lock-screen visibility. Remote push is not
enabled yet ([notifications.md](notifications.md)).

## Clipboard

Copy is user-initiated only (copy buttons for error messages, stack traces, commit SHAs, diffs, synthetic targets);
the app never reads the clipboard. Copied text leaves the app's control: other apps can read the clipboard (iOS shows
a paste notice; Android 13+ shows a copy confirmation and clears the clipboard after a while), and Universal Clipboard
may sync it to the user's other Apple devices. Users should avoid copying sensitive log content.

## Screenshots and app switcher

- Done: optional privacy cover (Settings → "Hide content in the app switcher", on by default) covers the app when it
  leaves the foreground, so the app switcher snapshot shows the OpsWatch logo only.
- Not done: screenshots and screen recording are not blocked (no Android `FLAG_SECURE`, no iOS capture detection).
  Accepted for now: operators often share screenshots during incidents.

## Secrets in config

`app.config.ts`, `eas.json` and `EXPO_PUBLIC_*` values are public and end up in the binary. They hold identifiers only
(bundle id, package, EAS project id, associated domain, build numbers, default server URL). Signing keys, store API
keys, APNs and FCM credentials belong in EAS credentials or a password manager; `apps/mobile/.gitignore` ignores
`*.jks`, `*.p8`, `*.p12`, `*.key`, `*.pem`, `*.mobileprovision` and `.env*.local`. The demo credentials
(`demo@opswatch.dev` / `opswatch-demo`) and demo token are fictional and only work with the demo client and mock server.

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
