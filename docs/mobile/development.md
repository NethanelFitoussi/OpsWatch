# Development

How to run the OpsWatch mobile app on a simulator, an emulator or a phone, against the demo, the mock server or a
real OpsWatch server. All commands run from `apps/mobile` unless stated otherwise.

If you only want to see the app working, the shortest path is: `npm ci`, `npm start`, press `s` to switch to Expo Go,
press `a`, then tap **Explore the demo**. No server, no account, no configuration.

## Prerequisites

| Tool | Needed for | Notes |
|------|-----------|-------|
| Node 22 (via nvm) | Everything | `apps/mobile/.nvmrc` pins `22`; `package.json` requires `>=22.12` |
| npm | Everything | Use `npm ci` so the lockfile is respected |
| Watchman | Optional, macOS | Faster file watching: `brew install watchman` |
| Expo Go | Quick tries on a phone or emulator | App Store / Google Play; enough for the demo, the mock server and password sign-in |
| Android Studio, Android SDK, an emulator | Android emulator | Linux, macOS or Windows. Create a virtual device in the Device Manager |
| Android Studio's JDK + Android SDK | `npm run android` (local native build) | `expo run:android` compiles the app; it is not needed for Expo Go |
| Xcode + iOS Simulator | iOS simulator | **macOS only**. Install from the Mac App Store, open it once, accept the license, install a simulator runtime |

Install Node:

```bash
nvm install 22
nvm use          # reads apps/mobile/.nvmrc
node --version   # v22.12 or later
```

For Android, make sure `adb` is on your `PATH` (it lives in the SDK `platform-tools` folder), for example in
`~/.bashrc` or `~/.zshrc`:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"          # macOS: $HOME/Library/Android/sdk
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
```

> iOS: there is no way to run the iOS Simulator on Linux or Windows. Without a Mac, test iOS through a physical
> iPhone with Expo Go, or through EAS cloud builds ([ios.md](ios.md), [expo-eas.md](expo-eas.md)). Nobody has run this
> app on iOS yet; [ios.md](ios.md) has the checklist for whoever does it first.

## Install

```bash
cd apps/mobile
nvm use
npm ci
npm run doctor     # expo-doctor: 21 checks of dependency versions and config (21/21 on 2026-09-20)
```

## Expo Go or a development build

`expo-dev-client` is a dependency of this app, so `npx expo start` (and `npm start`) opens in **development build**
mode by default. Press `s` in the Expo CLI to switch the dev server to **Expo Go**, or start it with
`npx expo start --go`. Nothing else changes; it only decides which app the bundle is served to.

| | Expo Go | Development build |
|---|---------|-------------------|
| Setup | Install the Expo Go app, run `npm start`, press `s`, scan the QR code | Build once with EAS (or locally with `npm run android` / `npm run ios`), install on the device |
| Native code | Only what Expo Go bundles | Exactly this app's native modules and config (`app.config.ts`) |
| Remote push | Not available on Android since SDK 53; not usable for OpsWatch on iOS either (needs the app's own identity) | Available once push credentials exist ([notifications.md](notifications.md)) |
| URL scheme | `exp://…` | `opswatch://…` |
| Google sign-in redirect | Redirect URI is an `exp://` URL, which the server will not allow-list | `opswatch://auth/callback` |
| Keychain options, privacy cover, Android channel | Approximated | Real behaviour |

