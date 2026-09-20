# Notifications

## Current status

| Piece | Status |
|-------|--------|
| Local notifications, tap routing, preferences, Android channel | Implemented in the app |
| Remote push from the server | **Not available**: no server implements it, and the demo and mock server report `features.push = false` |
| EAS project id, APNs key, FCM credentials | Not created ([expo-eas.md](expo-eas.md)) |
| Server endpoints `POST /api/v1/me/devices`, `DELETE /api/v1/me/devices/:id` and a sender | Not implemented server-side ([api-contract.md](api-contract.md#contract-gaps--requests)) |
| Anything on iOS | **Never run.** Notification permission, the banner, the lock screen and the tap round trip have not been seen on iOS at all ([ios.md](ios.md)) |

While push is unavailable, Settings → Notifications explains why instead of failing silently: the server does not
support it, the permission was denied, this is not a physical device, or this build has no push project id.

## Architecture

```
OpsWatch server ──(Expo Push API or APNs/FCM)──► device OS ──► expo-notifications
                                                                   │
            foreground: handler filters by the user's preferences  │
            duplicate within 60 s: suppressed                      │
            tap (warm or cold start): select the notification's environment, then
                                      data → routeForNotification → deep-link allow-list → screen
            signed out: destination kept in memory, opened after sign-in
```

- `src/lib/notifications.ts`: pure logic (payload validation, routing, preference filter, duplicate suppression).
- `src/app-shell/notification-effects.tsx`: handler, Android channel, tap handling, device registration and
  unregistration.
- `src/features/settings/notifications-screen.tsx`: preferences and the test notification.

## Categories and preferences

| Category | Meaning |
|----------|---------|
| `critical_problem` | A critical problem opened |
| `alert` | An alert fired |
| `synthetic_failure` | A synthetic check failed |
| `incident` | An incident opened or changed |
| `recovery` | Something recovered |

Preferences (stored locally and sent with the device registration):

- **Enabled** on/off (off by default).
- **Minimum severity**: *Critical only* (`critical`), *Critical + Warning* (`warning`), *All* (`info`).
- **Categories**: any subset of the five above. Recoveries follow their category only, not the severity.

The server filters what it sends; the app applies the same filter to notifications received in the foreground, and
`enabled: false` silences everything — including anything the server sent before it learned of the change. Only
critical notifications play a sound in the foreground; the app does not set a badge.

## Duplicates and environment

- **Duplicates.** The same reference (`type:id:env`) delivered or tapped twice within 60 s is suppressed: one banner,
  one screen. This matters because a cold start replays the last notification response, and because a sender that
  retries would otherwise push two copies of the same alert.
- **Environment.** A notification belongs to one environment. When its payload carries `env`, tapping it selects that
  environment before navigating, so the object that opens is the one the notification was about and not a stranger
  with the same id in whatever environment happened to be selected.

## Device registration

Registration (`POST /me/devices`) runs when notifications are enabled and the server advertises `features.push`. What
was last sent is remembered in `opswatch.device-registration.v1`, and the app re-registers only when one of three
things changed: the Expo push token (it rotates), the **content** of the preferences, or the server. Toggling a
category no longer re-registers on every render.

Unregistration (`DELETE /me/devices/:id`) runs in two cases:

- the user switches notifications **off** in Settings — the server is told to stop sending to this device, rather
  than the app merely staying quiet;
- a session ends (sign-out, expiry, server change) — through a client that still holds the old token, after the app
  has already signed out locally.

The local record is dropped first, so a failed call never leaves the app believing it is still registered.

## Payload rules

- `data` carries a reference only: `{ type, id, env? }`, plus optional `category` and `severity` for foreground
  filtering. `type` is one of `problem`, `alert`, `incident`, `synthetic`, `error`, `service`, `deployment`; ids must
  match `^[A-Za-z0-9._:~-]{1,200}$` and may not be dots only. Anything else is ignored.
- The app builds the route itself through the deep-link allow-list. A payload cannot carry a URL, an action or a token.
- **Titles and bodies are generic** ("Critical problem in production", not log lines, hostnames or error messages):
  they transit Apple, Google (and Expo, if its push service is used) and can appear on a locked screen.
- Android: channel `opswatch-alerts` ("OpsWatch alerts", high importance) with **private lock-screen visibility**: a
  locked screen shows that OpsWatch sent something, not the content.
- iOS: users control lock-screen previews in system settings; generic titles keep them safe either way.

## Enabling remote push

**Requires owner action** on the Expo, Apple and Google sides, and server work.

1. **EAS project id**: `npx eas-cli init`, then set `EAS_PROJECT_ID` for builds. Push tokens are requested with it;
   without it the app reports "no push project in this build" instead of failing.
2. **APNs key** (iOS): create an Apple Push Notifications service key (`.p8`) in the Apple Developer account, or let
   EAS create it, and store it in EAS credentials: `npx eas-cli credentials -p ios`. **Requires Apple credentials.**
3. **FCM v1** (Android): create a Firebase project for the Android package, create a service account key for the
   Firebase Cloud Messaging API (v1), and upload it in EAS credentials (`npx eas-cli credentials -p android`, or
   the project's credentials page on expo.dev). Android builds also need the Firebase app config
   (`google-services.json`) referenced by `android.googleServicesFile` in the app config; it is not a secret in the
   usual sense but keep it out of public forks if you prefer. **Requires Google/Firebase access.**
4. **New builds** (development or production): push works only in builds that carry the project id and credentials,
   never in Expo Go on Android (since SDK 53).
5. **Server**:
   - implement `POST /api/v1/me/devices` (`{ pushToken, platform, preferences }` → `{ id }`) and
     `DELETE /api/v1/me/devices/:id`, bound to the session, upserting by push token;
   - a sender, using the **Expo Push API** with the Expo push tokens (simplest; Expo relays to APNs/FCM with the
     credentials above), or direct APNs/FCM with native device tokens (would need a contract change, since the app
     sends Expo push tokens today);
   - apply preferences server-side, follow the payload rules above, remove tokens that the push service reports as
     invalid, and delete a device's registrations when its session is revoked;
   - set `features.push = true` in `GET /api/v1/server`.

When all of this is in place, enabling notifications in Settings requests the system permission, obtains an Expo push
token and registers it.

## Testing locally

- **Test notification**: Settings → Notifications → **Show a test notification** schedules an immediate local
  notification whose data is `{ type: 'problem', id: 'prb-checkout-5xx', category: 'critical_problem', severity:
  'critical' }`. Tap it: the app opens the checkout problem (from the demo or the mock server) through the allow-list.
  Works in the demo, without any push credentials. Grant the notification permission when asked.
- **Signed-out tap**: send the test notification, sign out, tap it: sign-in is shown, then the problem opens.
- **Duplicate suppression**: send the test notification twice in quick succession — one banner, and a tap opens one
  screen.
- **Switching off**: turn notifications off, send the test notification: nothing is presented. Against a server with
  push, the device is also unregistered.
- **Routing without notifications**: the same routes can be exercised with deep links ([testing.md](testing.md#notifications-and-links)).
- **Remote push** (once enabled): use Expo's push notifications tool on expo.dev or the Expo Push API with a token from a
  development build on a physical device. Simulators and emulators without Google Play services cannot receive
  remote push reliably; test on real devices.
