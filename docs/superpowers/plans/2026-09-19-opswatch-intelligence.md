# OpsWatch Intelligence — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax. Each task is self-contained: an implementer sees only its own task text plus the header sections of this plan (everything from **Goal** down to and including **Task index**).

**Goal:** Give OpsWatch a memory and a verdict — a background collector that holds a lock and runs a bounded cycle, a persisted **Problem** with a deterministic identity, an argued severity score and a required evidence bundle, the Problems, Health and Morning brief surfaces that read them, error groups with a fingerprint that survives a rebuild, and one `HistoricalStorageProvider` interface with the OpsWatch-database provider behind it — so that a fresh installation, with historical collection off and without spending one extra AWS request, opens on a page that says what deserves attention and shows the arithmetic behind it.

**Architecture:** Four new server-only layers, each with one job and a boundary a test enforces. `src/lib/store/*` owns every SQL statement and is the only place `drizzle-orm` and `@/lib/db/schema` may be imported from below `src/lib/db/`. `src/lib/detect/*` is pure: it turns the Stage 2 signals (`src/lib/monitoring/ecs.ts`, `rds.ts`, `elb.ts`, `alarms.ts`, `insights.ts`) into per-subject outcomes, scores them and hands the store a lifecycle transition — it never calls AWS and never reads the clock. `src/lib/collector/*` owns the loop: it claims one lock with one conditional `UPDATE`, runs the jobs a fresh install needs, records what each job covered, and writes in bounded transactions so the event loop keeps serving pages. `src/lib/read/*` and `src/lib/write/*` are the domain services §32.4 asks for: pages and the forthcoming `/api/v1` routes call the same functions, so nothing is implemented twice, and they speak the **mobile contract's** field names because §33.1 makes that file the source of truth. The Problems, Health and Brief pages are new sub-pages of the existing `overview` section, so `parseMonitoringPath` and the rail are untouched (§3 keeps that promise explicitly).

**Tech Stack:** Next.js 16.3.5 (App Router), React 19.2.8, TypeScript 5.9.3, next-intl 4.14.5, Tailwind CSS 4, shadcn/ui 4.21 (style radix-nova), lucide-react 1.47, recharts 3.10.1, AWS SDK v3 3.1134.0, drizzle-orm 0.45.2 + drizzle-kit 0.31.10 + better-sqlite3 13, zod 4.6.5, Vitest 5.0.1 + aws-sdk-client-mock 4.1.0, Playwright 1.63.0, moto 5.2.3, knip 6. **Phase 1 adds no runtime dependency and no dev dependency.** Everything it needs — SHA-256, HMAC, timers, JSON, SQLite — is in Node 22 or already installed. §15.3's `nodemailer 10.0.10` belongs to phase 4 of the mission and must not be installed here.

**Spec:** `docs/superpowers/specs/2026-09-19-opswatch-intelligence-design.md`. **§33 (peer review rulings) is binding and overrides every earlier section it contradicts**; §31 and §32 are binding over §1–§30. Every task below cites the sections it implements, and where §33 amended them it cites the amendment.

**Companion contract:** `/var/www/html/OpsWatch-mobile/apps/mobile/src/api/contract.ts` on branch `feature/mobile`, read on 2026-09-18. Per §33.1 it is the source of truth for every field it defines. This plan quotes its shapes where a task must match them. **Read it, never modify it, never merge that branch** (§32.5).

**Out of scope, being built right now by another agent:** `packages/contract` and the `/api/v1` route skeleton (`src/lib/api/route.ts`, `apiRoute({ permission, schema, handler })`, bearer tokens, rate limits, the `users`/`api_tokens`/`PERMISSIONS` work of §10). This plan **consumes** them: every read and write module below is written so a route handler can call it with no adaptation, and Task 25 reconciles the two. No task here creates a file under `src/app/api/v1/`, `packages/contract/` or `src/lib/api/`.

## Global Constraints

Binding for every task. Copied from the spec where the spec states them.

- **Read-only forever.** "No code path issues a write verb against a customer's AWS, Cloudflare or GitHub. Tests enforce it." (§2.5) "No write action on customer infrastructure, ever. No restart, no scale, no rollback, no DNS change, no GitHub write, no Cloudflare write. The IAM catalogue contains no write action and a test keeps it that way." (§25) No task in this plan adds an AWS action to `src/lib/aws/permissions.ts`, and `TEMPLATE_VERSION` stays 1 (§31.2: OpsWatch "must not deploy or update any stack, and must not touch any AWS resource").
- **No secret in any client component or log.** "Never to any client, at any role: a credential in any form, a decrypted config, an AI provider key, a token value after creation, another user's password hash, the SQLite path, the CloudFormation external id, and the audit log to anyone but an admin." (§12.6) A token-shaped string is never stored at all and provider identifiers are replaced before storage (§11.2, Stage 4 amendment 14.5). Failures are logged as one JSON line through `logMonitoringFailure` — never credentials, request parameters, resource names, SQL statements, log field names, log query text or query results. An `AwsTarget` is never passed as a prop to a client component.
- **No user-facing string in code, EN/FR at parity.** "English and French at parity, enforced by the existing test. No user-facing string in code." (§24) Every label, heading, sentence, empty state, aria-label and tooltip is a key in `messages/en.json` **and** `messages/fr.json`, checked by `tests/unit/i18n-messages.test.ts`. Namespaces a client component reads are listed in `CLIENT_NAMESPACES` (`src/i18n/client-messages.ts`) and checked by `tests/unit/client-messages.test.ts`. "Severities, statuses and detector kinds are enums rendered through key maps; a sentence is never concatenated." (§24) AWS identifiers are never translated.
- **Additive migrations only.** "All additive. No existing table is rebuilt (Stage 4 amendment 13.1), and a WAL-safe backup runs before any schema migration (Stage 4 amendment 14.6)." (§9.3) Migration SQL is produced by `npm run db:generate` and **never hand-edited**. No task alters or drops an existing column.
- **No new runtime dependency without stating why.** Phase 1 adds none; §15.3's nodemailer is "the only new runtime dependency in this mission" and is not phase 1's. "No new client-side library." (§24) If a task believes it needs a package it must stop and ask rather than install one.
- **Nothing is faked.** "A missing measurement is `null` and renders as 'not measured', never as `0`, never as 'healthy'." (§2.4) "An empty page is a bug. Either the page has data, or it has a card that names the integration it needs, or it is not in the menu." (§2.6)
- **Deterministic first.** "Grouping, severity, baselines and anomalies are computed by written formulas and unit-tested. AI ranks and narrates; it never decides." (§2.2) No task in phase 1 calls a model.
- **The store is the only SQL.** Every query lives behind a repository in `src/lib/store/`; the only SQLite-specific SQL allowed is `INSERT … ON CONFLICT` and `json_extract`. "No `better-sqlite3` type may appear above the store layer. A test enforces the second rule the way `module-boundaries.test.ts` enforces the client/server split." (§9.6) Enforced as: nothing outside `src/lib/db/**` and `src/lib/store/**` may import `better-sqlite3`, `drizzle-orm*` or `@/lib/db/schema`, and nothing outside `src/lib/store/**` may mention `.$client`.
- **Server-only data modules.** Every file under `src/lib/store/`, `src/lib/detect/`, `src/lib/collector/`, `src/lib/history/`, `src/lib/read/` and `src/lib/write/` starts with `import 'server-only';` and is listed in `SERVER_ONLY_MODULES` of `tests/unit/module-boundaries.test.ts`. Files under `src/lib/monitoring/shared/` stay client-safe: they import nothing from AWS, zod, Node, the database, `next-intl/server` or `server-only`.
- **Session first in every page, route and action.** Every monitoring page's first statement is `await initMonitoringRoute(params)`; every server action calls `requireAdmin(resolveLocale(locale))` before reading anything. Next.js verifies a Server Action's Origin itself; a mutating route handler checks `isSameOrigin(request, env().OPSWATCH_PUBLIC_URL)` first.
- **One clock per render.** A page reads `pageNow()` from `@/lib/monitoring/shared/time-range` exactly once and passes `nowMs` down. No data module, detector or store function calls `Date.now()` itself: every one of them takes `nowMs` or a `now` parameter. This is what makes the whole engine testable.
- **The collector must not block rendering.** "better-sqlite3 is synchronous, so a long transaction stops the event loop. Writes go in transactions of at most 1,000 rows with a yield between batches, and no transaction may exceed 50 ms of work." (§9.2)
- **Cursors run on an immutable key.** "Lists page on a monotonic `seq` (an autoincrement assigned at insert) with the row id as tiebreak… Severity and recency remain sort options applied inside a page, never cursor axes; a client that wants the worst problems asks for a bounded top-N endpoint, which returns a complete ranked set with no cursor at all." (§33.6)
- **Every task ends green and commits.** Before its commit step a task runs, and must see pass/exit 0/no output: `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` · `npx knip`. Test output must be pristine — pass `log: vi.fn()` in `MonitoringDeps` so no failure is printed. Do not export a symbol nothing imports: knip fails the task. E2E only where a task's steps say so: `docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e; docker compose -f docker-compose.test.yml down -v`. Never run `docker compose config` against `docker-compose.yml` and never print `.env`.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Branch:** `feature/opswatch-intelligence` (base `7c471fd`). Nothing is pushed: §30.1 records that publishing is still blocked.

## Decisions fixed once

Every task uses these; they are decided here so tasks stay consistent.

### D1 — The mobile contract's shapes, and the three approved additions

§33.1: the mobile file wins field by field; anything the server must add is **added as an optional field, never a rename or a removal**. Read from `apps/mobile/src/api/contract.ts` on 2026-09-18, the shapes phase 1 must serve are:

```ts
problemSummary = { id, title, severity: 'critical'|'warning'|'info',
                   status: 'new'|'active'|'acknowledged'|'resolved',
                   category: string, service?: Ref, resource?: string,
                   firstSeenAt, lastSeenAt, occurrences: number|null,
                   trend: 'rising'|'falling'|'stable'|null, summary?: string }
Ref            = { type: RefType, id, label?: string }
evidence       = { id, at, kind: 'fact'|'correlation'|'hypothesis', type: string,
                   title: string, detail?, ref?, series?, confidence? }
health         = { generatedAt, status: 'healthy'|'degraded'|'critical'|'unknown',
                   headline?, counts: { critical, warning, healthyServices|null, totalServices|null },
                   families: [{ family, label, status, total|null, affected|null,
                                unavailable?: { reason, code? } }],
                   topProblem: problemSummary|null, activeAlerts: number|null,
                   synthetics: { up, down, degraded }|null,
                   recentIncidents: [], recentDeployments: [], changes: Change[] }
brief          = { generatedAt, period: { from, to }, status, counts, changes: Change[],
                   mostImportant: problemSummary|null }
Change         = { id, direction: 'up'|'down'|'new'|'resolved'|'stable', text, severity?, ref? }
errorSummary   = { id, message, type?, status: 'new'|'recurring'|'regression'|'resolved',
                   service?: Ref, route?, occurrences: number|null,
                   affectedInstances: number|null, firstSeenAt, lastSeenAt, problemId? }
```

