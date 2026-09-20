# Privacy

What the OpsWatch mobile app receives, stores and sends, as implemented in `apps/mobile`. The app talks only to the
OpsWatch server the user connects to. The operator of that server (usually the user's own organisation) controls the
data on it; the app's publisher runs no backend for it.

## What the app receives from OpsWatch

- Server capabilities and name (`GET /api/v1/server`).
- The signed-in user's email and optional name.
- A session token and its expiry.
- Operational data of the monitored infrastructure: environments, health, problems, errors and stack traces, services,
  infrastructure resources, log lines, alerts, incidents, synthetic checks, SLOs, deployments and commits,
  investigations, repository evidence (file excerpts and diffs), AI answers, search results, favorites.

This data can contain names of services and resources, hostnames, log contents and code, depending on what the
monitored systems produce.

## What the app stores on the device

| Data | Storage | Lifetime |
|------|---------|----------|
| Session token | iOS Keychain / Android Keystore through `expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, one key per server URL (`opswatch.session.<sanitised URL>.<hash>`). Web (QA only): memory only | Until sign-out, session expiry or server change |
| Server config: URL, demo flag, plain-HTTP flag, last known capabilities, signed-in user's email and name | AsyncStorage `opswatch.server.v1` | Until server change |
| Settings: theme, language, privacy cover on/off, notification preferences, demo capability switches | AsyncStorage `opswatch.settings.v1` | Until changed |
| Session-scoped settings: selected environment id, up to 8 recent search texts (120 characters each), local favorites (only when the server has no favorites support) | AsyncStorage `opswatch.settings.v1` | Cleared whenever a session ends: sign-out, session expiry or server change |
| Offline cache of list queries: health, brief, problems list, services list, incidents list, environments | The OS cache directory, `opswatch-cache/opswatch.query-cache.v1.json` (`expo-file-system`). Web (QA only): AsyncStorage | At most 24 queries, each at most 24 h old, and a snapshot over 2 MB is dropped rather than written; wiped on sign-out, session expiry and server change, and the OS may delete it when storage runs low |
| Push registration id, and the token and preferences it was registered with (only when push is enabled) | Secure storage `opswatch.device-registration.v1` | Removed when the session ends or notifications are switched off |
| Pending deep-link destination while signed out | Memory only | Until used or app restart |

Not stored on disk: details, log lines, stack traces, evidence, AI answers, passwords. Android `allowBackup` is `false`,
so none of the above goes into Android device backups. On iOS the AsyncStorage data (not the token) is part of an
iCloud or iTunes backup ([security.md](security.md#residual-accepted)); the offline cache is not, because it is written
to the cache directory, which neither platform backs up. Uninstalling the app removes both;
iOS may keep Keychain items after uninstall, but they are only readable by a reinstall of the same app, on the same
device, and the app re-validates any found token with the server before using it.

## What the app sends to OpsWatch

Only to the server the user chose, over HTTPS (plain HTTP only for local servers in development builds):

- Email and password at password sign-in; a one-time code and PKCE verifier at Google sign-in.
- The bearer session token on every authenticated request.
- `Accept-Language` (the app's language).
- The selected environment id with data requests.
- Filters and identifiers of what the user opens (problem id, service id, and so on).
- Search text and log search queries typed by the user.
- AI questions typed by the user, with a reference `{ type, id }` to the object in context (never the object's data).
- Favorites (when the server supports them).
- When push is enabled on server and device: a push token, the platform (`ios`/`android`) and notification
  preferences (minimum severity, categories). Switching notifications off sends a delete for that registration.

A response that arrives from a different origin than the request was sent to is discarded rather than read, so the
session token cannot be carried to another host by a redirect.

## What the app does not send anywhere else

Checked against `apps/mobile/package.json` dependencies:

- No analytics SDK.
- No crash reporting SDK.
- No advertising SDK or advertising identifier.
- No third-party trackers.
- No direct calls to AWS, GitHub, Cloudflare or AI providers; no provider credential on the device.

Third parties that may be involved, only through user action or when enabled:

| Party | When | What |
|-------|------|------|
| Google | Google sign-in, if the server enables it | The user signs in on Google's page in the system browser; the app receives a one-time code from the OpsWatch server, not from Google |
| Expo push service, Apple (APNs), Google (FCM) | Only once remote push is enabled | Obtaining a push token contacts Expo's service; notifications transit APNs/FCM. Payloads carry only a reference (type, id, environment, category, severity), never content |
| GitHub | User taps the source code link in Settings | Opens the repository page in the browser |
| Apple / Google stores | Always, as the distribution platform | Their own download, crash and usage statistics under their terms, if the user opted in on the device |

Clipboard: the app writes to the clipboard only when the user taps a copy button (error message, stack trace, commit
SHA, diff, check target, AI answer). It never reads the clipboard.

## App Store privacy answers (draft)

> **Draft, to be reviewed by the owner** before submission. Answers depend on how the owner distributes the app and
> on the server features enabled.

"Data collected" in Apple's sense means data sent off the device to the developer or partners. OpsWatch sends data
only to the server the user configures, which the app publisher does not operate. Two reasonable positions:

1. **Data Not Collected**: the publisher collects nothing; all data goes to a server chosen and operated by the user or
   their organisation. This is the likely answer for a self-hosted client, and the review notes should explain it.
2. If the owner also operates the servers users connect to (for example a hosted OpsWatch), declare:

| Data type | Purpose | Linked to user | Tracking |
|-----------|---------|----------------|----------|
| Contact info → Email address | App functionality (sign-in) | Yes | No |
| User content → Other user content (search text, AI questions) | App functionality | Yes | No |
| Identifiers → Device ID (push token, only when push is enabled) | App functionality (notifications) | Yes | No |

In every case: no tracking, no third-party advertising, no analytics.

## Google Play Data safety answers (draft)

> **Draft, to be reviewed by the owner.**

| Question | Draft answer |
|----------|--------------|
| Does the app collect or share user data? | Same reasoning as above: data goes only to the user-configured server. If the owner operates that server, declare the items below as collected |
| Collected: Personal info → Email address | App functionality, account management; required for sign-in |
| Collected: App activity → Other user-generated content (search text, AI questions) | App functionality; optional |
| Collected: Device or other IDs (push token) | App functionality; only when notifications are enabled |
| Shared with third parties | No |
| Encrypted in transit | Yes (HTTPS required; plain HTTP only in development builds for local servers) |
| Users can request deletion | Sign-out and server change delete local data; server-side data is managed by the server operator |
| Advertising ID, location, contacts, photos, files, audio, health, financial info | Not collected |

Also answer "Ads: No" in the app content section.

## Android permissions actually in the release build

Read from the merged manifest of a release build on 2026-09-20 (`expo prebuild` + `gradlew assembleRelease`). Only
the first two are asked for by OpsWatch itself; the rest are merged in by libraries and need no runtime consent.

| Permission | Why it is there |
|------------|-----------------|
| `INTERNET` | Talking to your OpsWatch server. Nothing else is contacted |
| `POST_NOTIFICATIONS` | Showing notifications, once you turn them on |
| `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` | Connectivity detection (`@react-native-community/netinfo`), which drives the offline banner |
| `VIBRATE` | Vibration for a notification, and the short confirmation felt when an action succeeds or fails (`expo-haptics`) |
| `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `READ_APP_BADGE` | Merged by `expo-notifications` and its support libraries for scheduled and incoming notifications |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | Merged through `expo-secure-store`; OpsWatch never asks for biometric authentication and stores its token with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. The iOS side of the same library is configured with `faceIDPermission: false`, so the app declares no Face ID usage at all |

`app.config.ts` blocks `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW`
("draw over other apps"), each of which a dependency would otherwise merge in; the last one was found in an earlier
release build and is absent since. No location, camera, microphone or contacts permission is present. `allowBackup`
is `false`, so the offline cache is not swept into Google Drive backups.

Re-read this list from the merged manifest whenever a dependency is added or upgraded: it is the only place the real
answer exists.
