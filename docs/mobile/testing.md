# Testing

All commands run from `apps/mobile`.

## Automated checks

| Command | What it runs |
|---------|-------------|
| `npm run lint` | ESLint (`eslint-config-expo`), zero warnings. Also forbids `fetch` outside `src/api/http.ts` and `console.log` |
| `npm run typecheck` | `tsc --noEmit`, TypeScript strict |
| `npm test` | Jest with the `jest-expo` preset |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:ci` | Jest `--ci --coverage` (report in `coverage/`) |
| `npm run check` | lint + typecheck + tests |
| `npm run doctor` | `expo-doctor`: dependency versions and config |

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
The automated version is `src/api/__tests__/http-client.integration.test.ts`. Manually:

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
npm run e2e:web                    # playwright test --config e2e/web/playwright.config.ts
```

`e2e/web/smoke.spec.ts` tours every major screen in demo mode on six profiles: small iPhone (375×667), iPhone
(393×852), large iPhone (430×932), Android phone (Pixel 7), tablet (820×1180) and dark mode. Each step asserts content
and saves a screenshot to `test-results/screens/<profile>/` for visual review (clipping, safe areas, dark mode).

### Device E2E (Maestro)

Flows live in `apps/mobile/e2e/maestro` (see its README): demo health → problem, a tour of the tabs, deep links,
acknowledging an alert, and sign-in / sign-out / sign-in against the mock server. Install the Maestro CLI (see
maestro.dev), start an emulator or simulator with a development or preview build installed, then:

```bash
maestro test -e APP_ID=com.example.opswatch e2e/maestro
```

### Contract parity

```bash
npx jest contract-parity                                               # skipped until packages/contract is on the branch
OPSWATCH_CONTRACT_DIR=/path/to/packages/contract npx jest contract-parity
```

## Manual testing

Run on at least one iOS and one Android target: simulator/emulator for layout, a physical phone for notifications,
deep links, the privacy cover, secure storage and real networks. Use the demo, the mock server, and a real server
once available ([development.md](development.md)).

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
- [ ] Logout: returns to Login, cache cleared, token removed (relaunch stays signed out)
- [ ] Server change ("Change server"): returns to Connect, previous server's data not visible
- [ ] Session expiry (401, for example `--expire-after` on the mock server): back to Login with an explanation
- [ ] Demo mode: DEMO DATA banner on every screen; sign out returns to Connect

### Screens

- [ ] Health (Home): status word + icon, counts, top problem, Investigate
- [ ] Morning Brief
- [ ] Problems: filters, pagination, detail, acknowledge (when allowed)
- [ ] Errors: list, detail, stack trace readable and copyable
- [ ] Services: list, detail, `null` metrics shown as "No data"
- [ ] Logs: search, polling, results, leaving the screen cancels the search
- [ ] Alerts: list, history, detail, acknowledge (when allowed)
- [ ] Incidents: list, detail
- [ ] Synthetics: list, detail
- [ ] Infrastructure, Deployments, SLOs, Investigations, Evidence
- [ ] AI enabled: Ask OpsWatch, contextual actions, answer labelled AI-generated, citations open the right screens
- [ ] AI disabled (`--no-ai`): no AI entry points, "Not available on this server" where relevant
- [ ] A feature flag set to `false` shows the unavailable state, not an error

### Notifications and links

- [ ] Notification permission prompt appears only when enabling notifications
- [ ] "Show a test notification" displays a notification; tapping it opens the target screen
- [ ] Tapping a notification while signed out opens the target after sign-in
- [ ] Lock screen (Android) hides notification content
- [ ] Deep link opens a problem, iOS simulator:
      `npx uri-scheme open opswatch://problems/prb-checkout-5xx --ios`
- [ ] Deep link opens a problem, Android:
      `adb shell am start -W -a android.intent.action.VIEW -d "opswatch://problems/prb-checkout-5xx"`
- [ ] Unknown or malformed link (`opswatch://admin/x`, an id with `/` or spaces) opens Home
- [ ] Deep link while signed out: sign in, then the target opens

### Robustness

- [ ] Offline (airplane mode): cached lists shown with the offline/stale banner and "Updated X ago"; detail screens show an offline error
- [ ] Back online: data refreshes without a manual action
- [ ] App switcher shows the privacy cover (when enabled in Settings)
- [ ] Rotation on tablets; no clipped content

### Appearance and accessibility

- [ ] Dark mode and light mode, system and manual
- [ ] French and English
- [ ] VoiceOver (iOS) and TalkBack (Android): every control has a label, status is announced as a word
- [ ] Dynamic Type (iOS) and font scale (Android) at the largest size: no truncated critical text
- [ ] Small screens (iPhone SE class): no overlapping or clipped content
- [ ] Large screens and tablets: layout uses the space, no stretched controls
