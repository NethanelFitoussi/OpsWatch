# API contract (`/api/v1`) as used by mobile

The mobile app and the web app share one versioned API under `/api/v1`. The schemas are written with zod 4.

> **Temporary local copy.** Mobile currently uses `apps/mobile/src/api/contract.ts`. The canonical contract moves to
> `packages/contract`, owned jointly with the server side. Once that package lands on this branch, the local file is
> deleted and imports point at the package ([merge-notes.md](merge-notes.md)). Never evolve the local copy on its own.

## Conventions

| Rule | Detail |
|------|--------|
| Format | JSON, camelCase |
| Times | Epoch milliseconds |
| Auth | `Authorization: Bearer <token>` on every call except `server` and `auth/*` (the Google start URL is opened in a browser). No cookies |
| Language | `Accept-Language` with the app's locale |
| Scope | Data calls take `env` (environment id) as a query parameter; absent means the server's default environment |
| Lists | Paginated lists are `{ items, nextCursor }` (`nextCursor` null at the end); unpaginated lists are `{ items }` |
| Missing data | A metric the server cannot measure is `null`, never `0`. A family the server could not read has `unavailable: { reason, code? }` |
| Actions | Actionable objects list `allowedActions: string[]`; the app only renders an action the server lists |
| Vocabulary | Severity `critical | warning | info`; health status `healthy | degraded | critical | unknown` |
| Forward compatibility | Unknown keys are ignored; unknown enum values fall back to a neutral value (`info`, `unknown`, `custom`, `none`) |
| Errors | Non-2xx bodies are `{ error: <snake_case code>, message?, action?, code? }`. `action` names a missing provider permission (for example `logs:StartQuery`) |
| Unsupported | `501` means the capability is not implemented and is shown as unavailable |
| References | Objects point to each other with `{ type, id, label? }`; ids are 1–200 characters |

## Endpoints

All paths are relative to `/api/v1`. Source: `apps/mobile/src/api/client.ts`.

### Server and authentication

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/server` | Capability discovery (unauthenticated): product, version, `apiVersion`, optional name, `auth.{password,google}`, `features` |
| POST | `/auth/login` | `{ email, password }` → `{ token, expiresAt, user }` |
| GET | `/auth/google/start?redirectUri&codeChallenge&codeChallengeMethod=S256&state` | Opened in the system browser; the server finally redirects to `redirectUri?code=…&state=…` |
| POST | `/auth/google/exchange` | `{ code, codeVerifier, redirectUri }` → `{ token, expiresAt, user }` (one-time, PKCE-bound code) |
| POST | `/auth/logout` | Revokes the current session |
| GET | `/me` | Current user `{ email, name? }` |

### Data

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/environments` | Environments (connection × region) with `kind`: `production`, `staging`, `development`, `custom` |
| GET | `/health` | Home: status, counts, families, top problem, alerts, synthetics, recent incidents and deployments, changes |
| GET | `/brief` | Morning Brief: period, status, counts, changes, most important problem |
| GET | `/problems?status&severity&service&category&since&cursor` | Problems (paginated; `severity` may repeat) |
| GET | `/problems/:id` | Problem detail |
| POST | `/problems/:id/acknowledge` | Acknowledge a problem |
| GET | `/errors?status&service&cursor` | Error groups (paginated) |
| GET | `/errors/:id` | Error detail with stack trace |
| GET | `/services` | Services with nullable metrics |
| GET | `/services/:id` | Service detail |
| GET | `/infrastructure?category` | Resources by category |
| GET | `/infrastructure/:id` | Resource detail |
| POST | `/logs/search` | Starts a log search `{ text?, service?, levels?, source?, from, to, cursor? }` → `{ searchId, status, items, nextCursor }` |
| GET | `/logs/search/:id?cursor` | Polls a log search |
| DELETE | `/logs/search/:id` | Cancels a log search (frees CloudWatch Logs Insights concurrency; best effort) |
| GET | `/alerts?status&cursor` | Alerts (paginated; `status` can be `history`) |
| GET | `/alerts/:id` | Alert detail |
| POST | `/alerts/:id/acknowledge` | Acknowledge an alert |
| GET | `/incidents?cursor` | Incidents (paginated) |
| GET | `/incidents/:id` | Incident detail |
| GET | `/synthetics` | Synthetic checks |
| GET | `/synthetics/:id` | Check detail |
| GET | `/slos` | SLOs |
| GET | `/slos/:id` | SLO detail |
| GET | `/deployments?cursor` | Deployments (paginated) |
| GET | `/deployments/:id` | Deployment detail |
| GET | `/investigations/:id` | Investigation: observed facts, correlations, hypotheses |
| GET | `/repository/evidence/:id` | Commit, file, lines, diff |
| POST | `/ai/ask` | `{ question, context?: { type, id } }` → answer with citations. References only, never raw data |
| GET | `/search?q` | Global search |
| GET | `/me/favorites` | Server-side favorites |
| PUT | `/me/favorites` | Replace favorites `{ items }` |
| POST | `/me/devices` | Register for push `{ pushToken, platform, preferences: { minSeverity, categories } }` → `{ id }` |
| DELETE | `/me/devices/:id` | Unregister |

