# Testing

All commands run from `apps/mobile`.

## The testing matrix

Everything that is tested, the command that tests it, and what that command actually proves. A category marked
**not automated** is a manual check; a category marked **never run** is honest about a gap rather than hiding it.
Dates and results for each are in [What has actually been verified](#what-has-actually-been-verified).

| Category | Command | What it validates |
|---|---|---|
| **Everything at once** | `npm run check` | Lint, typecheck and the full Jest suite. The gate CI runs, and the one to run before pushing |
| Unit | `npm test` | Pure logic: formatting, severity, deep-link parsing, URL validation, redaction, chart scales, notification filtering |
| Component | `npm test` | Screens rendered inside every real provider, asserting behaviour rather than markup |
| Navigation | `npm test` | The real `app/` routes driven through `expo-router/testing-library`, including deep links and guards |
| Integration (real HTTP) | `npm test` | The API client against `dev/mock-server.ts` over a real socket: auth, 401, filters, pagination, async log polling, acknowledge-then-forbidden |
| Contract parity | `OPSWATCH_CONTRACT_DIR=<path> npx jest parity` | That the local contract copy and the server team's `packages/contract` agree, schema by schema. Skips itself when the package is not reachable |
| Security | `npm test` | Fail-closed rules as tests: credential redaction, cross-origin refusal, server-supplied `action` validation, plain-HTTP refusal, cache scoping, notification default-deny |
| Mutation spot-checks | *(manual; see below)* | Whether those tests would actually catch the bug. Breaking a rule on purpose must break a test |
| Accessibility (automated) | `npm test` | Contrast for every colour pair in both palettes, touch targets, no line caps on the count tiles |
| Accessibility (device) | *not automated* | TalkBack/VoiceOver, and font scaling — `adb shell settings put system font_scale 1.5` |
| Large font | *not automated* | `adb shell settings put system font_scale 1.5` (and `2.0`), then walk the app. Restore with `1.0` |
| Android emulator QA | *not automated* | `npm run android`, or install a release APK. [android.md](android.md#setting-up-android-from-nothing) |
| iOS simulator QA | *not automated* | **Never run.** macOS only; [ios.md](ios.md#first-run-on-ios-checklist) is the checklist for whoever is first |
| Physical device QA | *not automated* | **Never run** on either platform: no device has been available |
| Offline / degraded | `npm test` (automated part) | Cold start with nothing answering, cached data labelled not-live, bounded cache, capability gating. The device half is manual: drop `adb reverse`, or switch the device to airplane mode |
| Deep links | `npm test`, plus a device check | `adb shell am start -a android.intent.action.VIEW -d "opswatch://errors/<id>"` |
| Web export smoke | `npm run export:web && npm run e2e:web` | The whole app toured at six device profiles in a browser, with screenshots |
| Device flows (Maestro) | `maestro test e2e/maestro/<flow>.yaml` | Scripted flows on a real emulator/device; needs the Maestro CLI |
| Release smoke | *not automated* | The checklist in [release.md](release.md) against a build that is actually going out |
| Docs and config drift | `npm test -- docs-match-project` | That every command, path, identifier and variable in `docs/mobile/` still exists in the project |

### One command

```bash
cd apps/mobile && npm run check
```

Lint, typecheck and every test. It is what CI runs on a pull request, and it is the only command you need before
pushing. It does **not** build native apps, run a browser or touch a device; those are the rows above.

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
- [x] Dynamic Type (iOS) and font scale (Android) at the largest size: no truncated critical text — done on Android at 1.5 and 2.0; not on iOS
- [ ] Small screens (iPhone SE class): no overlapping or clipped content
- [ ] Large screens and tablets: layout uses the space, no stretched controls

## Which documented commands have been run

The documentation is written from commands that were executed, not from commands that ought to work. This says which
is which, so nothing here reads as tested when it was not.

| Command | Status |
|---|---|
| `npm ci`, `npm start`, `npm run check`, `npm test`, `npm run lint`, `npm run typecheck` | **Run** |
| `npm run mock-server`, and the app driven against it over real HTTP from an emulator | **Run** |
| `npm run export:web`, `npm run e2e:web` | **Run** — 36/36 at six device profiles |
| `npm run doctor` (`expo-doctor`) | **Run** — 21/21 |
| `npx expo config --type public`, with and without identifiers set | **Run** — including that the `production` profile refuses placeholders |
| `sdkmanager`, `avdmanager`, `emulator`, `adb devices`, `adb reverse`, `adb logcat`, `adb install` | **Run** |
| `cd android && ./gradlew assembleRelease` / `assembleDebug` | **Run** — APK built and installed on an Android 15 emulator |
| `npx expo prebuild --platform android` | **Run** |
| `npx expo prebuild --platform ios --no-install` | **Run on Linux** — generates and can be read, but nothing about it can be built or executed here |
| `npm run ios`, `pod install`, `xcodebuild`, anything in the Simulator | **Not executable here.** Requires macOS. Written from the installed CLIs' own argument tables, and marked as untried in [ios.md](ios.md) |
| `eas build`, `eas submit`, `eas init`, `eas env:*` | **Not executable here.** Requires an Expo account, which does not exist. Flags verified against the installed `eas-cli`; nothing has been submitted anywhere |
| Anything touching the App Store, Google Play or a signing certificate | **Not executable here**, and deliberately not attempted |

`npm test -- docs-match-project` keeps the rest honest between runs: it fails when a documented npm script, file path,
EAS profile, bundle identifier or environment variable stops matching the project.

## What has actually been verified

Recorded so it is clear what is tested and what is not. Dates are when the check last ran.

| Check | Result | Date |
|-------|--------|------|
| `npm run lint`, `npm run typecheck` | Clean | 2026-09-20 |
| Jest: unit, component, navigation, integration | **1187 tests passing in 56 suites**, plus the 66-test contract parity suite skipped (57 suites, 1253 tests reported) | 2026-09-20 |
| API client against the contract mock server over real HTTP | 12 tests: auth, 401 without a token, validation, filters, pagination, async log polling and release, acknowledge then forbidden, AI, not-found, unsupported, favorites, logout | 2026-09-20 |
| Demo fixtures against the contract, after a JSON round trip | Passing; caught and fixed a reference cycle that would have broken any real JSON response | 2026-09-20 |
| Contract parity with the server team's `packages/contract` | **66/66** against `feature/opswatch-intelligence` at `3881b23`, run with `OPSWATCH_CONTRACT_DIR`, covering the ten additive fields they landed in `089808a`. No differences remain | 2026-09-20 |
| Web export tour at six device profiles (small/regular/large iPhone, Android phone, tablet, dark mode) | 36/36; screenshots in `test-results/screens/` | 2026-09-20 |
| WCAG AA contrast for every colour pair the components use | 20 pairs in each of the two palettes, 40 checks, all ≥ 4.5:1 | 2026-09-20 |
| `expo-doctor` | 21/21 checks passed | 2026-09-20 |
| **Native Android release build** (`npx expo prebuild --platform android` + `./gradlew assembleRelease`) | Builds; 48 MB APK | 2026-09-20 |
| **Font scaling on Android** at `font_scale 1.5` and `2.0` | Home, the count tiles and the error detail all wrap without clipping at both. Found and fixed one truncation: the third count tile read "of 18 healthy se…" at 1.5. At 2.0 the **tab bar labels** truncate ("Proble…", "Servic…") — accepted, see below | 2026-09-20 |
| **Third adversarial pass** over the surface added since the second | Three findings, all fixed: screenshot mode could reach a production build and freeze a monitoring app's clock; System status rendered unbounded server strings into accessibility labels a screen reader would read out in full; and a check that could not run was described with a sentence whose placeholders nothing filled, so `{version}` reached a device | 2026-09-23 |
| **Mutation spot-check** on fourteen rules the app's safety rests on | 10 of 14 killed on the first run. Four **survived** and now have tests: the 2 MB cache ceiling, redacting a bearer token, validating a server-supplied `action` before showing it, and showing nothing until the stored notification preferences are known | 2026-09-22 |
| **Every redaction rule in the logger, mutated one at a time** | 3 of 9 survived: the `Authorization:` rule and the bare-`Bearer` rule only ever covered each other, and `github_pat_` had no case at all. Each rule now has a case only it can catch; **9 of 9** killed | 2026-09-22 |
| Minimum touch targets | Every `Pressable` declares a role; rows use `TOUCH_TARGET` (48); the three inline controls that cannot be 48 tall reach it through hit slop, asserted by a test | 2026-09-20 |
| **Landscape and tablet geometry** on the emulator (2400x1080, and 1600x2560 at 280 dpi) | Content stays inside the readable column instead of stretching, tabs lay out horizontally, nothing clipped, no crash. Found one copy bug: a freshness line read "0 min ago" | 2026-09-20 |
| **Native Android run** on an Android 15 emulator (Pixel 7, x86_64) | Demo mode, Home, tabs, scrolling, dark mode, the offline banner, `opswatch://` deep links into a problem, into an error and an unknown link falling back to Home, a deep link while signed out (stays on Connect, nothing leaks), tablet geometry and landscape. No crash, no red box, no fatal exception in logcat. Cold start measured at **697–722 ms** | 2026-09-20 |
| Android release manifest | The permissions actually present are listed in [privacy.md](privacy.md#android-permissions-actually-in-the-release-build); `SYSTEM_ALERT_WINDOW` is blocked and absent | 2026-09-20 |
| **iOS project generation** (`npx expo prebuild --platform ios --no-install`) | Generated and read statically: no Face ID usage string, OpsWatch's own local-network wording, `opswatch` URL scheme, ATS with arbitrary loads off, `ITSAppUsesNonExemptEncryption = false`, iPhone and iPad orientations | 2026-09-20 |
| **iOS run** | **Never done.** No macOS machine has been available at any point. The JavaScript, layout and navigation are shared and covered by the tests and the web profiles, but no iOS simulator, no iOS device and no EAS iOS build has ever run this app. The first person with a Mac should follow [ios.md](ios.md#first-run-on-ios-checklist) | — |
| Physical devices (iOS or Android), push notifications end to end, Google sign-in | **Not run**: needs devices, an EAS project, APNs/FCM credentials, and a server that implements them | — |

Bugs this QA found and fixed: a monospace font that fell back to serif off iOS, a truncated "15 of 18 healthy
services" tile on small phones, a cramped hypothesis title, a demo banner that hid the Android status bar, a freshness
line that read "0 min ago" for fifteen seconds of every minute, and an empty status-bar-height strip between that banner and every pushed screen's header (see
[architecture.md](architecture.md#chrome-above-the-navigator) for why the native header could not be told to drop its
top inset).

Accepted at the largest font scale: the tab bar labels truncate at `font_scale 2.0`. The tabs expose only
`tabBarAllowFontScaling`, an on/off switch, and turning scaling off would freeze those labels at 11 pt for exactly the
people who set the scale to 200 %. No information is lost — each tab keeps its icon and its selected state, and a
screen reader is given the untruncated name — so the labels are left to scale and clip like the platform's own.

Two things about how this QA is run, both of which had already produced a wrong conclusion once:

- The scripts tap **by label**, not by coordinate (`dev/device/tap.sh`). A coordinate goes stale the moment a screen
  gains a paragraph, and the run then continues against the wrong screen.
- Confirm the APK under test is the one just built. `assembleRelease` can leave the JavaScript bundle untouched, and a
  failing `JAVA_HOME` inside a pipeline is invisible to `$?`. Check the bundle's timestamp, or grep it for a string
  only the new code contains.