The three additions §33.1 approves, and the only ones phase 1 makes: **`problemSummary.key`** (the dedupe key), **`problemSummary.score`** (the integer 0…100 behind `category`) and **`serverInfo.demo`** (not phase 1's — the API agent owns `serverInfo`). Phase 1 makes two further optional additions, both required by §12.2's "every human-readable label is returned twice" and both announced to the mobile agent in the commit that introduces them: **`titleKey`** and **`values`** on `problemSummary` and on the wire evidence item, so a client with the catalogue renders in its own locale.

**Mappings, written once because three tasks need them.**

| Stored (this plan) | Wire (mobile contract) | Rule |
|---|---|---|
| `status: 'open'` | `'new'` | while `nowMs - firstSeenAt < PROBLEM_NEW_MS` (1 h) |
| `status: 'open'` | `'active'` | otherwise |
| `status: 'acknowledged'` | `'acknowledged'` | — |
| `status: 'resolved'` or `'closed'` | `'resolved'` | — |
| `kind` (`ecs_cpu_high`, …) | `category` | the detector id, verbatim, never translated |
| `severity` | `severity` | the label derived from `score` (§4.3) |
| `score` | `score` | approved addition |
| `subjectName` | `resource` | omitted when the subject is a service |
| `serviceId` + service name | `service: Ref{ type: 'service' }` | omitted when unknown |
| evidence `kind: 'metric'\|'event'\|'log'\|'check'\|'inventory'` | `type` | the wire `kind` is always `'fact'` in phase 1: every §4.3 evidence item is an observed fact, and correlations and hypotheses arrive with §7 in phase 5 |
| evidence `labelKey`+`values` rendered | `title` | plus `detail` = the formatted `value` and `unit`, or the "not measured" string when `value` is `null` |

`trend` is an **enum**, not a series. Phase 1 computes it from the two most recent evidence values of a `metric` item: `rising` when the newer exceeds the older by more than 5 %, `falling` when it is lower by more than 5 %, `stable` otherwise, and `null` when there is no metric evidence. Nothing is invented: `null` is a legal answer.

### D2 — Environment ids and routes

`env` is `"<connectionId>:<scope>"` where scope is an AWS region, a Cloudflare zone id, or the literal `account` (§12.5). Phase 1 only ever produces an AWS region, but the parser accepts all three shapes so nothing has to change later.

Problems, Health and the Morning brief read a provider's data, so by §3's URL rule they live under `/c/<connectionId>/<scope>/…`. They are added as **sub-pages of the existing `overview` section**, which is what keeps §3's promise that "`parseMonitoringPath` keeps working unchanged":

| Path | Page |
|---|---|
| `/c/<id>/<region>/overview/brief` | Morning brief — the section's default |
| `/c/<id>/<region>/overview/health` | Health |
| `/c/<id>/<region>/overview/problems` | Problems list |
| `/c/<id>/<region>/overview/problems/<problemId>` | Problem detail |
| `/c/<id>/<region>/overview/insights` | the Stage 3 page, unchanged |
| `/c/<id>/<region>/errors` | Errors list (new section, Task 21) |
| `/c/<id>/<region>/errors/<errorGroupId>` | Error group detail |

`SUBSECTIONS.overview` becomes `['brief', 'health', 'problems', 'insights', 'audit']`. §3's seven-group rail restructure is **not** phase 1: it touches every page in the product and belongs with the pages it introduces (phase map, mission phase 2). `overview/audit` stays in `UNBUILT_SUBSECTIONS`, inherited from the Stage 3 plan whose Tasks 26–27 build it; §3's "`UNBUILT_SUBSECTIONS` must be empty at the end of every phase" is satisfied for everything phase 1 introduces and is recorded as the one inherited deviation.

### D3 — Naming

| Constant / type | Value | Where |
|---|---|---|
| `PROBLEM_KEY_LENGTH` | `32` | `src/lib/detect/key.ts` |
| `SCORE_WEIGHTS` | `{ s: 40, b: 20, t: 15, u: 15, d: 10 }` | `src/lib/detect/score.ts` |
| `LEVEL_S` | `{ critical: 1, warning: 0.55, info: 0.2 }` | `src/lib/detect/score.ts` |
| `NO_FAMILY_B` | `0.34` | `src/lib/detect/score.ts` |
| `FRESH_SUBJECT_MS` | `2 * 60 * 60_000` | `src/lib/detect/score.ts` |
| `CRITICAL_SCORE` / `WARNING_SCORE` | `70` / `40` | `src/lib/detect/score.ts` |
| `CLEAR_EVALUATIONS` / `CLEAR_MIN_MS` | `3` / `15 * 60_000` | `src/lib/detect/lifecycle.ts` |
| `REOPEN_WINDOW_MS` | `2 * 60 * 60_000` | `src/lib/detect/lifecycle.ts` |
| `STALE_AFTER_MS` | `60 * 60_000` | `src/lib/detect/lifecycle.ts` |
| `RESOLVED_RETENTION_MS` | `30 * 24 * 60 * 60_000` | `src/lib/store/retention.ts` (§33.2) |
| `PROBLEM_NEW_MS` | `60 * 60_000` | `src/lib/read/problems.ts` |
| `FLEET_MIN_MEMBERS` / `FLEET_EXPAND_CYCLES` | `4` / `2` | `src/lib/detect/fleet.ts` (§33.8) |
| `LOCK_STALE_MS` / `LOCK_HEARTBEAT_MS` | `90_000` / `30_000` | `src/lib/store/collector.ts` (§9.2) |
| `MAX_ROWS_PER_TRANSACTION` | `1000` | `src/lib/store/tx.ts` (§9.2) |
| `FINGERPRINT_VERSION` | `1` | `src/lib/detect/fingerprint.ts` |
| `NORMALIZED_MESSAGE_MAX` / `MAX_FRAMES` | `300` / `5` | `src/lib/detect/fingerprint.ts` |
| `DEFAULT_PAGE_LIMIT` / `MAX_PAGE_LIMIT` | `50` / `100` | `src/lib/read/paging.ts` (§12.2) |
| `TOP_PROBLEMS_LIMIT` | `20` | `src/lib/read/problems.ts` (§33.6 bounded top-N) |

Detector titles reuse the catalogue that already exists at parity: `titleKey` is `Insights.messages.<kind>` and the values are the ones the Stage 2 rules already build. Nothing is retranslated.

### D4 — What a fresh install runs, and what history gates

§33.2 splits the switch in two, and this plan follows it exactly.

- **Always on, never a storage-provider concern, no extra AWS cost:** the open problem and its dedupe key, `firstSeenAt`, `lastSeenAt`, `acknowledgedAt`, `resolvedAt`, `flapCount`, `previousProblemId`, the current evidence bundle, and the same for incidents. Resolved problems are kept 30 days and then deleted. The `detect` job runs from data the page already fetched; the `inventory` job is `Describe*` calls, which "are not billed but are throttled" (§9.5).
- **Off by default, behind `HistoricalStorageProvider`:** 5-minute and 1-hour metric rollups, baselines, anomaly history, problem timelines beyond the 30 days, occurrence counts over months, trend charts, deployments, SLO rollups, long-term reports.
- **Independently gated, and not by the history switch:** error collection, which is "opt-in per log group" with its own budget (§9.5). A `log_source` row with `enabled = 0` costs nothing. This plan rules that error groups and their hourly occurrence rollups are **live state** governed by that per-source opt-in; the history switch governs only their retention beyond §9.4's windows. That is the reading §33.2's own reasoning requires — the group is what the Errors page and the brief show on first load — and it is recorded here so no later task re-litigates it.

So the fresh-install cycle is `inventory` (30 min) and `detect` (5 min), plus `compact` (24 h). `metrics` runs only when history is enabled (Task 24); `errors` runs only for an enabled `log_source` (Task 20).

## File Structure

```
src/lib/store/                 the only SQL in the product (§9.6)
  tx.ts            batched transactions, the 1000-row / 50 ms rule            (Task 1)
  problems.ts      problems + problem_evidence, seq paging                    (Task 1)
  events.ts        the append-only events spine, dedupeKey                    (Task 2)
  collector.ts     collector_lock (atomic claim) + collector_runs             (Tasks 2, 3)
  incidents.ts     incidents + incident_timeline                              (Task 4)
  retention.ts     the 30-day resolved-problem purge and the event windows    (Task 4)
  resources.ts     resources, first/last seen                                 (Task 10)
  errors.ts        error_groups, error_occurrences, log_sources, user_marks   (Task 19)
  history.ts       history_points, history_watermarks, history_settings       (Tasks 23, 24)
src/lib/detect/                pure, no AWS, no clock, no database
  key.ts           problemKey, subject kinds                                  (Task 5)
  score.ts         SCORE_WEIGHTS, scoreProblem, severityForScore (§4.3/§33.7) (Task 5)
  types.ts         Evidence, SubjectRef, DetectedProblem, SubjectOutcome      (Task 6)
  framework.ts     Detector, runDetectors, DetectorCycle                      (Task 6)
  lifecycle.ts     applyCycle: open/ack/resolve/reopen/flap/stale (§33.5)     (Task 6)
  fleet.ts         collapse and expansion as transitions (§33.8)              (Task 7)
  aws.ts           the first detectors over the Stage 2 rules                 (Task 8)
  fingerprint.ts   fingerprint v1 + §33.13 frame normalisation                (Task 18)
  errors.ts        error_group_new, error_group_spike                         (Task 20)
src/lib/collector/
  runner.ts        lock loop, scheduler, OPSWATCH_COLLECTOR / OPSWATCH_ROLE   (Task 9)
  jobs.ts          the job catalogue, schedule and caps (§9.2)                (Task 9)
  inventory.ts     the inventory job                                          (Task 10)
  detect.ts        the detect job                                             (Task 10)
  compact.ts       retention and the WAL-safe backup (§9.3)                   (Task 11)
  errors-job.ts    the bounded Logs Insights job                              (Task 20)
  metrics-job.ts   rollups, behind the history switch                         (Task 24)
src/lib/history/
  provider.ts      HistoricalStorageProvider and its guarantees (§33.10)      (Task 22)
  opswatch-db.ts   the default provider on the OpsWatch database              (Task 23)
  settings.ts      history settings, off by default (§31.1)                   (Task 24)
  estimate.ts      the two-line estimate, by billing unit (§33.12)            (Task 24)
src/lib/read/      locale-free domain reads, called by pages and /api/v1
  paging.ts, problems.ts, health.ts, brief.ts, errors.ts, status.ts, render.ts
src/lib/write/     acknowledge.ts                                             (Task 15)
src/lib/monitoring/shared/environment.ts   environmentId / parseEnvironmentId (Task 13)
src/lib/monitoring/insights.ts  + per-subject rule exports                    (Task 8)
src/lib/crypto.ts               + sha256Hex                                   (Task 5)
src/lib/db/schema.ts            + every new table; drizzle/0002…0007_*.sql
src/instrumentation-node.ts     + startCollector()                            (Task 9)
src/components/problems/        severity-badge, evidence-list, score-breakdown,
                                problem-table, acknowledge-form               (Tasks 14, 15)
src/components/errors/          error-table, frame-list                       (Task 21)
src/app/[locale]/(app)/c/[connectionId]/[region]/overview/{brief,health,problems}/
src/app/[locale]/(app)/c/[connectionId]/[region]/errors/
src/app/[locale]/(app)/settings/                 + Data & History section     (Task 24)
tests/unit/store-*.test.ts, detect-*.test.ts, collector-*.test.ts,
tests/unit/read-*.test.ts, history-*.test.ts
tests/helpers/history-conformance.ts, tests/helpers/detect.ts
tests/e2e/10-problems.spec.ts, tests/e2e/11-errors.spec.ts
messages/en.json, messages/fr.json                                            (Tasks 1–25)
```

## Task index

**Phase 1 — the store (Tasks 1–4):** 1 store boundary, `problems`, `problem_evidence`, seq paging · 2 the events spine and `collector_runs` · 3 the collector lock, claimed atomically · 4 incidents, the timeline, and retention.

**Phase 2 — the Problem engine (Tasks 5–8):** 5 identity and the severity score · 6 the detector framework, outcomes and lifecycle · 7 fleet collapse and expansion · 8 the first detectors.

**Phase 3 — the collector (Tasks 9–12):** 9 the runtime and its cycle · 10 the `inventory` and `detect` jobs · 11 compaction, retention and the WAL-safe backup · 12 checkpoint — the engine runs headless.

**Phase 4 — the surfaces (Tasks 13–17):** 13 routes, environment ids and the read layer's paging · 14 the Problems list · 15 Problem detail, evidence, "Why this score", acknowledgement · 16 Health · 17 the Morning brief.

**Phase 5 — error intelligence (Tasks 18–21):** 18 fingerprint v1, rebuild-proof · 19 the error group store and "what's new" · 20 the `errors` job and the error detectors · 21 the Errors surface and the brief's three sets.

**Phase 6 — storage providers (Tasks 22–24):** 22 `HistoricalStorageProvider` and its conformance suite · 23 the OpsWatch-database provider · 24 Settings → Data & History and the metrics job behind the switch.

**Task 25 — mission checkpoint:** rescan, System status, documentation, contract reconciliation.

## The phase map for the rest of the mission

Phase 1 of this plan is mission phases 1 and 2 of §26, plus §33.9's storage slice. What follows, in §26's order as amended by §33.9 and by §26's own cut order:

| Mission phase | What ships | Depends on this plan's |
|---|---|---|
| **2. Services and the rail** | `services`, `service_aliases`, `service_resources` from ECS; §3's seven-group rail; Service Health; Activity feed over the `events` spine; the Stage 3 Audit page renamed Checkup | Tasks 1, 2, 10, 13 |
| **3. API and baselines** | `/api/v1`, bearer and personal tokens, `packages/contract`, rate limits, §10's roles and `apiRoute`; `metric_baselines` and the §8 maths; `metric_anomaly` | Tasks 5, 6, 14–17, 22–24 |
| **4. Alerts and synthetics** | `alert_rules`, dedupe, cooldown, delivery, nodemailer/Slack/webhook, synthetics with §33.3's pinned-address SSRF guard, `cert_expiring`, `delivery_failed` | Tasks 2, 6, 9 |
| **5. Investigations and incidents** | the §7 engine with §33.11's validator, deployment correlation, GitHub, auto-created incidents and postmortems | Tasks 2, 4, 6 |
| **6. Reliability and depth** | SLOs, reports, Cloudflare enrichment, the dependency map, database/cache/log intelligence, template version 2 | Tasks 22–24 |
| **7. Assistant and polish** | the AI provider abstraction, Ask OpsWatch, global search, demo mode | Tasks 14–17, 21 |
| **8. Passes** | performance audit, responsive pass, security review, repository rescan, self-hosting guide | all |
| **After the last phase-1 feature, before any phase-2 feature (§33.9)** | the local-files history provider, then OpenSearch, then the documented extension point, then the optional semantic layer — in that priority order, and cut before any phase-2 feature | Task 22's conformance suite |

---

## Phase 1 — The store

Nothing in Phase 1 calls AWS or renders a page. Every module is a repository with its own tests.

### Task 1: The store boundary, the `problems` tables and seq paging

Implements §9.3 (additive tables), §9.6 (the store boundary), §4.3's columns and §33.6 (an immutable cursor axis).

**Files:**
- Create: `src/lib/store/tx.ts`, `src/lib/store/problems.ts`
- Create: `tests/unit/store-problems.test.ts`
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0002_<generated>.sql` (generated by `npm run db:generate`, never hand-written)
- Modify: `tests/unit/module-boundaries.test.ts`, `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: `sqliteTable`, `text`, `integer`, `real`, `index`, `uniqueIndex` from `drizzle-orm/sqlite-core`; `and`, `eq`, `gt`, `inArray`, `isNull`, `or`, `sql` from `drizzle-orm`; `Db` from `@/lib/db/client`; `randomId` from `@/lib/crypto`.
- Produces (`src/lib/db/schema.ts`):

```ts
export const PROBLEM_STATUSES = ['open', 'acknowledged', 'resolved', 'closed'] as const;
export const PROBLEM_SEVERITIES = ['critical', 'warning', 'info'] as const;
export const SUBJECT_TYPES = ['service', 'resource', 'cluster', 'error_group', 'synthetic', 'integration'] as const;
export const EVIDENCE_KINDS = ['metric', 'event', 'log', 'check', 'inventory'] as const;

export const problems = sqliteTable(
  'problems',
  {
    // The cursor axis of §33.6: AUTOINCREMENT, so a purge never lets SQLite reuse a rowid.
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    key: text('key').notNull(),
    connectionId: text('connection_id').notNull(),
    scope: text('scope').notNull(),
    kind: text('kind').notNull(),
    subjectType: text('subject_type', { enum: SUBJECT_TYPES }).notNull(),
    subjectId: text('subject_id').notNull(),
    subjectName: text('subject_name').notNull(),
    serviceId: text('service_id'),
    source: text('source').notNull(),
    titleKey: text('title_key').notNull(),
    values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
    severity: text('severity', { enum: PROBLEM_SEVERITIES }).notNull(),
    score: integer('score').notNull(),
    scoreTerms: text('score_terms', { mode: 'json' }).$type<StoredScoreTerms>().notNull(),
    status: text('status', { enum: PROBLEM_STATUSES }).notNull(),
    href: text('href').notNull(),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    lastEvaluatedAt: integer('last_evaluated_at').notNull(),
    clearStreak: integer('clear_streak').notNull().default(0),
    clearSinceAt: integer('clear_since_at'),
    occurrences: integer('occurrences').notNull().default(1),
    flapCount: integer('flap_count').notNull().default(0),
    acknowledgedBy: text('acknowledged_by'),
    acknowledgedAt: integer('acknowledged_at'),
    resolvedAt: integer('resolved_at'),
    investigationId: text('investigation_id'),
    incidentId: text('incident_id'),
    previousProblemId: text('previous_problem_id'),
    fleetProblemId: text('fleet_problem_id'),
    grouped: integer('grouped', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    // One live row per dedupe key. A resolved row leaves the index, so a new row may take its place.
    uniqueIndex('problems_open_key').on(t.key).where(sql`resolved_at is null`),
    index('problems_env_seq').on(t.connectionId, t.scope, t.seq),
    index('problems_key_resolved').on(t.key, t.resolvedAt),
    index('problems_service').on(t.serviceId, t.seq),
  ],
);

export const problemEvidence = sqliteTable(
  'problem_evidence',
  {
    id: text('id').primaryKey(),
    problemId: text('problem_id').notNull().references(() => problems.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind', { enum: EVIDENCE_KINDS }).notNull(),
    labelKey: text('label_key').notNull(),
    values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
    // null is "not measured" (§2.4). It is never written as 0.
    value: real('value'),
    unit: text('unit'),
    at: integer('at').notNull(),
    seriesRef: text('series_ref'),
    href: text('href'),
  },
  (t) => [index('problem_evidence_problem').on(t.problemId, t.position)],
);

export type ProblemRow = typeof problems.$inferSelect;
export type ProblemEvidenceRow = typeof problemEvidence.$inferSelect;
/** Written by Task 5's scoreProblem; stored verbatim so the page can render the arithmetic it used. */
export type StoredScoreTerms = {
  s: number; b: number | null; t: number; u: number | null; d: number;
  weights: { s: number; b: number; t: number; u: number; d: number };
  availableWeight: number; rescaled: boolean; floored: boolean; score: number;
};
```

- Produces (`src/lib/store/tx.ts`):
  - `export const MAX_ROWS_PER_TRANSACTION = 1000;`
  - `export async function inBatches<T>(db: Db, rows: readonly T[], write: (tx: Db, batch: readonly T[]) => void): Promise<number>` — splits `rows` into batches of at most `MAX_ROWS_PER_TRANSACTION`, runs each inside `db.transaction`, and `await new Promise(setImmediate)` between batches so the event loop keeps serving pages (§9.2).
- Produces (`src/lib/store/problems.ts`, server-only):
  - `export type NewProblem = { key, connectionId, scope, kind, subjectType, subjectId, subjectName, serviceId, source, titleKey, values, severity, score, scoreTerms, href, firstSeenAt, lastSeenAt, lastEvaluatedAt, previousProblemId: string | null, evidence: readonly NewEvidence[] };`
  - `export type NewEvidence = { kind, labelKey, values, value: number | null, unit: string | null, at: number, seriesRef?: string, href?: string };`
  - `export function insertProblem(db: Db, input: NewProblem): ProblemRow`
  - `export function findLiveProblem(db: Db, key: string): ProblemRow | null` — the row with this key and `resolvedAt is null`.
  - `export function findRecentResolved(db: Db, key: string, notBeforeMs: number): ProblemRow | null` — the most recent resolved row for the key whose `resolvedAt >= notBeforeMs`.
  - `export function findLastProblemForKey(db: Db, key: string): ProblemRow | null`
  - `export function updateProblem(db: Db, id: string, patch: Partial<Omit<ProblemRow, 'seq' | 'id' | 'key'>>): ProblemRow`
  - `export function replaceEvidence(db: Db, problemId: string, evidence: readonly NewEvidence[]): void`
  - `export function listEvidence(db: Db, problemId: string): ProblemEvidenceRow[]`
  - `export function findProblemById(db: Db, id: string): ProblemRow | null`
  - `export type ProblemFilter = { connectionId: string; scope: string; status?: readonly ProblemStatus[]; severity?: readonly ProblemSeverity[]; kind?: readonly string[]; serviceId?: string; sinceMs?: number; includeGrouped?: boolean };`
  - `export type SeqPage<T> = { items: T[]; nextSeq: number | null; nextId: string | null };`
  - `export function pageProblems(db: Db, filter: ProblemFilter, cursor: { afterSeq: number; afterId: string } | null, limit: number): SeqPage<ProblemRow>`
  - `export function countProblemsBySeverity(db: Db, filter: ProblemFilter): Record<ProblemSeverity, number>`

`pageProblems` orders by `(seq asc, id asc)` and asks for `limit + 1` rows: the extra row decides whether `nextSeq`/`nextId` are set. It never orders by `score`, `severity` or `lastSeenAt` — §33.6 forbids a mutable cursor axis. `includeGrouped` defaults to `false`, so a list hides children collapsed behind a fleet problem (§33.8).

- [x] **Step 1: Write the failing test.** Create `tests/unit/store-problems.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  countProblemsBySeverity, findLiveProblem, findRecentResolved, insertProblem,
  listEvidence, pageProblems, replaceEvidence, updateProblem, type NewProblem,
} from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);
const base = (over: Partial<NewProblem> = {}): NewProblem => ({
  key: 'k1'.padEnd(32, '0'),
  connectionId: 'c1', scope: 'us-east-1', kind: 'ecs_cpu_high',
  subjectType: 'service', subjectId: 'prod/web', subjectName: 'web', serviceId: 'prod/web',
  source: 'aws', titleKey: 'Insights.messages.ecs_cpu_high', values: { service: 'web', value: 96 },
  severity: 'critical', score: 82,
  scoreTerms: { s: 1, b: 0.5, t: 1, u: 1, d: 0, weights: { s: 40, b: 20, t: 15, u: 15, d: 10 }, availableWeight: 100, rescaled: false, floored: false, score: 82 },
  href: '/c/c1/us-east-1/containers/services/prod/web',
  firstSeenAt: AT, lastSeenAt: AT, lastEvaluatedAt: AT, previousProblemId: null,
  evidence: [{ kind: 'metric', labelKey: 'Problems.evidence.cpu', values: {}, value: 96.2, unit: 'percent', at: AT }],
  ...over,
});

describe('the problem store', () => {
  it('assigns a monotonic seq and keeps one live row per key', () => {
    const db = createTestDb();
    const a = insertProblem(db, base());
    expect(a.seq).toBe(1);
    expect(findLiveProblem(db, a.key)?.id).toBe(a.id);
    expect(() => insertProblem(db, base())).toThrow();
  });

  it('lets a new row take the key once the old one is resolved, and finds the old one inside the reopen window', () => {
    const db = createTestDb();
    const a = insertProblem(db, base());
    updateProblem(db, a.id, { status: 'resolved', resolvedAt: AT + 60_000 });
    expect(findLiveProblem(db, a.key)).toBeNull();
    expect(findRecentResolved(db, a.key, AT)?.id).toBe(a.id);
    expect(findRecentResolved(db, a.key, AT + 120_000)).toBeNull();
    const b = insertProblem(db, base({ previousProblemId: a.id }));
    expect(b.seq).toBe(2);
    expect(b.previousProblemId).toBe(a.id);
  });

  it('stores evidence in order, keeps null as not measured, and replaces the bundle wholesale', () => {
    const db = createTestDb();
    const a = insertProblem(db, base({
      evidence: [
        { kind: 'metric', labelKey: 'Problems.evidence.cpu', values: {}, value: 96.2, unit: 'percent', at: AT },
        { kind: 'inventory', labelKey: 'Problems.evidence.tasks', values: {}, value: null, unit: null, at: AT },
      ],
    }));
    const stored = listEvidence(db, a.id);
    expect(stored.map((e) => e.position)).toEqual([0, 1]);
    expect(stored[1].value).toBeNull();
    replaceEvidence(db, a.id, [{ kind: 'check', labelKey: 'Problems.evidence.probe', values: {}, value: 1, unit: 'count', at: AT + 1 }]);
    expect(listEvidence(db, a.id)).toHaveLength(1);
  });

  it('pages on seq with the id as tiebreak, never on a mutable column', () => {
    const db = createTestDb();
    const rows = Array.from({ length: 5 }, (_, i) => insertProblem(db, base({ key: `k${i}`.padEnd(32, '0'), subjectId: `s${i}` })));
    // A later row is given a lower score: it must still come last.
    updateProblem(db, rows[4].id, { score: 1, severity: 'info', lastSeenAt: AT + 999 });
    const first = pageProblems(db, { connectionId: 'c1', scope: 'us-east-1' }, null, 2);
    expect(first.items.map((r) => r.subjectId)).toEqual(['s0', 's1']);
    expect(first.nextSeq).toBe(first.items[1].seq);
    const second = pageProblems(db, { connectionId: 'c1', scope: 'us-east-1' }, { afterSeq: first.nextSeq as number, afterId: first.nextId as string }, 2);
    expect(second.items.map((r) => r.subjectId)).toEqual(['s2', 's3']);
    const last = pageProblems(db, { connectionId: 'c1', scope: 'us-east-1' }, { afterSeq: second.nextSeq as number, afterId: second.nextId as string }, 2);
    expect(last.items.map((r) => r.subjectId)).toEqual(['s4']);
    expect(last.nextSeq).toBeNull();
  });

  it('hides grouped children and counts by severity', () => {
    const db = createTestDb();
    insertProblem(db, base({ key: 'a'.repeat(32), subjectId: 's1' }));
    const child = insertProblem(db, base({ key: 'b'.repeat(32), subjectId: 's2', severity: 'warning', score: 50 }));
    updateProblem(db, child.id, { grouped: true });
    const filter = { connectionId: 'c1', scope: 'us-east-1' } as const;
    expect(pageProblems(db, filter, null, 10).items).toHaveLength(1);
    expect(pageProblems(db, { ...filter, includeGrouped: true }, null, 10).items).toHaveLength(2);
    expect(countProblemsBySeverity(db, filter)).toEqual({ critical: 1, warning: 0, info: 0 });
  });

  it('deletes evidence with its problem', () => {
    const db = createTestDb();
    const a = insertProblem(db, base());
    db.$client.prepare('delete from problems where id = ?').run(a.id);
    expect(listEvidence(db, a.id)).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run it to see it fail.** `npx vitest run tests/unit/store-problems.test.ts` → FAIL: no module `@/lib/store/problems`.

- [x] **Step 3: Add the tables and generate the migration.** Edit `src/lib/db/schema.ts` with the block above, then run `npm run db:generate`. Expected: `drizzle/0002_*.sql` containing `CREATE TABLE \`problems\``, `CREATE TABLE \`problem_evidence\``, the partial unique index and the three ordinary indexes, plus an updated `drizzle/meta/_journal.json`. **Never hand-edit the generated SQL.** `createDb` runs `migrate()` on every open, so nothing else is needed. Read the generated file once to confirm it contains no `DROP` and no `ALTER … RENAME` — an additive migration only (§9.3).

- [x] **Step 4: Write `src/lib/store/tx.ts` and `src/lib/store/problems.ts`.** Both start with `import 'server-only';`. `insertProblem` runs the row insert and its evidence inside one `db.transaction`. `pageProblems` builds its `where` from the filter and ends with:

```ts
const rows = db.select().from(problems).where(and(...conditions))
  .orderBy(problems.seq, problems.id).limit(limit + 1).all();
const items = rows.slice(0, limit);
const more = rows.length > limit;
return { items, nextSeq: more ? items[items.length - 1].seq : null, nextId: more ? items[items.length - 1].id : null };
```

- [x] **Step 5: Run the tests.** `npx vitest run tests/unit/store-problems.test.ts` → PASS.

- [x] **Step 6: Add the boundary rules.** In `tests/unit/module-boundaries.test.ts`, add `'lib/store/tx.ts'` and `'lib/store/problems.ts'` to `SERVER_ONLY_MODULES`, and add the §9.6 test:

```ts
const STORE_ONLY = /^(better-sqlite3|drizzle-orm)/;
const STORE_DIRS = ['lib/db', 'lib/store'];

it('keeps SQL and better-sqlite3 below the store layer', () => {
  const offenders: string[] = [];
  for (const file of sourceFilesUnder('lib')) {
    const rel = path.relative(SRC, file);
    if (STORE_DIRS.some((dir) => rel.startsWith(dir + path.sep))) continue;
    const source = readSource(file);
    if (valueImports(source).some((s) => STORE_ONLY.test(s))) offenders.push(rel);
    if (source.includes('.$client')) offenders.push(rel);
  }
  expect(offenders).toEqual([]);
});
```

If `sourceFilesUnder` does not yet accept a bare directory name, extend `tests/helpers/source-graph.ts` so it walks any directory under `src/`; do not change its other behaviour.

- [x] **Step 7: Extend `tests/unit/db.test.ts`** with one case asserting the migration applied: insert a `problems` row through drizzle and read back `seq === 1` and `values` as an object (the JSON column round-trips).

- [x] **Step 8: Verify and commit.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`. Commit: `feat(store): problems and evidence with an immutable seq cursor`.

**Owner-only verification:** none — this task touches only SQLite.

---

### Task 2: The events spine and `collector_runs`

Implements §9.3's `events(id, at, connectionId?, scope?, kind, subjectType, subjectId, serviceId?, severity?, source, payload, dedupeKey?)` "indexed on `(at)`, `(serviceId, at)`, `(subjectId, at)`, unique on `dedupeKey` where not null" — "the append-only spine: activity, investigation facts, incident timelines, reports" — and the `collector_runs` half of §21's System status ("per job, the last run, its duration, what it covered, what a cap truncated").

**Files:**
- Create: `src/lib/store/events.ts`, `src/lib/store/collector.ts`
- Create: `tests/unit/store-events.test.ts`
- Modify: `src/lib/db/schema.ts`, `drizzle/0003_<generated>.sql`, `tests/unit/module-boundaries.test.ts`

**Interfaces:**
- Consumes: Task 1's `inBatches`, `MAX_ROWS_PER_TRANSACTION` from `@/lib/store/tx`; `Db` from `@/lib/db/client`; `randomId` from `@/lib/crypto`.
- Produces (`src/lib/db/schema.ts`):

```ts
export const EVENT_KINDS = [
  'problem_opened', 'problem_reopened', 'problem_acknowledged', 'problem_resolved',
  'problem_grouped', 'problem_ungrouped', 'fleet_opened', 'fleet_resolved',
  'resource_appeared', 'resource_disappeared', 'error_group_appeared', 'error_group_regressed',
  'collector_job_capped', 'collector_job_failed',
] as const;

export const events = sqliteTable('events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  at: integer('at').notNull(),
  connectionId: text('connection_id'),
  scope: text('scope'),
  kind: text('kind', { enum: EVENT_KINDS }).notNull(),
  subjectType: text('subject_type', { enum: SUBJECT_TYPES }).notNull(),
  subjectId: text('subject_id').notNull(),
  serviceId: text('service_id'),
  severity: text('severity', { enum: PROBLEM_SEVERITIES }),
  source: text('source').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, string | number | null>>().notNull(),
  dedupeKey: text('dedupe_key'),
}, (t) => [
  index('events_at').on(t.at),
  index('events_service_at').on(t.serviceId, t.at),
  index('events_subject_at').on(t.subjectId, t.at),
  uniqueIndex('events_dedupe').on(t.dedupeKey).where(sql`dedupe_key is not null`),
]);

