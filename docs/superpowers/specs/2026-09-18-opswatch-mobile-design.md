# OpsWatch Mobile — Design

- **Status:** approved for implementation (autonomous mission, peer-reviewed)
- **Date:** 2026-09-18
- **Branch:** `feature/mobile` (worktree `OpsWatch-mobile`)
- **License:** MIT, same repository `NethanelFitoussi/OpsWatch`

## 1. Context and findings

OpsWatch is a self-hosted Next.js 16 application (branch `feat/step-1-foundations` at the time of
writing; `main` holds only docs). It reads AWS live (ECS, RDS/Aurora, ALB, CloudWatch alarms,
CloudWatch Logs Insights) and computes insights with hysteresis. It stores no metric history and has
no alerting, incidents, synthetics, SLOs, error tracking, AI or push.

What the server exposes today, as inspected:

| Area | Today | Mobile relevance |
|------|-------|------------------|
| Auth | One admin, argon2id password, 12 h rolling session, token in an HttpOnly cookie, login and logout through Server Actions, optional Google OIDC restricted to the admin | Server Actions are not a stable API and a native app sends no `Origin`: mobile needs a bearer-token endpoint. The `sessions` table already issues opaque tokens (`createSession` returns one), so a bearer path reuses it unchanged. |
| JSON API | `POST/GET/DELETE /api/connections/:id/regions/:region/logs/query[/:queryId]`, connection test and template routes. Errors are `{ error: <snake_case code> }`. | Only Logs is reachable, and only with a same-origin cookie. |
| Domain | `Insight {severity: critical|warning|info, kind, resource, messageKey, values, href, members}`, `FamilySummary {insights,total,affected}` for `ecs|rds|alb|alarms`, `AlarmSummary`, `EcsService` (with deployments and events), `RdsInstance`, `LoadBalancer`, `TargetGroup`, `LogsQueryResults`. Failures are `{reason: denied|throttled|error, code, action}`. | These are the real facts the mobile contract is built on. |
| Scope | Connection (AWS account) × region | Maps to a mobile **environment**. |
| i18n | English and French (next-intl) | Mobile ships EN + FR too. |

Consequence: the mobile app cannot be a pure client of an existing API. It is built against a
**versioned mobile contract** that the server implements incrementally, with **capability discovery** so
the app never shows a feature the server does not have, and never fakes missing data as zero.

## 2. Goals and non-goals

Goals: answer in seconds *Is everything healthy? What is broken? Why? How serious? What changed? Do I
need to act?* on iOS and Android, against any self-hosted OpsWatch server, safely.

Non-goals: a separate backend; direct AWS/GitHub/Cloudflare/AI access from the device; storing any
provider credential on the device; destructive actions; administration of integrations (stays on web);
publishing to the stores.

## 3. Placement and repository shape

```
apps/mobile/          Expo app, standalone npm project (own package.json and lockfile)
  app/                expo-router routes (file-based, gives deep linking for free)
  src/api/            contract (zod), http transport, clients (http, demo), query hooks
  src/features/       per-domain screens' building blocks (health, problems, errors, ...)
  src/ui/             design system: theme, primitives, charts, code/log viewers
  src/lib/            pure helpers: time formatting, deep links, notifications, redaction
  src/state/          session, settings, environment providers
  src/i18n/           en, fr catalogues
  src/demo/           fixtures used by the demo client and the mock server
  dev/mock-server.ts  contract mock server for contributors and integration tests
  e2e/                Maestro flows (devices) and Playwright smoke (web export)
docs/mobile/          user and contributor documentation
.github/workflows/mobile.yml   path-filtered CI (apps/mobile/**, docs/mobile/**)
```

No root `package.json` change and no workspace migration: the root belongs to the web app on another
branch. The contract lives in `apps/mobile/src/api/contract/` and is written so it can be extracted to
`packages/api-contract` once the server adopts it (zod 4, no React Native imports).

Merge note, recorded in `docs/mobile/merge-notes.md`: the web `tsconfig.json` includes `**/*.ts` and
ESLint lints `.`, so the web branch must exclude `apps/` (one line each) when both branches meet;
`.dockerignore` should exclude `apps/mobile`.

## 4. Technology

