# Testing

All commands run from `apps/mobile`.

## Automated checks

| Command | What it runs |
|---------|-------------|
| `npm run lint` | ESLint (`eslint-config-expo`), zero warnings. Also forbids `fetch` outside `src/api/http.ts` and `console.log` |
| `npm run typecheck` | `tsc --noEmit`, TypeScript strict (plus `noUncheckedIndexedAccess`) |
| `npm test` | Jest with the `jest-expo` preset |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:ci` | Jest `--ci --coverage` (report in `coverage/`) |
| `npm run check` | lint + typecheck + tests — the same gate CI runs |
| `npm run doctor` | `expo-doctor`: 21 checks of dependency versions and config |
| `npm run export:web` | `expo export --platform web --output-dir dist-web` |
| `npm run e2e:web` | `playwright test --config e2e/web/playwright.config.ts` |

There is no npm script for Maestro; it is run with the `maestro` CLI, see below.

### Continuous integration

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `.github/workflows/mobile.yml` | Push to `main` and pull requests touching `apps/mobile/**`, `docs/mobile/**` or the workflow | `npm ci`, lint, typecheck, `test:ci`, `npx expo config --type public`; then a second job that exports the web build and runs the Playwright tour, uploading the report on failure |
| `.github/workflows/mobile-release.yml` | Manual (`workflow_dispatch`), with platform (`all`/`ios`/`android`) and profile (`preview`/`production`) inputs | `npm run check`, then `eas build … --non-interactive --no-wait`. It never submits to a store. Needs the `EXPO_TOKEN` secret and an initialised EAS project |

### Unit and component tests

Tests sit next to the code in `__tests__` folders. Render components inside every app provider with
`renderWithProviders` from `src/test/render.tsx` (demo client, in-memory settings, light theme, a 390×844 safe area).

### Navigation tests

Route-level tests use `renderRouter` from `expo-router/testing-library` against the real `app/` folder:

```tsx
import { renderRouter, screen } from 'expo-router/testing-library';
import { seedDemoSession } from '../render';

it('opens Home on the demo server', async () => {
  await seedDemoSession();               // signed-in demo session in AsyncStorage
  renderRouter('./app', { initialUrl: '/' });
  expect(await screen.findByTestId('status-title')).toBeTruthy();
});
```

See `src/test/__tests__/app-routes.test.tsx`. Clear AsyncStorage in `beforeEach` so tests do not share sessions.

### Integration tests against the mock server

`dev/mock-server.ts` exports `createMockServer()`, so tests can start the contract mock on a free port and point
`createHttpClient` at it: real HTTP, bearer auth, pagination, log search polling, 401 expiry (`expireAfter`).
The automated version is `src/api/__tests__/http-client.integration.test.ts` (12 tests). Manually:

```bash
npm run mock-server
# other terminal
npm run start:demo
```

### Web export smoke (Playwright)

The web target exists for QA and demos only.

```bash
npm run export:web                 # expo export --platform web --output-dir dist-web
npx playwright install chromium    # once
npm run e2e:web                    # serves dist-web on 127.0.0.1:4020 and runs the tour
```

`e2e/web/smoke.spec.ts` tours every major screen in demo mode on six profiles: small iPhone (iPhone SE), iPhone
(393×852), large iPhone (430×932), Android phone (Pixel 7), tablet (820×1180) and dark mode — 6 specs × 6 profiles =
36 runs. Each step asserts content and saves a screenshot to `test-results/screens/<profile>/` for visual review
(clipping, safe areas, dark mode).

### Device E2E (Maestro)

Flows live in `apps/mobile/e2e/maestro` (see its README): `demo-health-to-problem`, `demo-tabs-tour`,
`demo-deep-link`, `demo-acknowledge-alert` (no server needed) and `login-mock-server` (sign in, sign out, sign in
again). Install the Maestro CLI, start an emulator or simulator with a development or preview build installed, then:

```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash      # once
maestro test -e APP_ID=com.example.opswatch e2e/maestro

# the mock-server flow also needs the server and its URL (10.0.2.2 from the Android emulator)
npm run mock-server
maestro test -e APP_ID=com.example.opswatch -e SERVER_URL=http://10.0.2.2:4010 e2e/maestro/login-mock-server.yaml
```

`APP_ID` is the bundle id / package of the build under test — `com.example.opswatch` until the placeholders are
replaced ([app-identity.md](app-identity.md)).

### Contract parity

```bash
npx jest contract-parity                                               # skipped until packages/contract is on the branch
OPSWATCH_CONTRACT_DIR=/path/to/packages/contract npx jest contract-parity
```

The 65 tests of this suite are reported as skipped on this branch. That is expected
([api-contract.md](api-contract.md#parity-with-packagescontract)).

## Manual testing

Run on at least one iOS and one Android target: simulator/emulator for layout, a physical phone for notifications,
deep links, the privacy cover, secure storage and real networks. Use the demo, the mock server, and a real server
once available ([development.md](development.md)).

Demo mode makes two things testable without a server: the **demo capability switches** (Settings → Demo capabilities)
for every unavailable state, and fixtures that are deliberately incomplete — an alert with no start time and no
service, a check that has never run, a deployment with no commit, a resource with no metrics.

Representative screen sizes:

| Class | Examples |
|-------|----------|
| Small phone | iPhone SE (3rd gen, 4.7"), small Android at 360×640 dp |
| Standard phone | iPhone 16 / 17, Pixel 8/9 |
| Large phone | iPhone Pro Max class, Pixel Pro class |
| Tablet | iPad (11" and 13"), Android 10–11" tablet, portrait and landscape |
| Accessibility | Largest Dynamic Type / Android font scale 200 % on a small phone |

## Release checklist

Copy this list into the release issue and tick it on the release binaries ([release.md](release.md)).

### Account and server

- [ ] Connect to an HTTPS server: URL test succeeds, server name and capabilities shown
- [ ] Plain `http://` to a public host is refused; the plain HTTP switch is absent in release builds
- [ ] Wrong URL / non-OpsWatch site shows "The server's answer wasn't understood", not a crash
- [ ] Login with email and password; wrong password shows a clear error
- [ ] Google sign-in (when `auth.google` is true) completes and returns to the app
- [ ] Logout: returns to Login immediately (even with the network hanging), cache cleared, token removed, relaunch
      stays signed out, recent searches and local favorites gone
- [ ] Server change ("Change server"): returns to Connect, previous server's data not visible
- [ ] Session expiry (401, for example `--expire-after` on the mock server): back to Login with an explanation
- [ ] Demo mode: DEMO DATA banner on every screen, clear of the status bar; sign out returns to Connect

### Screens

- [ ] Health (Home): status word + icon, counts, top problem, Investigate
- [ ] Morning Brief
- [ ] Problems: filters, pagination, detail, acknowledge (when allowed)
- [ ] Errors: list, detail, stack trace readable and copyable
- [ ] Services: list, detail, `null` metrics shown as "No data"
- [ ] Logs: search, polling, results, leaving the screen cancels the search
- [ ] Alerts: list, history, detail, acknowledge (when allowed); acknowledging is confirmed by a haptic tap
- [ ] Incidents: list, detail
- [ ] Synthetics: list, detail, including a check that has never run
- [ ] Infrastructure, Deployments, SLOs, Investigations, Evidence
- [ ] AI enabled: Ask OpsWatch, contextual actions, answer labelled AI-generated, citations open the right screens,
      an answer can be abandoned
- [ ] AI disabled (`--no-ai`, or the demo switch): no AI entry points, "Not available on this server" where relevant
- [ ] A feature flag set to `false` shows the unavailable state, not an error
- [ ] A server whose capabilities could not be read shows the "unknown" state with a working Retry

### Notifications and links

- [ ] Notification permission prompt appears only when enabling notifications
- [ ] "Show a test notification" displays a notification; tapping it opens the target screen
- [ ] The same notification delivered twice opens one screen and shows one banner
- [ ] A notification carrying `env` selects that environment before opening the object
- [ ] Switching notifications off stops foreground banners and unregisters the device server-side
- [ ] Tapping a notification while signed out opens the target after sign-in
- [ ] Lock screen (Android) hides notification content
- [ ] Deep link opens a problem, iOS simulator:
      `npx uri-scheme open opswatch://problems/prb-checkout-5xx --ios`
- [ ] Deep link opens a problem, Android:
      `adb shell am start -W -a android.intent.action.VIEW -d "opswatch://problems/prb-checkout-5xx"`
- [ ] Unknown or malformed link (`opswatch://admin/x`, an id with `/` or spaces, `opswatch://problems/..`) opens Home
- [ ] Deep link while signed out: sign in, then the target opens

### Robustness

- [ ] Offline (airplane mode): cached lists shown with the offline/stale banner and "Updated X ago"; detail screens show an offline error
- [ ] Back online: data refreshes without a manual action
- [ ] Cold start while offline still shows the cached lists (the cache survives a restart)
- [ ] App switcher shows the privacy cover (when enabled in Settings)
- [ ] Rotation on tablets; no clipped content

### Appearance and accessibility

- [ ] Dark mode and light mode, system and manual; no white flash behind the app in dark mode
- [ ] French and English
- [ ] VoiceOver (iOS) and TalkBack (Android): every control has a label, status is announced as a word
- [ ] Dynamic Type (iOS) and font scale (Android) at the largest size: no truncated critical text
- [ ] Small screens (iPhone SE class): no overlapping or clipped content
- [ ] Large screens and tablets: layout uses the space, no stretched controls

## What has actually been verified

Recorded so it is clear what is tested and what is not. Dates are when the check last ran.

| Check | Result | Date |
|-------|--------|------|
| `npm run lint`, `npm run typecheck` | Clean | 2026-09-20 |
| Jest: unit, component, navigation, integration | **1167 tests passing in 53 suites**, plus the 66-test contract parity suite skipped (54 suites, 1233 tests reported) | 2026-09-20 |
| API client against the contract mock server over real HTTP | 12 tests: auth, 401 without a token, validation, filters, pagination, async log polling and release, acknowledge then forbidden, AI, not-found, unsupported, favorites, logout | 2026-09-20 |
| Demo fixtures against the contract, after a JSON round trip | Passing; caught and fixed a reference cycle that would have broken any real JSON response | 2026-09-20 |
| Contract parity with the server team's `packages/contract` | 65/65 against their work in progress, run with `OPSWATCH_CONTRACT_DIR`; only difference was the additive `serverInfo.demo`, since adopted | 2026-09-20 |
| Web export tour at six device profiles (small/regular/large iPhone, Android phone, tablet, dark mode) | 36/36; screenshots in `test-results/screens/` | 2026-09-20 |
| WCAG AA contrast for every colour pair the components use | 20 pairs in each of the two palettes, 40 checks, all ≥ 4.5:1 | 2026-09-20 |
| `expo-doctor` | 21/21 checks passed | 2026-09-20 |
| **Native Android release build** (`npx expo prebuild --platform android` + `./gradlew assembleRelease`) | Builds; 48 MB APK | 2026-09-20 |
| **Native Android run** on an Android 15 emulator (Pixel 7, x86_64) | Demo mode, Home, tabs, scrolling, dark mode, the offline banner, `opswatch://` deep links into a problem, into an error and an unknown link falling back to Home, a deep link while signed out (stays on Connect, nothing leaks), tablet geometry and landscape. No crash, no red box, no fatal exception in logcat. Cold start measured at **697–722 ms** | 2026-09-20 |
| Android release manifest | The permissions actually present are listed in [privacy.md](privacy.md#android-permissions-actually-in-the-release-build); `SYSTEM_ALERT_WINDOW` is blocked and absent | 2026-09-20 |
| **iOS project generation** (`npx expo prebuild --platform ios --no-install`) | Generated and read statically: no Face ID usage string, OpsWatch's own local-network wording, `opswatch` URL scheme, ATS with arbitrary loads off, `ITSAppUsesNonExemptEncryption = false`, iPhone and iPad orientations | 2026-09-20 |
| **iOS run** | **Never done.** No macOS machine has been available at any point. The JavaScript, layout and navigation are shared and covered by the tests and the web profiles, but no iOS simulator, no iOS device and no EAS iOS build has ever run this app. The first person with a Mac should follow [ios.md](ios.md#first-run-on-ios-checklist) | — |
| Physical devices (iOS or Android), push notifications end to end, Google sign-in | **Not run**: needs devices, an EAS project, APNs/FCM credentials, and a server that implements them | — |

Bugs this QA found and fixed: a monospace font that fell back to serif off iOS, a truncated "15 of 18 healthy
services" tile on small phones, a cramped hypothesis title, a demo banner that hid the Android status bar, and an
empty status-bar-height strip between that banner and every pushed screen's header (see
[architecture.md](architecture.md#chrome-above-the-navigator) for why the native header could not be told to drop its
top inset).

Two things about how this QA is run, both of which had already produced a wrong conclusion once:

- The scripts tap **by label**, not by coordinate (`dev/device/tap.sh`). A coordinate goes stale the moment a screen
  gains a paragraph, and the run then continues against the wrong screen.
- Confirm the APK under test is the one just built. `assembleRelease` can leave the JavaScript bundle untouched, and a
  failing `JAVA_HOME` inside a pipeline is invisible to `$?`. Check the bundle's timestamp, or grep it for a string
  only the new code contains.