export const COLLECTOR_RUN_STATUSES = ['running', 'ok', 'failed', 'skipped'] as const;

export const collectorRuns = sqliteTable('collector_runs', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  job: text('job').notNull(),
  connectionId: text('connection_id'),
  scope: text('scope'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status', { enum: COLLECTOR_RUN_STATUSES }).notNull(),
  covered: integer('covered'),
  total: integer('total'),
  truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
  errorCode: text('error_code'),
}, (t) => [index('collector_runs_job').on(t.job, t.startedAt)]);

export type EventRow = typeof events.$inferSelect;
export type CollectorRunRow = typeof collectorRuns.$inferSelect;
```

- Produces (`src/lib/store/events.ts`, server-only):
  - `export type NewEvent = Omit<EventRow, 'seq' | 'id'> & { id?: string };`
  - `export function appendEvent(db: Db, event: NewEvent): EventRow | null` — returns `null` when a `dedupeKey` already exists (the insert uses `onConflictDoNothing`). The caller never has to catch.
  - `export function appendEvents(db: Db, batch: readonly NewEvent[]): Promise<number>` — through `inBatches`.
  - `export function listEvents(db: Db, filter: { connectionId?: string; scope?: string; serviceId?: string; subjectId?: string; sinceMs?: number; untilMs?: number }, cursor: { afterSeq: number; afterId: string } | null, limit: number): SeqPage<EventRow>` — same `(seq, id)` ordering as Task 1.
  - `export function deleteEventsBefore(db: Db, beforeMs: number, kinds: readonly EventKind[]): number`
- Produces (`src/lib/store/collector.ts`, server-only — the lock half arrives in Task 3):
  - `export function startRun(db: Db, input: { job: string; connectionId: string | null; scope: string | null; startedAt: number }): CollectorRunRow`
  - `export function finishRun(db: Db, id: string, result: { finishedAt: number; status: 'ok' | 'failed' | 'skipped'; covered?: number | null; total?: number | null; truncated?: boolean; errorCode?: string | null }): void`
  - `export function lastRuns(db: Db, limit: number): CollectorRunRow[]` — newest first, for System status.
  - `export function deleteRunsBefore(db: Db, beforeMs: number): number`

- [x] **Step 1: Write the failing test.** Create `tests/unit/store-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { appendEvent, appendEvents, deleteEventsBefore, listEvents, type NewEvent } from '@/lib/store/events';
import { finishRun, lastRuns, startRun } from '@/lib/store/collector';
import { createTestDb } from '../helpers/db';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);
const event = (over: Partial<NewEvent> = {}): NewEvent => ({
  at: AT, connectionId: 'c1', scope: 'us-east-1', kind: 'problem_opened',
  subjectType: 'service', subjectId: 'prod/web', serviceId: 'prod/web',
  severity: 'critical', source: 'aws', payload: { problemId: 'p1' }, dedupeKey: null, ...over,
});