Expo SDK 57 (latest stable), React Native New Architecture, TypeScript strict, expo-router.
TanStack Query v5 for server state with a persister restricted to safe queries. zod 4 validates every
response at the boundary (contract drift becomes a clear `invalid_response` error, not a crash).
expo-secure-store (token), expo-notifications, expo-web-browser (OAuth), expo-clipboard,
expo-localization, @react-native-community/netinfo, react-native-svg (hand-written light charts),
AsyncStorage (non-sensitive preferences and the query cache). No Redux, no chart library, no UI kit.
Testing: jest-expo, React Native Testing Library, expo-router testing utilities, Maestro flows, and a
Playwright smoke run on the web export (the web target exists for QA and demos only).

## 5. The mobile contract (`/api/mobile/v1`)

JSON, camelCase, epoch milliseconds for times, cursor pagination `{ items, nextCursor }`.
Errors keep the server's shape `{ error: code, message? }`. Every data call takes `env` (environment id).

Capability discovery, unauthenticated: `GET /api/mobile/v1/server` →
`{ product: "opswatch", version, apiVersion: 1, name?, auth: { password, google }, features: { health,
brief, problems, errors, services, infrastructure, logs, alerts, incidents, synthetics, slos,
deployments, investigations, repository, ai, search, favorites, environments, push } }`.
A feature flag set to `false` produces an explicit "Not available on this server" state.

Endpoints (all authenticated with `Authorization: Bearer <token>` except `server` and `auth/*`):

| Method and path | Purpose |
|-----------------|---------|
| `POST auth/login` `{email,password}` → `{token, expiresAt, user}` | Password sign-in, same throttle as web |
| `GET auth/google/start?redirectUri&codeChallenge` → 302 to Google; server finally redirects to `redirectUri?code=` | Google sign-in for the admin |
| `POST auth/google/exchange` `{code, codeVerifier}` → `{token, expiresAt, user}` | One-time code, PKCE-bound |
| `POST auth/logout`, `GET me` | Revoke session, whoami |
| `GET environments` | Connections × regions as environments with `kind` |
| `GET health`, `GET brief` | Home and Morning Brief, computed server-side |
| `GET problems?status&severity&service&category&since&cursor`, `GET problems/:id`, `POST problems/:id/acknowledge` | Problems (today: insights) |
| `GET errors?status&service&cursor`, `GET errors/:id` | Error groups with stack traces |
| `GET services`, `GET services/:id` | Services with nullable metrics |
| `GET infrastructure?category`, `GET infrastructure/:id` | Resources by category |
| `POST logs/search` → `{searchId,status,items,nextCursor}`, `GET logs/search/:id?cursor` | Wraps Logs Insights' async start/poll |
| `GET alerts?status&cursor`, `GET alerts/:id`, `POST alerts/:id/acknowledge` | Alerts (today: CloudWatch alarms) |
| `GET incidents`, `GET incidents/:id` | Incidents |
| `GET synthetics`, `GET synthetics/:id` | Checks, SSL |
| `GET slos`, `GET slos/:id` | SLOs |
| `GET deployments`, `GET deployments/:id` | Deployments (today: ECS deployments) |
| `GET investigations/:id` | Chronological evidence |
| `GET repository/evidence/:id` | Commit, file, lines, diff |
| `POST ai/ask` `{question, context?: {type,id}}` | Ask OpsWatch; references, never raw payloads |
| `GET search?q` | Global search |
| `GET me/favorites`, `PUT me/favorites` | Server-side favorites |
| `POST me/devices`, `DELETE me/devices/:id` | Push registration and preferences |

Every object carries `allowedActions: string[]`; the app only renders an action the server lists.
Nullable metrics are `null`, never `0`. Partial data is explicit: `health.families[].unavailable =
{reason, code}` mirrors the server's `MonitoringFailure`.

Status vocabulary follows the server: severity `critical | warning | info`. Notification preferences
are therefore *Critical only / Critical + Warning / All*.

## 6. Client architecture

- `src/api/http.ts`: one `request()` for every call: base URL, bearer token, `AbortController`
  timeout (15 s, 60 s for AI), retries with jittered backoff for idempotent requests on network
  errors, 429, 502–504 (max 2), JSON parse, zod validation, normalisation into `ApiError { kind:
  network | timeout | unauthorized | forbidden | not_found | rate_limited | server | invalid_response |
  unsupported | validation, status?, code? }`. It never logs headers or bodies.
- `OpsWatchClient` interface with two implementations: `HttpClient` and `DemoClient` (fixtures, small
  simulated latency). Screens never call `fetch`; they use hooks from `src/api/queries.ts`.
- A 401 from any authenticated call clears the session and routes to sign-in, remembering the target.

## 7. State, storage and offline

