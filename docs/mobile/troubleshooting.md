# Troubleshooting

Commands run from `apps/mobile` unless stated otherwise.

## The QR code opens "development build" instead of Expo Go

`expo-dev-client` is a dependency, so the dev server starts in development-build mode. Press `s` in the Expo CLI to
switch to Expo Go, or start with `npx expo start --go`. Pressing `a` or `i` in development-build mode tries to open a
build that may not be installed on the device.

## Metro shows old code or strange bundling errors

Clear the Metro cache:

```bash
npx expo start -c
```

If that is not enough: stop Expo, `rm -rf .expo node_modules`, `npm ci`, and start again. After changing
`app.config.ts` or an `EXPO_PUBLIC_*` variable, restart Expo with `-c`; a development build only picks up native
config changes after a rebuild.

## "Network request failed" / cannot reach the server

The request never got an HTTP answer. Check, in order:

1. **URL and scheme.** HTTPS is required. Plain `http://` works only in development builds, for local/private hosts,
   after ticking **Allow plain HTTP for a server on this network** on the Connect screen.
2. **Certificate.** A self-signed or incomplete chain is refused by iOS and Android; there is no bypass. Use a
   certificate from a public CA (for example Let's Encrypt) with the full chain, or a local server over plain HTTP in
   development. Test from the phone's browser: if Safari/Chrome warns, the app will fail too.
3. **iOS App Transport Security.** Release builds require HTTPS with modern TLS; plain HTTP to a LAN host may also be
   blocked by ATS in some build types. Prefer HTTPS or the iOS simulator with `localhost`.
4. **Android emulator host.** `localhost` on the emulator is the emulator itself. Use `http://10.0.2.2:<port>`, or
   `adb reverse tcp:<port> tcp:<port>` and then `http://localhost:<port>`.
5. **Physical phone.** Use the computer's LAN IP (`ip -4 addr` on Linux, `ipconfig getifaddr en0` on macOS), same
   Wi-Fi, no client isolation. The mock server listens on `127.0.0.1` by default: start it with
   `npm run mock-server -- --host 0.0.0.0`. The OpsWatch Docker setup publishes on `127.0.0.1` only.
6. **Firewall** on the computer blocking the port.
7. **VPN or captive portal** on the phone.

## "The server's answer wasn't understood"

The server answered, but not with what the `/api/v1` contract expects (`invalid_response`):

- **Wrong URL**: it points at another site, the OpsWatch web UI without `/api/v1`, or the wrong sub-path.
- **Server does not serve `/api/v1` yet**, or serves a different contract version. The Connect screen names the side
  that is older when `apiVersion` differs.
- **Reverse proxy or captive portal** returning an HTML page (login wall, error page, SSO).
- **A redirect to another host.** The client refuses an answer whose final URL is on a different origin, rather than
  let the bearer token follow it. Point the app at the final host directly.
- **Contract drift** between app and server. The underlying `ApiError` message names the failing field path
  ("Response does not match the contract at …"), never values. Compare with `src/api/contract.ts` and report it in
  [api-contract.md](api-contract.md#contract-gaps--requests).

Check the capability endpoint directly:

```bash
curl -sS https://ops.example.com/api/v1/server
```

## A screen says a feature is unavailable

Two different states, and only one of them is worth retrying:

- **"Not available on this server"** — the server answered `GET /api/v1/server` and that flag is `false` (or absent).
  Nothing in the app will change it; the server has to advertise the capability.
- **The unknown state, with a Retry** — the app has never got a usable answer from `GET /api/v1/server`. Retry once
  the server is reachable.

In demo mode, check Settings → Demo capabilities: a switch there turns a feature off on purpose.

## Sent back to sign-in repeatedly (401 loop)

Any 401 on an authenticated call ends the session. If sign-in succeeds and you are immediately signed out:

- A proxy strips the `Authorization` header: configure it to forward the header.
- The server does not accept bearer tokens on the route, or the token audience is wrong (server side).
- The server clock is wrong and tokens are born expired.
- Mock server started with `--expire-after`.
- On web, the token is memory-only: a page reload signs you out by design.

## Everything is slow, or lists stop refreshing

A server answering `429` with a `Retry-After` header is obeyed: the client waits that long (capped at 30 s) before
retrying an idempotent request. Check the rate limits in front of the server before blaming the app.

## Android emulator not detected

```bash
adb devices                   # should list emulator-5554 device
adb kill-server && adb start-server
```

- Make sure `ANDROID_HOME` and `platform-tools` are on `PATH` ([development.md](development.md#prerequisites)).
- Start the emulator first (Android Studio Device Manager or `emulator -list-avds`, then `emulator -avd <name>`).
- On Linux, hardware acceleration needs KVM: `ls -l /dev/kvm` must exist and your user must have access.
- "unauthorized" in `adb devices` (phone): accept the USB debugging prompt on the phone.

## `npm run android` fails to compile

`npm run android` is `expo run:android`: a real native build, not Expo Go. It needs the Android SDK and a JDK (the one
Android Studio installs is fine), and it regenerates the git-ignored `android/` folder.

- Missing SDK: set `ANDROID_HOME` and install the platform Android Studio asks for.
- A stale generated project: `rm -rf android` and run it again, or `npx expo prebuild --platform android --clean`.
- If you only need to run the app, use `npm start` with Expo Go instead.

## iOS simulator does not boot (macOS)

```bash
xcrun simctl list devices
xcrun simctl shutdown all
xcrun simctl erase all        # resets every simulator
```

- Open Xcode once so it installs components, and select it: `sudo xcode-select -s /Applications/Xcode.app`.
- Install a simulator runtime from Xcode settings.
- On Linux or Windows there is no iOS simulator; see [ios.md](ios.md).
- Nobody has run this app on iOS yet, so an iOS-only failure is probably new. Record it: [ios.md](ios.md#reporting-back).

## Watchman (macOS)

"Recrawl" warnings or missed file changes:

```bash
watchman watch-del-all
watchman shutdown-server
```

Watchman is optional; Metro falls back to its own watcher.

## Port already in use

Metro uses 8081, the mock server 4010, the Playwright static server 4020, the OpsWatch server 3000.

```bash
lsof -i :8081                          # find the process
npx expo start --port 8082             # or use another port
npm run mock-server -- --port 4011
```

## Jest and expo-router test issues

- Run from `apps/mobile`; the root of the repository has its own (Vitest) setup.
- "Cannot use import statement outside a module": the package is missing from `transformIgnorePatterns` in
  `jest.config.js`.
- Route tests: use `renderRouter('./app', { initialUrl })` from `expo-router/testing-library`, and clear AsyncStorage in
  `beforeEach` so sessions do not leak between tests.
- Timeouts in route tests: raise with `jest.setTimeout(20_000)` and use `findBy*` queries with a timeout.
- Clear Jest's cache: `npx jest --clearCache`.

## "65 skipped" in the test output

That is the contract parity suite, which skips itself while `packages/contract` is not on this branch. Point it at a
checkout of the package to actually run it:

```bash
OPSWATCH_CONTRACT_DIR=/path/to/packages/contract npx jest contract-parity
```

If it fails there with a `zod` resolution error, check `moduleNameMapper` in `jest.config.js`: an out-of-tree contract
has no `node_modules` of its own and resolves `zod` through this app's copy.

## Metro cannot resolve `packages/contract`

`metro.config.js` adds the folder to `watchFolders` **only if it exists** at `../../packages/contract`. After the
package lands, restart Metro (`npx expo start -c`) so the new watch folder is picked up.

## Clearing app data

- In the app: Settings → **Change server** signs out and deletes cached data, recent searches and local favorites.
- iOS simulator: long-press the app icon → remove, or `xcrun simctl erase <device>`.
- iPhone: delete the app (Keychain items may survive; the app re-validates any token it finds).
- Android: Settings → Apps → OpsWatch → Storage → Clear storage, or:

```bash
adb shell pm clear com.example.opswatch     # use your package id
```

- Expo Go: clearing Expo Go's data clears every project run in it.