describe('the events spine', () => {
  it('appends, pages on seq and filters by subject and window', () => {
    const db = createTestDb();
    appendEvent(db, event({ subjectId: 'a' }));
    appendEvent(db, event({ subjectId: 'b', at: AT + 1000 }));
    appendEvent(db, event({ subjectId: 'a', at: AT + 2000, kind: 'problem_resolved' }));
    expect(listEvents(db, { subjectId: 'a' }, null, 10).items).toHaveLength(2);
    expect(listEvents(db, { sinceMs: AT + 500 }, null, 10).items).toHaveLength(2);
    const page = listEvents(db, {}, null, 2);
    expect(page.items.map((e) => e.seq)).toEqual([1, 2]);
    expect(listEvents(db, {}, { afterSeq: page.nextSeq as number, afterId: page.nextId as string }, 2).items.map((e) => e.seq)).toEqual([3]);
  });

  it('never writes the same dedupeKey twice, and says so by returning null', () => {
    const db = createTestDb();
    expect(appendEvent(db, event({ dedupeKey: 'd1' }))).not.toBeNull();
    expect(appendEvent(db, event({ dedupeKey: 'd1', at: AT + 5 }))).toBeNull();
    expect(listEvents(db, {}, null, 10).items).toHaveLength(1);
    // Two null dedupe keys are not a conflict: the index is partial.
    appendEvent(db, event());
    appendEvent(db, event());
    expect(listEvents(db, {}, null, 10).items).toHaveLength(3);
  });

  it('writes a large batch in bounded transactions', async () => {
    const db = createTestDb();
    const written = await appendEvents(db, Array.from({ length: 2500 }, (_, i) => event({ at: AT + i, subjectId: `s${i}` })));
    expect(written).toBe(2500);
    expect(listEvents(db, {}, null, 1).items[0].seq).toBe(1);
  });

  it('purges only the kinds it is asked for', () => {
    const db = createTestDb();
    appendEvent(db, event({ at: AT, kind: 'resource_appeared' }));
    appendEvent(db, event({ at: AT, kind: 'problem_opened' }));
    expect(deleteEventsBefore(db, AT + 1, ['resource_appeared'])).toBe(1);
    expect(listEvents(db, {}, null, 10).items.map((e) => e.kind)).toEqual(['problem_opened']);
  });
});