| Data | Where | Why |
|------|-------|-----|
| Session token | SecureStore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, key scoped by server | OS keychain/keystore |
| Server URL, demo flag, theme, notification prefs, env id, recent searches, local favorites | AsyncStorage | Not sensitive |
| Query cache | AsyncStorage persister, only `health`, `brief`, `problems` list, `services` list, `incidents` list, `environments`; max age 24 h; buster = server + user | Read-only glanceable data; no logs, stack traces, AI answers or evidence |

Cache is wiped on logout, server change and session expiry. Every data screen shows *Updated X ago*;
when offline or when a refetch failed while showing cached data, a banner says so and data is visually
marked stale. Never presented as live.

## 8. Navigation

expo-router. Unauthenticated stack: `connect` (server URL, test, demo), `login`. Authenticated: tabs
**Home, Problems, Alerts, Services, More**; More lists Errors, Logs, Incidents, Synthetics, SLOs,
Deployments, Infrastructure, Ask OpsWatch, Search, Settings. Detail routes: `/problems/[id]`,
`/errors/[id]`, `/services/[id]`, `/alerts/[id]`, `/incidents/[id]`, `/synthetics/[id]`, `/slos/[id]`,
`/deployments/[id]`, `/infrastructure/[id]`, `/investigations/[id]`, `/evidence/[id]`, `/logs/[id]`.

Deep links: scheme `opswatch://` plus universal/app links placeholders. Only allow-listed patterns with
ids matching `^[A-Za-z0-9._:~-]{1,200}$` are accepted. Unauthenticated users are sent to sign-in and the
destination is restored afterwards (in memory only).

## 9. Screens

Home answers "Is production healthy?": environment badge (production is visually distinct), status
hero with icon + word (never colour alone), critical/warning/healthy counts, *Most important problem*
with **Investigate**, *Since yesterday* changes (Morning Brief), synthetics strip, active alerts,
recent incidents and deployments. Each list screen: filters as chips, virtualised `FlatList`, pull to
refresh, infinite scroll where paginated. Detail screens lead with severity, status, duration and the
next action. Investigations separate **Observed facts**, **Correlations**, **Hypotheses**. Deployment
correlation is phrased factually ("Problem started 8 min after this deployment"), never causally.

## 10. Notifications

expo-notifications with categories `critical_problem`, `alert`, `synthetic_failure`, `incident`,
`recovery`. Payload `data` contains only `{type, id, env?}`; the app builds the route itself through
the deep-link allow-list. Preferences (minimum severity, categories) are sent to the server with the
device registration. Tapping a notification while signed out goes through the same restore path.
Remote push needs FCM/APNs credentials and an EAS project id: documented, not faked.

## 11. AI

Shown only when `features.ai` is true. Ask OpsWatch screen with suggested questions; contextual
actions (Problem → Ask, Error → Explain, Service → Analyze, Deployment → Analyze changes, Incident →
Summarize, Evidence → Explain code) send `{type, id}` references. Answers are labelled as AI-generated
and list their citations as links into the app. No provider keys ever on the device.

## 12. Security

HTTPS required; plain HTTP accepted only for `localhost`, `127.0.0.1`, `10.0.2.2` and private LAN
ranges, only in development builds, behind an explicit acknowledgement. No TLS bypass exists in the
code. Redacting logger (tokens, passwords, `Authorization`, AWS/GitHub/Cloudflare key patterns).
Optional privacy cover when the app goes to the background. Copy is user-initiated only. OAuth uses
PKCE and a one-time code; the redirect URI is the app scheme. Push payloads carry references only.

## 13. Demo mode and mock server

"Explore the demo" on the connect screen uses `DemoClient` with realistic fixtures and a permanent
**DEMO DATA** banner. `dev/mock-server.ts` serves the same fixtures over the real contract (login
`demo@opswatch.dev` / `opswatch-demo`) so contributors and integration tests exercise the HTTP client.

## 14. Testing

Unit (http, errors, validation, redaction, URL validation, deep links, notification routing, time
formatting, chart maths), component (status badge, stale banner, stack trace viewer, log viewer,
filters, feature gate), navigation and auth gate (expo-router testing), API client against the mock
server, Playwright smoke on the web export at small/large phone and tablet viewports, Maestro flows for
emulators and devices.

## 15. Risks

- Server contract not implemented yet: mitigated by capability discovery, demo client, mock server and
  `docs/mobile/server-integration.md` mapping every endpoint to existing server functions.
- Web branch toolchains picking up `apps/mobile`: documented one-line excludes.
- No macOS here: iOS is verified through shared code, web export and tests; native iOS runs are
  documented for maintainers with a Mac.