Client timeouts: 10 s for `server`, 30 s for logs, 60 s for AI, 15 s otherwise.

## Capability flags

`features` in `GET /server`. A missing flag counts as `false`.

| Flag | Screens it enables |
|------|-------------------|
| `health` | Home |
| `brief` | Morning Brief |
| `problems` | Problems tab and details |
| `errors` | Errors |
| `services` | Services tab |
| `infrastructure` | Infrastructure |
| `logs` | Logs search |
| `alerts` | Alerts tab, acknowledge |
| `incidents` | Incidents |
| `synthetics` | Synthetics |
| `slos` | SLOs |
| `deployments` | Deployments |
| `investigations` | Investigations |
| `repository` | Repository evidence |
| `ai` | Ask OpsWatch and contextual AI actions |
| `search` | Global search |
| `favorites` | Server-side favorites (otherwise kept locally) |
| `environments` | Environment picker |
| `push` | Push device registration |

## Implementation status

Server implementation is pending. The server team froze the first areas; the rest ship later behind their flags.

| Area | Endpoints | Status |
|------|-----------|--------|
| Server, auth, me | `server`, `auth/*`, `me` | Frozen first; server implementation pending |
| Environments | `environments` | Frozen first; pending |
| Home | `health`, `brief` | Frozen first; pending |
| Problems | `problems*` | Frozen first; pending |
| Errors | `errors*` | Frozen first; pending |
| Services, infrastructure, logs, alerts, incidents, synthetics, SLOs, deployments, investigations, repository, AI, search, favorites | | Later, behind flags |
| Push devices | `me/devices*` | Later; `features.push = false` for now |

The demo client and the mock server implement the whole contract from fixtures, so the app can be developed and
tested before the server catches up.

## Requesting a contract change

1. Record the need in [Contract gaps / requests](#contract-gaps--requests) below: endpoint, fields, why mobile needs
   it, and whether it is blocking.
2. Agree it with the server side and reconcile it in `packages/contract` (the canonical copy).
3. Update mobile to consume the package version. Until the package is on this branch, mirror the agreed change in
   `apps/mobile/src/api/contract.ts` exactly as agreed.
4. Never diverge locally: no mobile-only fields, no reinterpretation of existing ones.
5. New optional fields and new enum values are backward compatible (the schemas tolerate them). Removing or retyping
   a field is a breaking change and needs a new `apiVersion` or a new endpoint.

## Contract gaps / requests

To be filled as needs are agreed. Known items:

| Request | Why | Status |
|---------|-----|--------|
| Single log entry endpoint (for example `GET /logs/:id`) | Open one log line from a link, a citation or an investigation without re-running a search | Open |
| Push devices endpoint (`POST /me/devices`, `DELETE /me/devices/:id`) implemented server-side, plus a sender | Remote push ([notifications.md](notifications.md)) | Open |
| Session listing and revocation endpoint | Let the user see and revoke signed-in devices | Open |
| Rendered text for brief sentences | Brief and health `changes[].text` should arrive localised and ready to display (per `Accept-Language`), so the app does not rebuild sentences | Open |