describe('collector runs', () => {
  it('records what a job covered and what a cap truncated', () => {
    const db = createTestDb();
    const run = startRun(db, { job: 'inventory', connectionId: 'c1', scope: 'us-east-1', startedAt: AT });
    expect(run.status).toBe('running');
    finishRun(db, run.id, { finishedAt: AT + 2000, status: 'ok', covered: 40, total: 60, truncated: true });
    const [latest] = lastRuns(db, 10);
    expect({ status: latest.status, covered: latest.covered, total: latest.total, truncated: latest.truncated })
      .toEqual({ status: 'ok', covered: 40, total: 60, truncated: true });
    expect((latest.finishedAt as number) - latest.startedAt).toBe(2000);
  });
});
```

- [x] **Step 2: Run it to see it fail.** `npx vitest run tests/unit/store-events.test.ts` → FAIL.
- [x] **Step 3: Add both tables and generate the migration.** `npm run db:generate` → `drizzle/0003_*.sql`. Confirm additive-only.
- [x] **Step 4: Write both modules.**
- [x] **Step 5: Run the test** → PASS.
- [x] **Step 6: Add `'lib/store/events.ts'` and `'lib/store/collector.ts'` to `SERVER_ONLY_MODULES`.**
- [x] **Step 7: Verify and commit.** Full gate. Commit: `feat(store): the append-only events spine and collector runs`.

---

### Task 3: The collector lock, claimed atomically

Implements §33.4 verbatim: "Acquisition is a single conditional update — `UPDATE collector_lock SET owner = ?, heartbeat_at = ? WHERE id = 1 AND (heartbeat_at < ? OR owner = ?)` — and the caller proceeds only if it changed exactly one row. The heartbeat refresh carries `AND owner = ?` so a process that lost the lock while paused cannot resurrect it; a refresh that changes no row aborts the cycle in progress. A test starts two claimers against the same database and asserts exactly one wins and the loser runs nothing." It supersedes §9.2's read-then-write description.

**Files:**
- Modify: `src/lib/store/collector.ts`, `src/lib/db/schema.ts`
- Create: `drizzle/0004_<generated>.sql`, `tests/unit/store-lock.test.ts`

**Interfaces:**
- Consumes: `Db` from `@/lib/db/client`; `sql` from `drizzle-orm`.
- Produces (`src/lib/db/schema.ts`):

```ts
/** Exactly one row, id = 1. Seeded by the first claim, never by a migration. */
export const collectorLock = sqliteTable('collector_lock', {
  id: integer('id').primaryKey(),
  owner: text('owner').notNull(),
  heartbeatAt: integer('heartbeat_at').notNull(),
});
export type CollectorLockRow = typeof collectorLock.$inferSelect;
```

- Produces (`src/lib/store/collector.ts`):
  - `export const COLLECTOR_LOCK_ID = 1;`
  - `export const LOCK_STALE_MS = 90_000;`
  - `export const LOCK_HEARTBEAT_MS = 30_000;`
  - `export function claimCollectorLock(db: Db, owner: string, nowMs: number): boolean`
  - `export function refreshCollectorLock(db: Db, owner: string, nowMs: number): boolean`
  - `export function releaseCollectorLock(db: Db, owner: string): void`
  - `export function readCollectorLock(db: Db): CollectorLockRow | null` — for System status only.

**The implementation, written here because it is the whole point of the task:**

```ts
export function claimCollectorLock(db: Db, owner: string, nowMs: number): boolean {
  // The seed and the claim are one statement: ON CONFLICT makes the first caller on a fresh
  // database take the lock and every later caller fall through to the same conditional update.
  const result = db.run(sql`
    insert into collector_lock (id, owner, heartbeat_at)
    values (${COLLECTOR_LOCK_ID}, ${owner}, ${nowMs})
    on conflict(id) do update set owner = ${owner}, heartbeat_at = ${nowMs}
      where collector_lock.heartbeat_at < ${nowMs - LOCK_STALE_MS} or collector_lock.owner = ${owner}
  `);
  return result.changes === 1;
}

export function refreshCollectorLock(db: Db, owner: string, nowMs: number): boolean {
  const result = db.run(sql`
    update collector_lock set heartbeat_at = ${nowMs}
    where id = ${COLLECTOR_LOCK_ID} and owner = ${owner}
  `);
  return result.changes === 1;
}
```

`owner` is `${process.pid}:${randomId()}`, generated once per process by Task 9 and never derived from anything a user can set.

- [x] **Step 1: Write the failing test.** Create `tests/unit/store-lock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  LOCK_STALE_MS, claimCollectorLock, readCollectorLock, refreshCollectorLock, releaseCollectorLock,
} from '@/lib/store/collector';
import { createTestDb } from '../helpers/db';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);

describe('the collector lock', () => {
  it('is won by exactly one of two claimers, and the loser runs nothing', () => {
    const db = createTestDb();
    const ran: string[] = [];
    for (const owner of ['a', 'b']) {
      if (claimCollectorLock(db, owner, AT)) ran.push(owner);
    }
    expect(ran).toEqual(['a']);
    expect(readCollectorLock(db)?.owner).toBe('a');
  });

  it('lets the holder re-claim and refresh its own lock', () => {
    const db = createTestDb();
    expect(claimCollectorLock(db, 'a', AT)).toBe(true);
    expect(claimCollectorLock(db, 'a', AT + 1000)).toBe(true);
    expect(refreshCollectorLock(db, 'a', AT + 2000)).toBe(true);
    expect(readCollectorLock(db)?.heartbeatAt).toBe(AT + 2000);
  });

  it('passes to another process only once the heartbeat is older than 90 seconds', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    expect(claimCollectorLock(db, 'b', AT + LOCK_STALE_MS)).toBe(false);
    expect(claimCollectorLock(db, 'b', AT + LOCK_STALE_MS + 1)).toBe(true);
    expect(readCollectorLock(db)?.owner).toBe('b');
  });

  it('refuses the refresh of a process that lost the lock while paused', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    claimCollectorLock(db, 'b', AT + LOCK_STALE_MS + 1);
    // 'a' wakes up believing it still holds the lock: the refresh must change no row.
    expect(refreshCollectorLock(db, 'a', AT + LOCK_STALE_MS + 2)).toBe(false);
    expect(readCollectorLock(db)?.owner).toBe('b');
  });

  it('releases only its own lock', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'a', AT);
    releaseCollectorLock(db, 'b');
    expect(readCollectorLock(db)?.owner).toBe('a');
    releaseCollectorLock(db, 'a');
    expect(claimCollectorLock(db, 'b', AT + 1)).toBe(true);
  });
});
```

- [x] **Step 2: Run it to see it fail.** `npx vitest run tests/unit/store-lock.test.ts` → FAIL.
- [x] **Step 3: Add the table, generate `drizzle/0004_*.sql`, and write the three statements above.** `releaseCollectorLock` sets `heartbeat_at = 0 where id = 1 and owner = ?`, which frees it without deleting the row.
- [x] **Step 4: Run the test** → PASS.
- [x] **Step 5: Verify and commit.** Full gate. Commit: `feat(store): claim the collector lock in one conditional update`.

**Note for the implementer:** do not "improve" this with a read followed by a write. §33.4 exists because that version loses the race, and the second test above is the one that catches it.

> **Correction, found while implementing.** The five cases above do **not** catch it: they run two claimers one after the other in one process, and with a synchronous driver a read-then-write claim passes all five. Verified by mutation. Task 3 therefore adds a group that asserts the claim issues exactly one statement and reads nothing first, which is what §33.4 actually requires; that group fails the mutation.

---

### Task 4: Incidents, the timeline, and retention

Implements §4.8 (the Incident object), §16's timeline, and §33.2's retention rule: "resolved problems are kept 30 days, then deleted". Incident *logic* — the auto-creation rules of §16 — belongs to mission phase 5; phase 1 ships the live state §33.2 says is "always on… not a storage-provider concern", so that the timeline has somewhere to land and the Problem can point at an incident.

**Files:**
- Create: `src/lib/store/incidents.ts`, `src/lib/store/retention.ts`
- Create: `tests/unit/store-incidents.test.ts`, `tests/unit/store-retention.test.ts`
- Modify: `src/lib/db/schema.ts`, `drizzle/0005_<generated>.sql`, `tests/unit/module-boundaries.test.ts`

**Interfaces:**
- Consumes: `appendEvent`, `deleteEventsBefore` from `@/lib/store/events`; `Db`; `randomId`.
- Produces (`src/lib/db/schema.ts`):

```ts
export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;

export const incidents = sqliteTable('incidents', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  connectionId: text('connection_id').notNull(),
  scope: text('scope').notNull(),
  titleKey: text('title_key').notNull(),
  values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
  status: text('status', { enum: INCIDENT_STATUSES }).notNull(),
  severity: text('severity', { enum: PROBLEM_SEVERITIES }).notNull(),
  startedAt: integer('started_at').notNull(),
  resolvedAt: integer('resolved_at'),
  serviceIds: text('service_ids', { mode: 'json' }).$type<string[]>().notNull(),
  origin: text('origin', { enum: ['auto', 'user'] as const }).notNull(),
  dismissedAt: integer('dismissed_at'),
}, (t) => [index('incidents_env_seq').on(t.connectionId, t.scope, t.seq)]);

export const INCIDENT_TIMELINE_KINDS = ['status_change', 'event', 'note'] as const;

export const incidentTimeline = sqliteTable('incident_timeline', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  at: integer('at').notNull(),
  kind: text('kind', { enum: INCIDENT_TIMELINE_KINDS }).notNull(),
  eventId: text('event_id'),
  actorId: text('actor_id'),
  messageKey: text('message_key'),
  values: text('values', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
  note: text('note'),
}, (t) => [index('incident_timeline_incident').on(t.incidentId, t.at)]);

export type IncidentRow = typeof incidents.$inferSelect;
export type IncidentTimelineRow = typeof incidentTimeline.$inferSelect;
```

There is **no** `incident_problems` join table: a problem belongs to at most one incident, and `problems.incident_id` from Task 1 already carries it. §4.8's `problemIds[]` is read back through that column.

- Produces (`src/lib/store/incidents.ts`, server-only):
  - `export function openIncident(db: Db, input: { connectionId; scope; titleKey; values; severity; startedAt; serviceIds: string[]; origin: 'auto' | 'user' }): IncidentRow`
  - `export function attachProblem(db: Db, incidentId: string, problemId: string): void` — sets `problems.incident_id` and appends a `status_change`-free `event` timeline row.
  - `export function incidentProblemIds(db: Db, incidentId: string): string[]`
  - `export function appendTimeline(db: Db, input: { incidentId; at; kind; eventId?; actorId?; messageKey?; values?; note? }): IncidentTimelineRow`
  - `export function setIncidentStatus(db: Db, id: string, status: IncidentStatus, at: number, actorId: string | null): IncidentRow`
  - `export function dismissIncident(db: Db, id: string, at: number, actorId: string): IncidentRow`
  - `export function findIncident(db: Db, id: string): IncidentRow | null`
  - `export function listTimeline(db: Db, incidentId: string): IncidentTimelineRow[]` — "all timestamped, newest last" (§16).
- Produces (`src/lib/store/retention.ts`, server-only):
  - `export const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60_000;`
  - `export const OBSERVATION_EVENT_RETENTION_MS = 90 * 24 * 60 * 60_000;`
  - `export const LIFECYCLE_EVENT_RETENTION_MS = 396 * 24 * 60 * 60_000;`  // 13 months (§9.4)
  - `export const OBSERVATION_EVENT_KINDS = ['resource_appeared', 'resource_disappeared', 'collector_job_capped', 'collector_job_failed'] as const;`
  - `export type RetentionReport = { resolvedProblems: number; observationEvents: number; lifecycleEvents: number; collectorRuns: number };`
  - `export function runRetention(db: Db, nowMs: number): RetentionReport`

`runRetention` deletes resolved problems whose `resolvedAt < nowMs - RESOLVED_RETENTION_MS` (their evidence follows by `on delete cascade`), then the two event families at their own windows, then collector runs older than 30 days. It never deletes an incident: §9.4 keeps incidents "with an admin purge", and no admin purge exists in phase 1.

- [x] **Step 1: Write the failing tests.** `tests/unit/store-incidents.test.ts` asserts: an incident opens with `status: 'investigating'` and the given severity; `attachProblem` sets `problems.incident_id` and `incidentProblemIds` reads it back; `setIncidentStatus` appends a `status_change` row and stamps `resolvedAt` only for `'resolved'`; `listTimeline` returns rows oldest first; deleting the incident cascades its timeline. `tests/unit/store-retention.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { insertProblem, pageProblems, updateProblem } from '@/lib/store/problems';
import { appendEvent, listEvents } from '@/lib/store/events';
import { RESOLVED_RETENTION_MS, runRetention } from '@/lib/store/retention';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const AT = Date.UTC(2026, 8, 19, 9, 0, 0);