Expo Go is fine for UI work, the demo and password sign-in. Use a development build for notifications, deep links,
Google sign-in and anything that must behave like the release app. Building one is described in
[expo-eas.md](expo-eas.md#development-builds).

## Configure the server URL

The server URL is entered in the app, on the **Connect** screen, and tested (`GET /api/v1/server`) before it is
saved. To pre-fill the field, set the public variable `EXPO_PUBLIC_DEFAULT_SERVER_URL` when starting Expo:

```bash
EXPO_PUBLIC_DEFAULT_SERVER_URL=https://ops.example.com npm start
```

It is only a default for the text field, never a secret. Rules applied to the URL (`src/lib/server-url.ts`):

- `https://` is required. `ops.example.com` is read as `https://ops.example.com`.
- A sub-path is kept (`https://example.com/ops`), a trailing slash is dropped.
- User names, passwords, query strings and fragments in the URL are refused, as are other schemes.
- Plain `http://` is accepted only for loopback and private-network hosts (`localhost`, `127.x`, `10.x`,
  `192.168.x`, `172.16–31.x`, `::1`, `*.local`), only in development builds (`__DEV__`), and only after ticking
  **Allow plain HTTP for a server on this network** on the Connect screen. Release builds never show that switch.

## Run

```bash
npm start          # Expo dev server. Press s (Expo Go ↔ dev build), a, i, w, or scan the QR code
npm run web        # web target, used for QA and demos only
npm run android    # expo run:android: compiles a local debug build and installs it on the emulator/device
npm run ios        # expo run:ios: compiles and runs on an iOS simulator (macOS only; never done yet)
```

`npm run android` and `npm run ios` are native builds, not shortcuts for Expo Go: they generate the `android/` and
`ios/` folders (both git-ignored) and need the platform toolchain. For everyday work, `npm start` plus Expo Go or an
installed development build is faster.

### Android emulator

Start the emulator from Android Studio's Device Manager (or `emulator -avd <name>`), check it is visible with
`adb devices`, then press `a`. On the emulator, **`10.0.2.2` is the host machine's `localhost`**: use
`http://10.0.2.2:4010` for the mock server, or forward the port so `localhost` works too:

```bash
adb reverse tcp:4010 tcp:4010
```

### iOS simulator (macOS)

Open a simulator once from Xcode (Xcode → Open Developer Tool → Simulator) or let `npm run ios` boot the default one.
`localhost` on the simulator is your Mac, so `http://localhost:4010` reaches a mock server on the same Mac. This path
has never been exercised: expect to be the first, and record what you find ([ios.md](ios.md)).

### Physical iPhone or Android phone

1. Put the phone and the computer on the same network.
2. Run `npm start` and scan the QR code (Camera app on iOS, Expo Go on Android), or open your development build.
3. To reach a server on your computer, use the computer's LAN address, for example `http://192.168.1.20:4010`,
   with the plain HTTP opt-in. Find it with `ip -4 addr` (Linux) or `ipconfig getifaddr en0` (macOS).

If the phone cannot reach the computer (guest Wi-Fi, client isolation, corporate network), tunnel the Metro bundler:

```bash
npx expo start --tunnel
```

The tunnel only carries the JavaScript bundle. The app still needs to reach the OpsWatch server itself, so a server
on your laptop must be reachable from the phone (same network, or a public HTTPS address).

## Demo mode

On the Connect screen, **Explore the demo** switches to the in-app demo client: realistic fixtures
(`src/demo/fixtures.ts`), a small simulated latency, no network, and a permanent **DEMO DATA** banner. Signing out of
the demo returns to the Connect screen.

The fixtures deliberately include data an operator would recognise as incomplete: an alert with no start time and no
service, a synthetic check that has never run, a deployment with no commit or repository, and a resource this server
collects no metric for. They are there so the "no data" states are seen, not assumed.

Settings → **Demo capabilities** (demo mode only) switches off what the demo server claims to offer — AI, logs,
incidents, synthetics, SLOs, deployments, repository, search, favorites, environments, brief — one by one, so you can
watch the app degrade exactly as it would against a real server that lacks them. It never affects a real server:
`GET /api/v1/server` stays the only source of truth there.

## Mock server

`dev/mock-server.ts` serves the same fixtures over the real HTTP contract, so the real HTTP client, sign-in, errors,
pagination and log-search polling are exercised.

```bash
npm run mock-server        # tsx dev/mock-server.ts, listening on http://127.0.0.1:4010
```

In another terminal:

```bash
npm run start:demo         # npm start with EXPO_PUBLIC_DEFAULT_SERVER_URL=http://localhost:4010
```

Then allow plain HTTP on the Connect screen and sign in with:

| Email | Password |
|-------|----------|
| `demo@opswatch.dev` | `opswatch-demo` |

These are public demo credentials, not secrets (the Login screen shows them as a hint in development builds when the
server URL is `localhost:4010`). Use `http://10.0.2.2:4010` on the Android emulator, or `adb reverse tcp:4010 tcp:4010`
and keep `http://localhost:4010`.

The mock server listens on `127.0.0.1` by default. Options (after `--`):

| Option | Effect |
|--------|--------|
| `--port 4011` | Another port (or `PORT=4011`) |
| `--host 0.0.0.0` | Listen on the LAN so a phone can use `http://<computer LAN IP>:4010`. Fictional data only, but never expose it beyond your machine or LAN |
| `--no-ai` | Report `features.ai = false`, to test the AI-disabled state |
| `--latency 400` | Add latency in milliseconds to every response |
| `--expire-after 20` | Answer 401 after that many authenticated calls, to test session expiry |

```bash
npm run mock-server -- --host 0.0.0.0 --no-ai --latency 400
```

The mock server always reports `features.push = false`: remote push exists nowhere yet ([notifications.md](notifications.md)).

## Against a local OpsWatch server

Once the OpsWatch server serves `/api/v1` ([api-contract.md](api-contract.md)), start it from the repository root as
described in the root [README](../../README.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md):

```bash
# From the repository root, with Docker
cp .env.example .env
# Put at least 32 random characters in OPSWATCH_SECRET, then:
docker compose up -d --build

# Or, for development without Docker (Node 22.12+):
npm ci
cp .env.example .env.local
# Set OPSWATCH_SECRET (32+ characters) and OPSWATCH_DATA_DIR (for example ./data) in .env.local
npm run dev
```

The server listens on `http://localhost:3000`. Create the admin account in a browser first. Then connect the app to:

| Where the app runs | Server URL |
|--------------------|-----------|
| iOS simulator | `http://localhost:3000` |
| Android emulator | `http://10.0.2.2:3000` (or `adb reverse tcp:3000 tcp:3000` and `http://localhost:3000`) |
| Phone on the same network | `http://<computer LAN IP>:3000` |

`docker-compose.yml` publishes the port on `127.0.0.1` only, so a phone cannot reach the Docker setup directly. Use
`npm run dev`, a reverse proxy with HTTPS, or a tunnel you control. Remember the root README's warning: until the
admin account exists, whoever opens OpsWatch first can create it.

## Everyday commands

Every script below exists in `apps/mobile/package.json`; there is no other mobile script.

| Command | What it does |
|---------|-------------|
| `npm start` | Expo dev server (development build by default; `s` switches to Expo Go) |
| `npm run start:demo` | The same, pre-filling the mock server URL |
| `npm run android` / `npm run ios` / `npm run web` | `expo run:android`, `expo run:ios`, `expo start --web` |
| `npm run mock-server` | The contract mock server |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` / `npm run test:ci` | Jest (jest-expo); `test:ci` adds `--ci --coverage` |
| `npm run check` | lint + typecheck + tests, the same gate CI runs |
| `npm run export:web` / `npm run e2e:web` | Web export, then the Playwright smoke tour of it |
| `npm run doctor` | `expo-doctor` |

More in [testing.md](testing.md). Problems: [troubleshooting.md](troubleshooting.md).
