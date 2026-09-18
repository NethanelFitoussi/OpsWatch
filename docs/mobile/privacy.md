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
| Session token | iOS Keychain / Android Keystore through `expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, one key per server URL (`opswatch.session.<hash>`). Web (QA only): memory only | Until sign-out, session expiry or server change |
| Server config: URL, demo flag, plain-HTTP flag, last known capabilities, signed-in user's email and name | AsyncStorage `opswatch.server.v1` | Until server change |
| Settings: theme, language, selected environment id, privacy cover on/off, notification preferences, up to 8 recent search texts, local favorites (only when the server has no favorites support) | AsyncStorage `opswatch.settings.v1` | Until changed. `resetServerScoped()` (environment, recent searches, local favorites) exists but is not called on server change at the time of writing: see [security.md](security.md#local-caching) |
| Offline cache of list queries: health, brief, problems list, services list, incidents list, environments | AsyncStorage `opswatch.query-cache.v1` | At most 24 h; wiped on sign-out, session expiry and server change |
| Push registration id (only when push is enabled) | AsyncStorage `opswatch.device-registration.v1` | Removed when the session ends |
| Pending deep-link destination while signed out | Memory only | Until used or app restart |

Not stored on disk: details, log lines, stack traces, evidence, AI answers, passwords. Android `allowBackup` is `false`,
so none of the above goes into Android device backups. Uninstalling the app removes AsyncStorage data; iOS may keep
Keychain items after uninstall, but they are only readable by a reinstall of the same app, on the same device, and
the app re-validates any found token with the server before using it.

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
  preferences (minimum severity, categories).

## What the app does not send anywhere else

Checked against `apps/mobile/package.json` dependencies at the time of writing:

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
SHA, diff, check target). It never reads the clipboard.

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