describe('retention', () => {
  it('keeps a resolved problem for 30 days and then deletes it with its evidence', () => {
    const db = createTestDb();
    const old = insertProblem(db, newProblem({ key: 'a'.repeat(32) }));
    const fresh = insertProblem(db, newProblem({ key: 'b'.repeat(32), subjectId: 's2' }));
    updateProblem(db, old.id, { status: 'resolved', resolvedAt: AT });
    updateProblem(db, fresh.id, { status: 'resolved', resolvedAt: AT + 1 });
    const report = runRetention(db, AT + RESOLVED_RETENTION_MS + 1);
    expect(report.resolvedProblems).toBe(1);
    const left = pageProblems(db, { connectionId: 'c1', scope: 'us-east-1', status: ['resolved'] }, null, 10).items;
    expect(left.map((p) => p.id)).toEqual([fresh.id]);
    expect(db.$client.prepare('select count(*) as n from problem_evidence').get()).toEqual({ n: 1 });
  });

  it('never deletes an open problem, however old', () => {
    const db = createTestDb();
    insertProblem(db, newProblem({ firstSeenAt: 0, lastSeenAt: 0 }));
    expect(runRetention(db, AT + RESOLVED_RETENTION_MS * 10).resolvedProblems).toBe(0);
  });

  it('purges observation events at 90 days and lifecycle events at 13 months', () => {
    const db = createTestDb();
    appendEvent(db, { at: AT, connectionId: 'c1', scope: 'us-east-1', kind: 'resource_appeared', subjectType: 'resource', subjectId: 'r1', serviceId: null, severity: null, source: 'aws', payload: {}, dedupeKey: null });
    appendEvent(db, { at: AT, connectionId: 'c1', scope: 'us-east-1', kind: 'problem_opened', subjectType: 'service', subjectId: 's1', serviceId: null, severity: 'critical', source: 'aws', payload: {}, dedupeKey: null });
    const report = runRetention(db, AT + 91 * 24 * 60 * 60_000);
    expect({ obs: report.observationEvents, life: report.lifecycleEvents }).toEqual({ obs: 1, life: 0 });
    expect(listEvents(db, {}, null, 10).items.map((e) => e.kind)).toEqual(['problem_opened']);
  });
});
```

- [x] **Step 2: Create `tests/helpers/detect.ts`** with the fixture builders every later task reuses, so no test repeats a twenty-line literal:

```ts
import type { NewProblem } from '@/lib/store/problems';

export const FIXED_NOW = Date.UTC(2026, 8, 19, 9, 0, 0);

export function newProblem(over: Partial<NewProblem> = {}): NewProblem {
  return {
    key: 'k'.repeat(32), connectionId: 'c1', scope: 'us-east-1', kind: 'ecs_cpu_high',
    subjectType: 'service', subjectId: 'prod/web', subjectName: 'web', serviceId: 'prod/web',
    source: 'aws', titleKey: 'Insights.messages.ecs_cpu_high', values: { service: 'web', value: 96 },
    severity: 'critical', score: 82,
    scoreTerms: { s: 1, b: 0.5, t: 1, u: 1, d: 0, weights: { s: 40, b: 20, t: 15, u: 15, d: 10 }, availableWeight: 100, rescaled: false, floored: false, score: 82 },
    href: '/c/c1/us-east-1/containers/services/prod/web',
    firstSeenAt: FIXED_NOW, lastSeenAt: FIXED_NOW, lastEvaluatedAt: FIXED_NOW, previousProblemId: null,
    evidence: [{ kind: 'metric', labelKey: 'Problems.evidence.cpu', values: {}, value: 96.2, unit: 'percent', at: FIXED_NOW }],
    ...over,
  };
}
```

Then simplify `tests/unit/store-problems.test.ts` from Task 1 to import `newProblem` instead of its local `base`, keeping every assertion identical.

- [x] **Step 3: Run both tests to see them fail.** → FAIL.
- [x] **Step 4: Add both tables, generate `drizzle/0005_*.sql`, write both modules.**
- [x] **Step 5: Run the tests** → PASS.
- [x] **Step 6: Add `'lib/store/incidents.ts'` and `'lib/store/retention.ts'` to `SERVER_ONLY_MODULES`.**
- [x] **Step 7: Verify and commit.** Full gate. Commit: `feat(store): incidents, their timeline, and the 30-day resolved-problem rule`.

---

## Phase 2 — The Problem engine

> **Derived 2026-09-20 from the spec**, because the plan as written stopped after Task 4. Each task below cites
> the sections it implements, and is written into this file *before* it is implemented so a lost session leaves
> the derived task behind. The Task index above, `## File Structure` and `## Decisions fixed once` still govern.

### Task 5: Identity and the severity score

Implements §4.3's deterministic grouping and severity score, and §33.7's ruling on fresh subjects and floors.

**Files:**
- Create: `src/lib/detect/key.ts`, `src/lib/detect/score.ts`
- Create: `tests/unit/detect-key.test.ts`, `tests/unit/detect-score.test.ts`
- Modify: `src/lib/crypto.ts` (add `sha256Hex`), `tests/unit/module-boundaries.test.ts`

**The purity rule this task establishes.** `src/lib/detect/**` is pure: no AWS, no clock, no database. In
particular it **must not import `@/lib/db/schema`** — the store converts between the detector's vocabulary and
the row. So `key.ts` declares `SUBJECT_KINDS` itself, and `tests/unit/detect-key.test.ts` asserts it matches
`SUBJECT_TYPES` in the schema, which keeps the two from drifting without making `detect` depend on storage.

**Interfaces:**
- Produces (`src/lib/crypto.ts`): `export function sha256Hex(value: string): string`
- Produces (`src/lib/detect/key.ts`):
  - `export const PROBLEM_KEY_LENGTH = 32;`
  - `export const SUBJECT_KINDS = ['service','resource','cluster','error_group','synthetic','integration'] as const;`
  - `export type SubjectKind = (typeof SUBJECT_KINDS)[number];`
  - `export function problemKey(parts: { connectionId: string; scope: string; kind: string; subjectId: string }): string`
    — `sha256(connectionId + '|' + scope + '|' + kind + '|' + subjectId)` truncated to 32 hex characters.
    **Nothing else enters the key** — not the value, not the timestamp, not the message — so the same problem
    stays one row for its whole life (§4.3).
    **Deviation, found while implementing:** §4.3 writes the key as a plain `'|'` join, which collides —
    `kind='a|b', subjectId='c'` and `kind='a', subjectId='b|c'` produce the same string and would merge two
    unrelated subjects into one problem row. The parts are therefore length-prefixed (`2:c1|9:us-east-1|…`)
    before hashing. Same four inputs, same determinism, no collision.
- Produces (`src/lib/detect/score.ts`):
  - `SCORE_WEIGHTS`, `LEVEL_S`, `NO_FAMILY_B`, `FRESH_SUBJECT_MS`, `CRITICAL_SCORE`, `WARNING_SCORE` per **D3**.
  - `export type ScoreInput = { level; blast: { affected: number; members: number } | null; minutesBreaching: number; userFacing: 'direct' | 'dependency' | 'none' | null; robustZ: number | null; subjectFirstSeenAt: number; nowMs: number; totalFailure?: boolean; floorCritical?: boolean };`
  - `export function scoreProblem(input: ScoreInput): ScoreTerms` — the five terms, the weight actually
    available, whether it was rescaled, whether a floor applied, and the score.
  - `export function severityForScore(score: number): 'critical' | 'warning' | 'info'` — `≥ 70`, `40…69`, `< 40`.

**The formula, and the two rulings that bend it.**

```
score = round( (40·S + 20·B + 15·T + 15·U + 10·D) / availableWeight × 100 )   clamped 0…100
```

- `S` the detector's level: critical 1.0, warning 0.55, info 0.2.
- `B` blast radius: `affected ÷ members`. A subject with no family: `NO_FAMILY_B` (0.34).
- `T` persistence: `min(1, minutesBreaching / 60)`.
- `U` user-facing: 1.0 direct, 0.5 a dependency of one (§17), 0 otherwise.
- `D` deviation: `min(1, |robustZ| / 6)`; **0 when there is no baseline** — `D` is zero-filled, never dropped.

**§33.7, first half — absence of evidence is not evidence of absence.** When a subject has no dependency edge
(`userFacing === null`) **and** was first seen less than `FRESH_SUBJECT_MS` ago, `U` and `B` are *not*
zero-filled: they are left out, `availableWeight` drops to the weight of the terms actually known, and the
score is rescaled over it. A service that fails minutes after its first deploy is then judged on what can be
measured rather than punished for what cannot. `rescaled` records that this happened.

**§33.7, second half — floors.** A detector reporting critical on a subject whose failure is total (zero
running tasks, zero healthy targets, every request failing) produces **at least `CRITICAL_SCORE`** whatever the
formula says. The existing floors — zero healthy targets, synthetic down, certificate under seven days — pass
`floorCritical`. `floored` records that a floor raised the score. Each floor gets a test with the worked
example that produced it.

- [x] **Step 1: Write the failing tests.** `tests/unit/detect-key.test.ts` asserts: the key is 32 lowercase hex
  characters; it is stable across calls and across processes for the same four parts; changing any one of the
  four parts changes it; a value, a timestamp or a message does **not** enter it (same parts, different
  evidence → same key); `SUBJECT_KINDS` equals the schema's `SUBJECT_TYPES`.
  `tests/unit/detect-score.test.ts` asserts the worked examples below.
- [x] **Step 2: Run them to see them fail.** → FAIL.
- [x] **Step 3: Add `sha256Hex`, write `key.ts` and `score.ts`.**
- [x] **Step 4: Run the tests** → PASS.
- [x] **Step 5: Add `'lib/detect/key.ts'` and `'lib/detect/score.ts'` to `SERVER_ONLY_MODULES`**, and assert in
  `module-boundaries.test.ts` that nothing under `lib/detect/` imports `@/lib/db/schema`, `drizzle-orm`,
  `better-sqlite3`, `@aws-sdk/*` or `node:` — the purity rule, enforced rather than promised.
- [x] **Step 6: Verify and commit.** Full gate. Commit: `feat(detect): the problem key and the severity score`.

**Worked examples the tests pin.**

| Case | Terms | Expected |
|---|---|---|
| A sustained critical on a wholly-broken user-facing service, no baseline | S=1, B=1, T=1, U=1, D=0 | 90, critical |
| §33.7's regression: user-facing service failing 5 minutes after its first deploy, no dependency edge, no family, no baseline | S=1, T=0.083, D=0, B and U unavailable | rescaled over 65; ≈ 63 → warning **unless** the detector declares total failure, which floors it at 70 → critical |
| An info detector, small blast, brief, not user-facing, no baseline | S=0.2, B=0.1, T=0.05, U=0, D=0 | 11, info |
| A synthetic down | floorCritical | ≥ 70, `floored: true` |

### Task 6: The detector framework, outcomes and lifecycle

Implements §5 (a detector is a pure function returning problems), §4.3's lifecycle, and **§33.5** (auto-resolve
requires evaluated-and-clear, not silence).

**Files:**
- Create: `src/lib/detect/types.ts`, `src/lib/detect/framework.ts`, `src/lib/detect/lifecycle.ts`
- Create: `tests/unit/detect-framework.test.ts`, `tests/unit/detect-lifecycle.test.ts`
- Modify: `tests/unit/module-boundaries.test.ts`, `tests/helpers/detect.ts`

**The shape of the layer.** `detect` stays pure, so `lifecycle.ts` never touches the database: it is handed the
live problems as a plain projection (`LiveProblem`, *not* a `ProblemRow` — importing the schema is forbidden),
plus this cycle's outcomes and `nowMs`, and it answers a list of **transitions** the store then applies. That
separation is what lets every rule below be tested with literals and no fixture database.

**Interfaces:**
- Produces (`src/lib/detect/types.ts`):
  - `EVIDENCE_KINDS`, `EvidenceKind` — `'metric'|'event'|'log'|'check'|'inventory'` (the *stored* kinds; the
    wire kind is always `'fact'` in phase 1, per **D1**). Declared here, matching the schema, same rule as
    `SUBJECT_KINDS`.
  - `export type Evidence = { kind; labelKey; values; value: number | null; unit: string | null; at: number; seriesRef?; href? }`
    — §4.3: "a problem with no evidence cannot be created; the type makes the field required".
  - `export type SubjectRef = { type: SubjectKind; id: string; name: string; serviceId: string | null }`
  - `export type DetectedProblem` — what a detector returns: the subject, the detector `kind`, its `level`, the
    `titleKey`/`values` to render, the `href`, the required `evidence`, and the score inputs §4.3 needs
    (`blast`, `minutesBreaching`, `userFacing`, `robustZ`, `totalFailure?`, `floorCritical?`).
  - `export type SubjectOutcome` — **§33.5's three outcomes**, one per subject per detector:
    `{ state: 'fired'; problem }` · `{ state: 'clear'; kind; subject }` · `{ state: 'not_evaluated'; kind; subject }`.
- Produces (`src/lib/detect/framework.ts`):
  - `export type Detector = { id: string; evaluate: (input: DetectorInput) => SubjectOutcome[] }`
  - `export type DetectorCycle = { at: number; outcomes: SubjectOutcome[] }`
  - `export function runDetectors(detectors: readonly Detector[], input: DetectorInput): DetectorCycle` — runs
    each detector, tags every outcome with the detector that produced it, and **isolates failure**: a detector
    that throws yields `not_evaluated` for the subjects it was given rather than aborting the cycle, because
    one broken rule must not stop the other nine from reporting.
- Produces (`src/lib/detect/lifecycle.ts`):
  - `CLEAR_EVALUATIONS` 3 · `CLEAR_MIN_MS` 15 min · `REOPEN_WINDOW_MS` 2 h · `STALE_AFTER_MS` 1 h (**D3**).
  - `export type LiveProblem = { id; key; status; firstSeenAt; lastSeenAt; lastEvaluatedAt; clearStreak; clearSinceAt: number | null; occurrences; flapCount; resolvedAt: number | null }`
  - `export type Transition` — a discriminated union the store applies verbatim:
    `open` · `reopen` · `supersede` (a new row carrying `previousProblemId`) · `touch` (still firing) ·
    `progress_clear` (evaluated-and-clear, not yet enough) · `resolve` · `reset_clear` (fired again before
    clearing completed).
  - `export function applyCycle(input: { live: readonly LiveProblem[]; resolvedInWindow: readonly LiveProblem[]; cycle: DetectorCycle; nowMs: number }): Transition[]`
  - `export function isStale(problem: LiveProblem, nowMs: number): boolean` — `nowMs - lastEvaluatedAt > STALE_AFTER_MS`.

**The rules, stated once.**

1. **Fired, no live row.** If a row for the key was resolved within `REOPEN_WINDOW_MS` → `reopen` that row and
   increment `flapCount`; `firstSeenAt` and the occurrence count survive. Otherwise → `open`, or `supersede`
   carrying `previousProblemId` when an older resolved row for the key exists beyond the window.
2. **Fired, live row.** → `touch`: `lastSeenAt`, `lastEvaluatedAt`, `occurrences + 1`, the new score and
   evidence. If the row had a clear streak it is reset — `reset_clear` — because clearing must be *consecutive*.
3. **Evaluated-and-clear, live row.** → `progress_clear`: `clearStreak + 1`, and `clearSinceAt` set on the
   first one. It becomes `resolve` only when **both** `clearStreak + 1 >= CLEAR_EVALUATIONS` **and**
   `nowMs - clearSinceAt >= CLEAR_MIN_MS`. Three fast cycles inside one minute do not resolve anything.
4. **Not-evaluated.** → **no transition at all.** It resets nothing and counts toward nothing (§33.5). The row's
   `lastEvaluatedAt` is deliberately *not* touched, which is what later makes it read as stale.
5. **Stale.** A live problem whose subject has not been evaluated for `STALE_AFTER_MS` is reported stale by
   `isStale` and is **never** auto-resolved: "a monitoring tool that quietly closes what it stopped looking at
   is worse than one that admits the gap."
6. **Acknowledged** rows follow every rule above unchanged — acknowledgement silences, it does not freeze.

- [x] **Step 1: Write the failing tests.** `tests/unit/detect-framework.test.ts` covers: outcomes are tagged
  with their detector; a throwing detector yields `not_evaluated` and the others still run; an empty detector
  list yields an empty cycle. `tests/unit/detect-lifecycle.test.ts` covers each rule above, and in particular
  §33.5's regression: **three `not_evaluated` cycles in a row resolve nothing**, while three
  evaluated-and-clear cycles spanning 15 minutes do.
- [x] **Step 2: Run them to see them fail.** → FAIL.
- [x] **Step 3: Write the three modules.**
- [x] **Step 4: Run the tests** → PASS.
- [x] **Step 5: Add the three files to `SERVER_ONLY_MODULES`**; the purity rule from Task 5 covers them already.
- [x] **Step 6: Verify and commit.** Full gate. Commit: `feat(detect): outcomes, the detector framework and the problem lifecycle`.

### Task 7: Fleet collapse and expansion, as lifecycle transitions

Implements **§33.8**: "more than three services of one cluster breaching the same detector collapse into one
problem whose `subjectId` is the cluster" — and the ruling that collapse and expansion are *lifecycle
transitions, not rendering*.

**Files:**
- Create: `src/lib/detect/fleet.ts`, `tests/unit/detect-fleet.test.ts`
- Modify: `tests/unit/module-boundaries.test.ts`

**Interfaces:**
- `FLEET_MIN_MEMBERS` 4 · `FLEET_EXPAND_CYCLES` 2 (**D3**).
- `export type FleetGroup = { clusterId: string; kind: string; breaching: readonly string[] }` — the problem
  ids currently breaching one detector in one cluster, as the store found them.
- `export type OpenFleet = { id: string; key: string; clusterId: string; kind: string; memberIds: readonly string[]; belowCycles: number }`
- `export type FleetTransition` — `fleet_open` · `fleet_members` (the membership changed while it stays open) ·
  `fleet_hold` (below the threshold, but not for long enough) · `fleet_resolve` (resolve and un-group).
- `export function planFleet(input: { connectionId; scope; groups: readonly FleetGroup[]; open: readonly OpenFleet[]; nowMs }): FleetTransition[]`

**The rules.**

1. **Four or more breaching, no open fleet** → `fleet_open`. Its dedupe key is an ordinary problem key whose
   `subjectId` is the **cluster**, so it cannot collide with any per-service key. The children are **linked and
   marked grouped, never resolved** — they keep accruing evidence, and the list shows the fleet and hides them
   behind it.
2. **Four or more, fleet already open** → `fleet_members` when the membership changed, and `belowCycles` resets
   to 0. A service that joins a cluster-wide outage late is a member like any other.
3. **Three or fewer, fleet open** → `belowCycles + 1`. Only when it reaches `FLEET_EXPAND_CYCLES` does
   `fleet_resolve` fire; until then `fleet_hold`. This is the hysteresis: a fleet oscillating around the
   boundary must not flap.
4. **`fleet_resolve`** resolves the fleet problem and un-groups every child. Because the children were never
   closed, their `firstSeenAt`, occurrence counts and acknowledgements survive intact.
5. **Three or fewer, no open fleet** → nothing at all.

**Acknowledgement** (applied by the store, stated here because it belongs to the rule): an acknowledgement on
the fleet applies to its current children *and to any that join while it is open*; an acknowledgement on a
child does **not** silence the fleet.

- [x] **Step 1: Write the failing test.** `tests/unit/detect-fleet.test.ts` covers each rule, the boundary at
  exactly three and exactly four, the hysteresis needing two consecutive cycles, membership changing while
  open, and that the fleet key differs from every per-service key.
- [x] **Step 2: Run it to see it fail.** → FAIL.
- [x] **Step 3: Write `fleet.ts`.**
- [x] **Step 4: Run the test** → PASS.
- [x] **Step 5: Add `'lib/detect/fleet.ts'` to `SERVER_ONLY_MODULES`.**
- [x] **Step 6: Verify and commit.** Full gate. Commit: `feat(detect): fleet collapse and expansion with hysteresis`.

### Task 8: The first detectors, over the Stage 2 rules

Implements §5: "The Stage 2 insight rules become detectors unchanged — same thresholds, same hysteresis
(`evaluate.ts`, three consecutive datapoints, clearing margin) — and gain persistence."

**Files:**
- Create: `src/lib/detect/aws.ts`, `tests/unit/detect-aws.test.ts`
- Modify: `tests/unit/module-boundaries.test.ts`

**The rules are not rewritten.** `src/lib/monitoring/insights.ts` keeps its thresholds, its hysteresis and its
catalogue keys exactly as they are; this task is an **adapter** from `Insight[]` to `SubjectOutcome[]`. Copying
the rules into `detect` would have given the product two sets of thresholds to keep in step, which §24 and the
duplication rule both forbid. `Insight` is imported as a **type only** — it is a plain data shape (severity,
kind, resource, messageKey, values, href, members) with no AWS in it, and the import is erased at runtime, so
`detect` stays pure.

**The one behaviour that changes, and why.** Stage 2 collapses four or more services of a cluster into a single
grouped insight carrying `members[]` — a *rendering* collapse. §33.8 rules that collapse is a **lifecycle
transition**, and requires the children to keep accruing evidence and to keep their `firstSeenAt`, occurrence
counts and acknowledgements. A grouped insight is therefore **expanded back into one outcome per member**, so
each service gets its own problem, and Task 7's `planFleet` performs the collapse at the problem level. Without
this, the children §33.8 talks about would never exist.

**Interfaces:**
- `export function outcomesFromInsights(input: { insights; evaluated; notEvaluated?; nowMs; breachingMinutes? }): SubjectOutcome[]`
  - `evaluated` — every `(subject, kinds)` pair the cycle actually looked at. A pair that was evaluated and
    produced no insight yields **`clear`**; a pair in `notEvaluated` yields **`not_evaluated`**. §33.5 depends
    entirely on the caller telling these apart, so the adapter never infers one from the absence of the other.
  - `breachingMinutes?: (kind, subjectId) => number | undefined` — persistence, which a Stage 2 insight does not
    carry. Task 10 supplies it from the live problem's `firstSeenAt`; until then it defaults to the rules' own
    evaluation window.
- Subject typing: `ecs_*` → `service` (the resource *is* the service id, so `serviceId` is set); `rds_*`,
  `aurora_replica_lag`, `alb_*` and `alarm_firing` → `resource`.
- Score inputs are filled only where the insight actually knows them, and are `null` otherwise — `blast` when
  the insight carries both an affected and a total (`aurora_replica_lag` carries `lagging`/`readers`),
  `userFacing` `null` until §17's dependency map exists, `robustZ` `null` until §8's baselines exist. Guessing
  any of them would be exactly the zero-filling §33.7 forbids.
- **Floors.** `alb_unhealthy_hosts` with zero healthy targets is one of §4.3's three named floors, and zero
  running tasks is §33.7's total failure; both are read from the insight's own values, never assumed.

- [x] **Step 1: Write the failing test.** `tests/unit/detect-aws.test.ts` covers: every `InsightKind` maps to a
  subject kind; a grouped insight expands into one outcome per member and never yields a cluster-subject
  outcome; evaluated-but-silent yields `clear`; `notEvaluated` yields `not_evaluated` and is never inferred;
  evidence is non-empty and carries the insight's own catalogue key; the two floors; unknown score inputs stay
  `null`.
- [x] **Step 2: Run it to see it fail.** → FAIL.
- [x] **Step 3: Write `aws.ts`.**
- [x] **Step 4: Run the test** → PASS.
- [x] **Step 5: Add `'lib/detect/aws.ts'` to `SERVER_ONLY_MODULES`.**
- [x] **Step 6: Verify and commit.** Full gate. Commit: `feat(detect): the Stage 2 rules as detectors, with fleets expanded to members`.

---

## Phase 3 — The collector

### Task 9: The collector runtime and its cycle

Implements §9.2 (one runner, the job schedule, bounded jobs, the off switch) and **D4** (what a fresh install
actually runs).

**Files:**
- Create: `src/lib/collector/jobs.ts`, `src/lib/collector/runner.ts`
- Create: `tests/unit/collector-jobs.test.ts`, `tests/unit/collector-runner.test.ts`
- Modify: `src/lib/env.ts` (`OPSWATCH_COLLECTOR`, `OPSWATCH_ROLE`), `src/instrumentation-node.ts`,
  `tests/unit/module-boundaries.test.ts`

**The shape.** The decision — *which jobs are due, for which environments, right now* — is a pure function
over the clock and the last-run times, tested with literals. The runtime around it is a thin loop that claims
the lock, asks that function, runs what it returns and records each run. Nothing schedules itself with a
`setTimeout` captured at import time, because that cannot be tested and cannot be stopped.

**Interfaces:**
- `src/lib/collector/jobs.ts`
  - `JOB_IDS` / `JobId` — the ten jobs of §9.2's table.
  - `export type JobSpec = { id; everyMs; cap: number | null; scope: 'environment' | 'instance'; freshInstall: boolean }`
  - `JOBS: Record<JobId, JobSpec>` — the schedule and the caps, in one place.
  - `FRESH_INSTALL_JOBS` — **D4**: `inventory` (30 min), `detect` (5 min) and `compact` (24 h), and nothing
    else. `metrics` waits for the history switch (Task 24); `errors` waits for an enabled `log_source`
    (Task 20). A fresh install therefore spends **no extra AWS request**: `detect` runs over data the page
    already fetched, and `inventory` is `Describe*`, which §9.5 records as throttled but not billed.
- `src/lib/collector/runner.ts`
  - `COLLECTOR_TICK_MS` 15 s — how often the loop wakes, well inside `LOCK_HEARTBEAT_MS`.
  - `export function collectorEnabled(source: NodeJS.ProcessEnv): boolean` — false for
    `OPSWATCH_COLLECTOR=off`. `OPSWATCH_ROLE=collector` is for a second container from the same image that
    runs the collector alone; `OPSWATCH_ROLE=web` disables it. Neither set means the application process
    runs it, which is the single-container default.
  - `export function collectorOwner(): string` — `${process.pid}:${randomId()}`, per §33.4, never derived
    from anything a user can set.
  - `export type DueJob = { id: JobId; connectionId: string | null; scope: string | null }`
  - `export function dueJobs(input: { nowMs; environments; lastRunAt; enabled }): DueJob[]` — **pure**. A job
    is due when it has never run, or when `nowMs - lastRunAt >= everyMs`. Environment-scoped jobs yield one
    entry per environment; instance-scoped jobs yield one.
  - `export function startCollector(deps: CollectorDeps): { stop: () => Promise<void> }` — claims the lock,
    refreshes it, and on each tick runs what `dueJobs` returns. Every dependency is injected: the clock, the
    timer, the database, the environment list and the job implementations.

**The rules.**

1. **One runner.** The loop does nothing at all until `claimCollectorLock` returns true, and re-claims on
   every tick so a stale lock is picked up within one tick of going stale.
2. **A refresh that changes no row aborts the cycle** (§33.4). The process lost the lock while it was busy;
   continuing would mean two collectors writing.
3. **Every run is recorded** through `startRun`/`finishRun`, including a failure, so System status can tell
   "it failed" from "it never ran". A job that throws is caught, recorded `failed` with its error *code*, and
   the next job still runs — one broken job must not stop the cycle, the same rule the detector framework has.
4. **Jobs run one at a time.** better-sqlite3 is synchronous and the point of §9.2's bounded transactions is
   that the event loop keeps serving pages; running jobs concurrently would defeat it.
5. **Nothing is logged but one JSON line per failure**, carrying the job and an error code — never a
   credential, a resource name, a query or a result (§12.6).

- [x] **Step 1: Write the failing tests.** `collector-jobs.test.ts` pins the schedule and the caps against
  §9.2's table and asserts `FRESH_INSTALL_JOBS` is exactly D4's three. `collector-runner.test.ts` covers:
  `dueJobs` with never-run and just-run jobs, per-environment fan-out, the off switch and the roles, that the
  loop runs nothing without the lock, that a failed refresh aborts, that a throwing job is recorded and the
  next still runs, and that `stop()` ends it.
- [x] **Step 2: Run them to see them fail.** → FAIL.
- [x] **Step 3: Write `jobs.ts` and `runner.ts`; add the two environment variables.**
- [x] **Step 4: Run the tests** → PASS.
- [x] **Step 5: Start it from `instrumentation-node.ts`**, after the database is opened, and add both files to
  `SERVER_ONLY_MODULES`.
- [x] **Step 6: Verify and commit.** Full gate. Commit: `feat(collector): the runtime, its lock loop and the job schedule`.

### Task 10: The `inventory` and `detect` jobs

Implements §9.2's two fresh-install jobs. Split into two checkpoints because they are independent: `detect` is
what makes a problem exist at all, and `inventory` is what gives a subject a first-seen date.

**10a — the `detect` job.** `src/lib/collector/detect.ts`, plus the store side of applying a cycle
(`listLiveProblems`, `listRecentlyResolved`, `applyTransitions` in `src/lib/store/problems.ts`).

The job reads the same four families the Insights page reads, through the same cache, so it costs no extra
AWS request — §9.5's point and the reason D4 leaves it on. It then does what nothing did before: turns the
rules' output into rows.

The care is all in **§33.5**. A family that fails to load leaves its subjects *not evaluated*, which is not
the same as clear, so the job reports per live problem whether the family behind it was actually read. A
connection that cannot be resolved at all throws, and the run is recorded `failed` — never a cycle in which
everything quietly looked healthy. `covered`/`total` carry how many families were read, so a partial cycle is
visible rather than hidden.

`resolvedInWindow` is passed **everything still retained**, not only what is still reopenable: the lifecycle
applies the two-hour window itself, and needs the older rows so a successor can carry `previousProblemId`.
Found by a test that asserted ancestry and got `null`.

- [x] **Step 1: the store side** — the `LiveProblem` projection, the recently-resolved read, and
  `applyTransitions`, which scores each problem as it writes it so the row and its arithmetic cannot disagree.
- [x] **Step 2: the job**, wired into `run-job.ts`.
- [x] **Step 3: a cycle test** covering open, occurrence counting, resolve-after-three-and-fifteen-minutes,
  §33.5's regression, reopen inside the window, supersede beyond it, fleet members, and the total-failure floor.
- [x] **Step 4: verify against a real container.** Against seeded AWS the collector produced three
  `alarm_firing` problems, one per readable connection, each with its own key, evidence and stored arithmetic —
  and the score terms show §33.7's rescaling live: `b: null, u: null, availableWeight: 65, rescaled: true`.
- [x] **Step 5: gate and commit.** Commit: `feat(collector): the detect job, which is what makes a problem exist`.

**10b — the `inventory` job.** `src/lib/store/resources.ts` and `src/lib/collector/inventory.ts`: the
`Describe*` sweep that records what exists and when it was first and last seen, so a subject's age is known
(which §33.7's freshness rule needs) and so a resource that disappears can be noticed.

- [ ] **Step 1: the `resources` table and its store**, with first/last seen and an additive migration.
- [ ] **Step 2: the job**, bounded by §9.2's 60 describe calls, recording `covered N of M`.
- [ ] **Step 3: events** — `resource_appeared` and `resource_disappeared` on the spine.
- [ ] **Step 4: gate and commit.**

---

## Phase 4 — The surfaces

### Task 16: Health

Implements the `health` shape of **D1** and §2's promise that an unreadable family and a healthy one never
look the same.

**What it reads, and what it must not.** Health has to be instant and must cost nothing, so it reads the
database and never AWS. The detect job already fetches the four families every five minutes and already knows,
per family, how many resources there are and how many are affected — so it now **writes that down**.

**A table the spec's §9.3 list does not name, added deliberately:** `family_snapshots`, one row per
`(connectionId, scope, family)`, holding what the last cycle saw — `status`, `total`, `affected`, `readAt`,
and the failure when it could not be read. Without it Health could only report `null` for every count, which
the contract permits but which makes the page useless. It is additive, it is written by a job that was already
fetching the data, and it costs no extra request.

**Lifecycle events.** `applyTransitions` now appends to the §9.3 events spine — `problem_opened`,
`problem_reopened`, `problem_resolved` — which is what Task 17's brief reads to say what *changed*. The spine
existed from Task 2 and nothing had ever written to it.

- [x] **Step 1:** `family_snapshots` and its store, with an additive migration.
- [x] **Step 2:** the detect job writes a snapshot per family, and appends a lifecycle event per transition.
- [x] **Step 3:** `src/lib/read/health.ts` — the `health` shape, with `unavailable` carrying the sentence
  twice (`messageKey` + `values` + `message`), as the contract addendum ruled.
- [x] **Step 4:** `GET /api/v1/health`, the page, EN/FR, and `features.health`.
- [x] **Step 5:** tests, a real browser check, gate, commit, integrate.

### Task 17: The Morning brief

Implements the `brief` shape of **D1**: health over a period rather than at an instant, which is why it
carries `period` and `changes`.

`changes` come from the events spine over the period — a problem that opened is a change, one that resolved is
a change — so the brief answers "what happened since I last looked" from rows rather than from a second read
of AWS. `mostImportant` is the bounded top-N's first entry.

- [x] **Step 1:** `src/lib/read/brief.ts` over the events spine.
- [x] **Step 2:** `GET /api/v1/brief`, the page, EN/FR, `features.brief`, and the brief becomes the
  overview default as D2 intends.
- [x] **Step 3:** tests, a real browser check, gate, commit, integrate.

---

## Phase 5 — Error intelligence

### Task 18: Fingerprint v1, rebuild-proof

Implements §4.4's deterministic fingerprint and **§33.13** (fingerprints survive a rebuild).

**Files:** `src/lib/detect/fingerprint.ts`, `tests/unit/detect-fingerprint.test.ts`.

Pure, like the rest of `detect`. The whole value is that **the same error keeps one group across deploys**:
a build hash in a path and a minified function name both change on every release, and a fingerprint that
noticed either would start a new group every time anyone shipped.

- `FINGERPRINT_VERSION` 1 · `NORMALIZED_MESSAGE_MAX` 300 · `MAX_FRAMES` 5 (**D3**).
- `normalizeMessage` — §4.4's order exactly: collapse whitespace, then UUID, IP, URL, e-mail, quoted string,
  hex run of 8+, any remaining digit run, then trim and truncate. The order is load-bearing: a UUID contains
  hex runs and digits, so replacing digits first would destroy it.
- `normalizeFrame` — §33.13: a path segment that looks like a build hash is stripped, a function name that
  matches a minifier pattern (one or two characters, or a bare digit sequence) is replaced by its **position**,
  and a resolved symbol from a source map is preferred over both.
- `fingerprint` — drop frames under `node_modules|vendor|site-packages|/usr/lib|<internal>`, keep the top
  `MAX_FRAMES`, reduce each to `file:function` (**line numbers are dropped**, because they move on a
  whitespace commit), and hash `type \n message \n frames`. With no stack, hash the type, the message and the
  log group name instead.

- [x] **Step 1: the tests**, including §33.13's two: two builds of the same code with different content
  hashes and minified names give **one** fingerprint; two genuinely different errors with the same minified
  names do **not** collide.
- [x] **Step 2: the module.**
- [x] **Step 3: gate and commit.**
