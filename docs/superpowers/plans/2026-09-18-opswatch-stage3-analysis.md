# OpsWatch Stage 3 — Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax. Each task is self-contained: an implementer sees only its own task text plus the header sections of this plan (everything from **Goal** down to and including **Task index**).

**Goal:** Turn the Stage 2 live pages into an analysis product: a second, section-specific navigation inside every page, with **both menus collapsible to icons** and remembered per browser; **the first page of every section rebuilt as a dashboard for that category** (KPI tiles, status bar, charts or a heat grid, a top-N ranking, then the existing filterable list as the dashboard's table, then that category's insights), each stating in words what stands out; a dense, filterable visual language (facets with counts, status bars, KPI tiles, top-N bars, heat grids, threshold bands, sortable tables); a cross-instance Databases → Queries page that mixes the SQL of every Performance Insights instance and names where each statement comes from; one read-only report per section over a 12-hour default window with a change against the previous window; a Logs → Endpoints page that reads slow routes out of the application's own logs; and an Audit page that runs a catalogue of checks over the last 24 hours and can be copied or downloaded as Markdown. English and French throughout. No new AWS client, no new IAM action, no template version bump, nothing for the owner to redeploy.

**Dashboards and reports are different pages, and both exist.** A *dashboard* is the section's first sub-page (spec §9.2): live, filterable, auto-refreshing, showing the current state of the category, with the list that exists today as its table, keeping that list's filters and links. A *report* is a separate sub-page (spec §3): a fixed read-only analysis over a chosen window, with the change against the previous window, no filters and no auto-refresh. Both carry headline sentences built from their own data with message keys and placeholders (spec §9.3) — never generated prose.

**Architecture:** New server-only modules under `src/lib/analysis/` (`window.ts`, `coverage.ts`, `markdown.ts`, `queries.ts`, `report.ts`, `<section>-report.ts`, `<section>-dashboard.ts`, `audit.ts`) consume the Stage 2 modules in `src/lib/monitoring/` (`ecs.ts`, `rds.ts`, `pi.ts`, `elb.ts`, `alarms.ts`, `logs.ts`, `metrics.ts`, `insights.ts`, `evaluate.ts`, `overview.ts`) through the existing `AwsTarget`, `MonitoringDeps`, `describeCall`/`runCall`, `getMetricSeries` batching, the `monitoringCache` and the `MonitoringResult` failure typing. Dependency-free helpers that client components also need (facet counting, sorting, threshold bands, sub-section catalogue) live in `src/lib/monitoring/shared/`, which imports nothing from AWS, zod, Node, the database or `server-only`. Routes grow one segment: `/<locale>/c/<connectionId>/<region>/<section>/<subsection>[/<resource>…]`; the section root redirects to its first sub-page. A shared `SectionLayout` renders the section panel, the page header with its breadcrumb, and an optional filter row; a shared `DashboardShell` renders the KPI row, status bar, headline sentences, figures, table slot and insight slot in the fixed order spec §9.2 gives; every page below them keeps streaming per card through `<Suspense>`, with the expensive parts (per-instance Performance Insights, log volume) in their own boundaries. Reports and the audit are read-only views: nothing is stored, nothing auto-refreshes, and both state how many resources they covered. Dashboards auto-refresh at the usual 120 s and stay inside the same 300-query-per-page-load budget as everything else.

**Tech Stack:** Next.js 16.3.5 (App Router), React 19.2.8, TypeScript 5.9.3, next-intl 4.14.5, Tailwind CSS 4, shadcn/ui 4.21 (style radix-nova), lucide-react 1.47, recharts 3.10.1, AWS SDK v3 3.1134.0 (`client-cloudwatch`, `client-cloudwatch-logs`, `client-ecs`, `client-elastic-load-balancing-v2`, `client-pi`, `client-rds`), drizzle-orm 0.45.2 + better-sqlite3 13, zod 4.6.5, Vitest 5.0.1 + aws-sdk-client-mock 4.1.0, Playwright 1.63.0, moto 5.2.3, knip 6 (run through `npx knip`, configured by `knip.json`). **No new dependency.** Checked with `npm view` on 2026-09-18 before writing this plan: `marked` (16.6.0), `remark-stringify` (11.0.0) and `json2md` (2.0.2) were all considered for Task 3 and all rejected — the Markdown this stage emits is headings, paragraphs, bullets and pipe tables produced from already-localized strings, which is thirty lines of string joining, and a Markdown *parser* is not needed anywhere. If a later task believes it needs a package, it must stop and ask rather than install one.

**Spec:** `.superpowers/sdd/stage3-analysis-spec.md`. Section 8 ("Amendments after peer review") is binding and overrides the earlier sections wherever they conflict; every task below cites the amendments it implements by number.

**Branch:** `feat/step-1-foundations` itself, by controller ruling: Stage 1, Stage 2 and this stage share one branch that has never been pushed, and the owner reviews it as a whole. Phase 2 starts only after the Phase 1 checkpoint (Task 7) is clean; Phase 3 only after the Phase 2 checkpoint (Task 17). If time runs short, cut the Logs Endpoints pages (Tasks 23 and 24) first, then the remaining reports. The audit (Tasks 26 and 27) is the feature the owner asked for most explicitly, so it is built last but cut last too.

## Global Constraints

Binding for every task.

- Node.js 22, npm, project root `/var/www/html/opswatch`, TypeScript strict, alias `@/*` → `src/*`. Vitest config is `vitest.config.mts` (it aliases `server-only` to a stub).
- **Session first in every page, route and action.** Every monitoring page's first statement is `await initMonitoringRoute(params)` (which calls `initProtectedRoute` → `requireAdmin` and then checks the connection and region from the database only, before any `<Suspense>`, so an unknown selection still answers 404). Every redirect page calls `initProtectedRoute` first. Every route handler checks, in this order: `Origin` when the method mutates, then the session, then the connection and region, then AWS. Every server action calls `requireAdmin` before reading anything.
- **Origin checks on mutating routes.** `isSameOrigin(request, env().OPSWATCH_PUBLIC_URL)` on POST, PUT and DELETE; failure answers 403 `forbidden_origin`. A GET route handler (the audit Markdown download, Task 27) performs no Origin check because it mutates nothing, but still checks the session first. Server actions rely on Next.js's built-in Server Action origin verification *and* re-check the session and the connection themselves.
- **Server-only data modules.** Every file in `src/lib/analysis/` and every file in `src/lib/monitoring/` except `src/lib/monitoring/shared/**` starts with `import 'server-only';` and is listed in `SERVER_ONLY_MODULES` of `tests/unit/module-boundaries.test.ts`. Files in `src/lib/monitoring/shared/` import nothing from AWS, zod, Node, the database, `next-intl/server` or `server-only`, so client components may use them. An `AwsTarget` (it holds credentials) is never passed as a prop to a client component.
- **No user-facing string in code.** Every label, heading, sentence, empty state, aria-label, tooltip, button and Markdown heading is a message in `messages/en.json` and `messages/fr.json`. AWS identifiers are never translated: IAM actions, ARNs, resource names, AWS status values (`ACTIVE`, `ALARM`, `healthy`, `IN_PROGRESS`), statistic names (`p95`, `Sum`), metric and namespace names (`IncomingBytes`, `AWS/Logs`), Performance Insights dimension names (`db.sql_tokenized.id`), Logs Insights query text, and log field names the user typed.
- **EN/FR parity.** Identical key sets, no empty string; enforced by `tests/unit/i18n-messages.test.ts`. Namespaces read by client components are listed in `CLIENT_NAMESPACES` (`src/i18n/client-messages.ts`) and checked by `tests/unit/client-messages.test.ts`; all client-side strings of this stage live under `Monitoring.client`.
- **Guarded nullable timestamps.** A `number | null` timestamp (`createdAt`, `startedAt`, `stateUpdatedAt`, `updatedAt`) is never handed straight to next-intl's `format.relativeTime`/`format.dateTime`: guard it (`value != null ? format.relativeTime(value) : NO_VALUE`). The same guard applies inside Markdown rendering.
- **One clock per page render via `pageNow()`.** A page reads `pageNow()` from `@/lib/monitoring/shared/time-range` exactly once and passes `nowMs` down to every card, so all cards of one render share one window and therefore one set of cache entries. No component and no data module calls `Date.now()` itself; data modules take `nowMs` or an already-built `TimeWindow`.
- **p95 queries are isolated in their own call.** A `GetMetricData` request that contains a percentile stat never contains anything else (moto fact 2: the whole request fails otherwise). `getMetricSeries` is therefore called twice where a p95 is wanted: once for the ordinary stats and once for the percentile queries alone, and a failure of the second only blanks the p95 column.
- **Cache: 60 s, refresh 120 s.** `monitoringCache` is one in-memory TTL + LRU cache per process, at most 500 entries, keyed by connection id + region + call + normalized params. TTL 60 s for metrics and describe calls (`METRICS_TTL_MS`, `DESCRIBE_TTL_MS`), 5 minutes for Performance Insights (`PI_TTL_MS`), never for Logs Insights. Failed results are never cached. Windows are floored (to the minute for live pages, to 5 minutes for Performance Insights, to the report period for reports) so keys stay stable inside a TTL. Auto-refresh, where a page has it, is every 120 s (`AUTO_REFRESH_MS`) through `router.refresh()` while the tab is visible, with a pause toggle. **Reports, the Queries page, the Volume page, the Endpoints page and the Audit never auto-refresh** (`autoRefresh={false}`): they are read-only analyses and each refresh would spend API calls.
- **Caps and "N of M covered" wording.** Per page load: at most **300** metric queries and at most **one** Performance Insights call per instance (amendment 11). The audit: at most **500** metric queries in total, log volume asking **one** query per group covering both windows. Every capped page states how many resources it covered with the message `Monitoring.common.coverage.covered` ("Covering {covered} of {total} {resource}.") and, when `truncated`, also `Monitoring.common.coverage.truncated`. Resources left out for any other reason appear in a visible "not covered" list with their reason and, for an AWS failure, its error code — never silently dropped.
- **Timeouts:** 5 s per describe/list call (`AWS_CALL_TIMEOUT_MS`), 10 s per `GetMetricData` request (`METRICS_TIMEOUT_MS`), through `sendWithTimeout`. Timeouts surface as code `Timeout`.
- **Denied states:** a denied call renders `FailureNotice`, which names the missing action and links to `/accounts/<id>#permissions`; the rest of the page still renders.
- **No secrets in logs:** failures are logged as one JSON line through `logMonitoringFailure` (`{ event: 'monitoring_call', connectionId, region, action, reason, code }`). Never log credentials, request parameters, resource names, SQL statements, log field names, log query text or query results.
- **GetMetricData:** at most 500 queries per request (the batcher chunks), dimensions sorted by name (moto fact 4), no metric math (moto fact 3), `ScanBy: 'TimestampAscending'` with a local ascending sort because moto returns newest first (moto fact 1).
- **Logs Insights:** at most 24 h range, 1000 rows, 20 log groups, client polls every 1 s and stops after 60 s. This bounds the Search and Endpoints sub-pages. The Volume sub-page uses CloudWatch metrics (`AWS/Logs` `IncomingBytes`), not Logs Insights, so it is not bound by the 24 h cap.
- **Tests:** TDD, red before green. Unit tests use `aws-sdk-client-mock` and an injected cache and clock (never the process-wide `monitoringCache`); test output must be pristine — pass `log: vi.fn()` in `MonitoringDeps` so no failure is printed. E2E specs run in file order against a fresh `docker-compose.test.yml` stack.
- **Verification commands.** Every task runs the ones its step list names, and all of these before its commit step:
  - `npm test` → all suites pass, zero console output from the code under test.
  - `npm run typecheck` → no output, exit 0.
  - `npm run lint` → no output, exit 0.
  - `npx knip` → no unused files, exports or dependencies.
  - `npm run build` → build succeeds.
  - E2E (only where the task's steps say so): `docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e; docker compose -f docker-compose.test.yml down -v`.
  - Never run `docker compose config` against `docker-compose.yml` and never print `.env`.
- Do not export a symbol nothing imports: knip fails the task.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Verified moto 5.2.3 behaviour that shapes this stage

Facts 1–11 were probed on 2026-09-17 and are recorded in `docs/superpowers/plans/2026-09-18-opswatch-stage2-monitoring.md`. The ones that constrain Stage 3 tests:

1. `GetMetricData` aggregates by period and returns datapoints newest first; code sorts ascending.
2. **Any request containing `p95` fails with HTTP 500**, so p95 is asserted only in unit tests; e2e asserts the "p95 unavailable" state.
4. Dimension matching is order-sensitive in moto; `metrics.ts` sorts dimensions by name and the seed must too.
6. **ECS:** `ListTasks` is empty, `runningCount` is 0, `pendingCount` equals desired, `events` is empty, and the primary deployment stays `rolloutState: IN_PROGRESS` with `createdAt` = creation time. moto cannot produce running tasks, service events or `FAILED` rollouts.
7. **RDS:** `PerformanceInsightsEnabled` is never returned (always undefined, so `performanceInsights` is always `false`) and `DbiResourceId` is identical across instances.
8. **No Performance Insights backend:** `DescribeDimensionKeys` returns an HTML 404 that the SDK surfaces as a `SyntaxError`.
9. `DescribeAlarms` works and ignores `MaxRecords` (single page, never a `NextToken`).
10. **Logs:** `CreateLogGroup`, `PutLogEvents`, `DescribeLogGroups` (with prefix), `StartQuery` and `GetQueryResults` work, but **`filter`, `parse` and `stats` commands are ignored** — every event in range comes back unaggregated. `StopQuery` is not implemented.
11. `POST /moto-api/reset` clears all state. moto enforces no IAM, so denied and throttled states are unit-tested only.

**Consequences each task must respect:**
- Fact 7 + 8 ⇒ the Databases → Queries page can only be end-to-end tested through its **"not covered"** list; every merge, share and per-instance breakdown is unit-tested with `aws-sdk-client-mock`.
- Fact 10 ⇒ the Endpoints page's `stats … by …` query returns raw events in moto, so its e2e asserts the "the mapping matched nothing, here are the first lines we saw" state and the scanned-bytes notice, never a populated endpoint table.
- Fact 6 ⇒ the audit's ECS deployment checks (`FAILED`, stuck > 30 min) and any check that needs running tasks cannot fire in moto; e2e asserts only the findings the seed makes deterministic.
- Fact 2 ⇒ the Load balancers report's p95 column is asserted as unavailable in e2e.

**What only the owner can verify, on a real account** (each task repeats its own line, and the Phase 3 checkpoint collects them all):
- That the Databases → Queries page shows real statements with their per-instance origin, and that grouping by `db.user` and `db.host` returns keys (moto has no Performance Insights at all).
- That the report p95 columns show real values.
- That the audit's Performance Insights check (`rds_load_above_vcpu`) fires on an instance whose top statements exceed its vCPU count.
- That the Endpoints page's field mapping matches the owner's API log format and returns a populated endpoint table.
- That the ECS deployment checks fire on a real failed or stuck rollout.
- That `IncomingBytes` volume and `storedBytes` agree well enough for the Volume page's "possibly lagging" note to read sensibly.

## Naming decisions fixed once

Every task uses these exact names; they are decided here so tasks stay consistent.

**URL sub-page segments** (`src/lib/monitoring/shared/sections.ts`, Task 8):

| Section | Sub-page segments, in order |
|---|---|
| `overview` | `insights`, `audit` |
| `containers` | `services`, `report` |
| `databases` | `instances`, `queries`, `report` |
| `load-balancers` | `list`, `report` |
| `alarms` | `list`, `report` |
| `logs` | `volume`, `search`, `endpoints` |

The first segment of each section is its **dashboard** (spec §9.2) and its default; `/…/<section>` redirects there. Resource detail pages move under the list sub-page: `/containers/services/<cluster>/<service>`, `/databases/instances/<instance>`, `/load-balancers/list/<name>`. The segments are URL vocabulary and are never translated; their labels are the message keys `Sections.<section>.<segment>`.

**Why Logs ends up with `volume` first.** Spec §1's table listed Logs as "Search (current page), Volume (new)", but §9 overrides anything narrower and describes the Logs dashboard as "groups, volume ingested over the window, the biggest group, groups with no retention; volume over time; top ten groups by volume; the groups table with size, retention and a link that opens the search on that group" — that is the Volume page exactly. So `volume` becomes the Logs dashboard and therefore its first sub-page, and `search` keeps its Logs Insights editor and its group picker unchanged, reachable from the dashboard table's per-group link. **Task 8 ships the Logs order as `search`, `volume`, `endpoints` and Task 22 flips it to `volume`, `search`, `endpoints` when the dashboard exists**, so `/logs` never redirects to a page that has not been built.

**Ranges.** Report and Volume pages use `REPORT_RANGES = ['3h','12h','24h','7d']`, default `'12h'`. The Queries page uses the full `TIME_RANGES`, default `'3h'`. The Endpoints page uses `LOGS_TIME_RANGES = ['1h','3h','12h','24h']`, default `'1h'`. The audit is fixed at 24 hours with no selector.

**Report periods** (`REPORT_PERIOD_SECONDS`): `3h` → 300 s, `12h` → 900 s, `24h` → 1800 s, `7d` → 3600 s. Each range's length divides exactly by its period (36, 48, 48 and 168 datapoints per half), which is what makes the double-window split land on a datapoint boundary.

**Caps.** `REPORT_METRIC_QUERY_CAP = 300`; `AUDIT_METRIC_QUERY_CAP = 500` split as `AUDIT_BUDGET = { ecs: 200, rds: 150, alb: 90, logs: 60 }` with `AUDIT_QUERIES_PER = { ecs: 2, rds: 3, alb: 3, logs: 1 }` (so 100 services, 50 instances, 30 load balancers, 60 log groups); `QUERIES_MAX_INSTANCES = 50` Performance Insights calls on the Queries page; `AUDIT_MAX_PI_CALLS = 20`; `FLEET_SQL_LIMIT = 25` (amendment 2) while `TOP_SQL_LIMIT` stays 10 for the instance page; `REPORT_TOP_N = 10` rows per report table.

**Conflict resolved by the spec itself.** §1 said the left rail's collapse control "is kept for later and is not part of this stage", while §1b said "Main rail collapsible to icons … remembered per browser". **§9.1 settles it and is binding: both menus collapse to icons with tooltips, and both states are remembered per browser** (`localStorage`, never the server). On a narrow screen the section panel becomes the horizontal strip of §1 instead. Task 9 implements both.

**Dashboard content per section** (spec §9.2, quoted so no task has to re-read the spec). Every dashboard renders in this order: headline sentences, KPI tiles, status bar, figures, top-N ranking, the dense filterable table, then that category's insights.

| Section (dashboard sub-page) | KPI tiles | Status bar split | Figures | Top-N | Table | Insights |
|---|---|---|---|---|---|---|
| Containers (`services`) | services, running vs desired tasks, services above threshold, deployments in progress | by service state (healthy / degraded / deploying / unreachable) | heat grid of services by CPU | top ten by CPU and by memory | the existing services table, keeping its search filter and its links | `ecsInsights` |
| Databases (`instances`) | instances, writers and readers, average CPU, peak connections, database load where Performance Insights is on | by instance status and role | database load per instance over time | top statements by load, linking to the Queries page | the existing instances table | `rdsInsights` |
| Load balancers (`list`) | requests, 5xx error rate, p95 response time, unhealthy hosts | by load balancer state | requests and 5xx over time | top target groups by errors | the existing load balancers table | `albInsights` |
| Alarms (`list`) | in alarm, insufficient data, ok, hidden autoscaling alarms | by alarm state | — (the status bar *is* the state bar) | alarms in ALARM the longest, by `stateUpdatedAt` | the existing alarms table, keeping its state, target-tracking and search filters | `alarmInsights` |
| Logs (`volume`) | groups, volume ingested over the window, the biggest group, groups with no retention | by retention set / not set | volume over time | top ten groups by volume | groups table with size, retention and a link opening `logs/search?group=<name>` | — (Logs has no Stage 2 insight family) |
| Overview (`insights`) | one card per category with its headline numbers and its worst finding, each linking to that category's dashboard | — | — | — | — | the existing insights list, plus a link to the audit |

## File Structure

```
src/lib/analysis/
  window.ts        report ranges, double window, split, change arithmetic   (Task 1)
  coverage.ts      caps, Coverage, NotCovered                                (Task 2)
  markdown.ts      MarkdownDoc → string                                      (Task 3)
  queries.ts       cross-instance Performance Insights merge                 (Task 10)
  report.ts        report + dashboard shapes, ranking, headlines             (Task 12)
  containers-report.ts, containers-dashboard.ts                              (Tasks 13, 15)
  load-balancers-report.ts, load-balancers-dashboard.ts                      (Tasks 14, 16)
  databases-report.ts, databases-dashboard.ts                                (Tasks 18, 19)
  alarms-report.ts, alarms-dashboard.ts                                      (Tasks 20, 21)
  logs-dashboard.ts   log group volume, retention, spike                     (Task 22)
  overview-dashboard.ts category cards with their worst finding              (Task 25)
  audit.ts         check catalogue and loader                                (Task 26)
src/lib/monitoring/
  pi.ts            + topDimensionKeys, PiGroup, FLEET_SQL_LIMIT              (Task 10)
  instance-memory.ts + instanceVCpus                                          (Task 26)
  logs.ts          + listLogGroups (paginated), logGroupVolumeQueries         (Task 22)
  insights.ts      + RuleContext.windowMinutes                               (Task 12)
  api-route.ts     authorizeRegionRoute, failureResponse (moved from logs-route.ts) (Task 27)
  shared/
    sections.ts    sub-page catalogue and paths                              (Task 8)
    facets.ts      facet counting, selection, URL round trip                 (Task 4)
    table-sort.ts  sort state, stable sorting, URL round trip                (Task 4)
    bands.ts       threshold bands, tone for value, CPU and volume bands     (Task 4)
    paths.ts       + subsectionPath, subsection-aware parse/withRegion       (Task 8)
    logs-queries.ts + endpointStatsQuery, isLogFieldName, ENDPOINT_PRESETS   (Task 24)
src/components/analysis/
  facets-panel.tsx, status-bar.tsx, dense-table.tsx                          (Task 5)
  kpi-tile.tsx, top-n-bars.tsx, heat-grid.tsx, change-arrow.tsx              (Task 6)
  coverage-note.tsx, not-covered-list.tsx                                    (Task 2)
  headline-list.tsx, report-shell.tsx, dashboard-shell.tsx                   (Task 12)
  finding-list.tsx, markdown-actions.tsx                                     (Task 27)
src/components/monitoring/
  section-panel.tsx, section-page-header.tsx, section-layout.tsx, breadcrumb.tsx (Task 9)
  metric-chart.tsx + bands prop                                              (Task 6)
  insight-list.tsx + windowLabel prop                                        (Task 12)
src/components/sidebar.tsx, top-bar.tsx, app-shell.tsx, rail-collapse.tsx    (Task 9)
src/app/[locale]/(app)/c/[connectionId]/[region]/
  <section>/page.tsx                    → redirect to the dashboard sub-page (Task 9)
  overview/insights/ (dashboard), overview/audit/                            (Tasks 9, 25, 27)
  containers/services/… (dashboard), containers/report/                      (Tasks 9, 13, 15)
  databases/instances/… (dashboard), databases/queries/, databases/report/   (Tasks 9, 11, 18, 19)
  load-balancers/list/… (dashboard), load-balancers/report/                  (Tasks 9, 14, 16)
  alarms/list/ (dashboard), alarms/report/                                   (Tasks 9, 20, 21)
  logs/volume/ (dashboard), logs/search/…, logs/endpoints/                   (Tasks 9, 22, 24)
src/app/api/connections/[id]/regions/[region]/audit/markdown/route.ts        (Task 27)
src/lib/db/schema.ts + endpointMappings, drizzle/0001_*.sql                  (Task 23)
messages/en.json, messages/fr.json                                           (Tasks 1–28)
tests/unit/analysis-*.test.ts, monitoring-sections.test.ts, monitoring-facets.test.ts… (Tasks 1–27)
tests/e2e/seed/moto-seed.ts                                                  (Task 22)
tests/e2e/08-analysis.spec.ts                                                (Tasks 9–24)
tests/e2e/09-dashboards.spec.ts                                              (Tasks 15, 16, 19, 21, 22, 25)
tests/e2e/10-audit.spec.ts                                                   (Task 27)
README.md, README.fr.md, docs/                                               (Task 28)
```

## Task index

**Phase 1 — shared primitives:** 1 double-window split · 2 coverage caps · 3 Markdown renderer · 4 facet/sort/band primitives · 5 dense list components · 6 dense figure components · 7 checkpoint.
**Phase 2 — navigation, Queries, first reports and first dashboards:** 8 sub-section catalogue · 9 section menu, page header, both menus collapsible, route move · 10 cross-instance PI merge · 11 Databases → Queries page · 12 report and dashboard engine · 13 Containers report · 14 Load balancers report · 15 Containers dashboard · 16 Load balancers dashboard · 17 checkpoint.
**Phase 3 — the rest, audit last:** 18 Databases report · 19 Databases dashboard · 20 Alarms report · 21 Alarms dashboard · 22 Logs → Volume dashboard · 23 endpoint mapping storage · 24 Logs → Endpoints page · 25 Overview dashboard · 26 audit check catalogue · 27 audit page and Markdown · 28 checkpoint and docs.

---

## Phase 1 — Shared primitives

Nothing in Phase 1 renders a page or calls AWS. Every module here is pure, unit-tested, and used by Phases 2 and 3.

### Task 1: Double-window split and change arithmetic

Implements spec §3 item 3 and amendment 6: a metric-backed row fetches a window of twice the selected length in the *same* `GetMetricData` call and splits it in half locally, so the comparison against the previous window costs no extra call.

**Files:**
- Create: `src/lib/analysis/window.ts`
- Create: `tests/unit/analysis-window.test.ts`
- Modify: `tests/unit/module-boundaries.test.ts` (add `lib/analysis/window.ts` to `SERVER_ONLY_MODULES`)
- Modify: `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes (exact existing names): `TimeWindow`, `TimeRange`, `RANGE_SECONDS` from `@/lib/monitoring/shared/time-range`; `SeriesData` from `@/lib/monitoring/metrics`; `average`, `sum` from `@/lib/monitoring/evaluate`.
- Produces (`src/lib/analysis/window.ts`):
  - `export const REPORT_RANGES = ['3h', '12h', '24h', '7d'] as const satisfies readonly TimeRange[];`
  - `export type ReportRange = (typeof REPORT_RANGES)[number];`
  - `export const DEFAULT_REPORT_RANGE: ReportRange = '12h';`
  - `export const REPORT_PERIOD_SECONDS: Record<ReportRange, number>` = `{ '3h': 300, '12h': 900, '24h': 1800, '7d': 3600 }`
  - `export function parseReportRange(value: string | string[] | undefined): ReportRange`
  - `export type DoubleWindow = { fetch: TimeWindow; current: TimeWindow; previous: TimeWindow; splitAtMs: number; range: ReportRange };`
  - `export function doubleWindow(range: ReportRange, nowMs: number): DoubleWindow`
  - `export function splitSeries(series: SeriesData, splitAtMs: number): { current: SeriesData; previous: SeriesData }`
  - `export type Aggregate = 'average' | 'sum' | 'max';`
  - `export function aggregateSeries(series: SeriesData, aggregate: Aggregate): number | null`
  - `export type Change = { kind: 'up' | 'down' | 'flat'; ratio: number } | { kind: 'new' } | { kind: 'unavailable' };`
  - `export const CHANGE_FLAT_RATIO = 0.01;`
  - `export function compareWindows(current: number | null, previous: number | null): Change`
  - `export type WindowedMetric = { current: number | null; previous: number | null; change: Change };`
  - `export function windowedMetric(series: SeriesData, split: DoubleWindow, aggregate: Aggregate): WindowedMetric`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analysis-window.test.ts` with these cases (they are the specification of the arithmetic):

```ts
import { describe, expect, it } from 'vitest';
import {
  CHANGE_FLAT_RATIO, DEFAULT_REPORT_RANGE, REPORT_PERIOD_SECONDS, REPORT_RANGES,
  aggregateSeries, compareWindows, doubleWindow, parseReportRange, splitSeries, windowedMetric,
} from '@/lib/analysis/window';

const now = Date.parse('2026-09-18T14:07:42Z');

describe('doubleWindow', () => {
  it('floors the end to the period and puts the split one range before it', () => {
    const w = doubleWindow('12h', now);
    // 900 s period: 14:07:42 floors to 14:00:00.
    expect(w.fetch.end).toEqual(new Date('2026-09-18T14:00:00Z'));
    expect(w.fetch.start).toEqual(new Date('2026-09-17T14:00:00Z')); // 2 × 12 h
    expect(w.fetch.periodSeconds).toBe(900);
    expect(w.current).toEqual({ start: new Date('2026-09-18T02:00:00Z'), end: new Date('2026-09-18T14:00:00Z'), periodSeconds: 900 });
    expect(w.previous).toEqual({ start: new Date('2026-09-17T14:00:00Z'), end: new Date('2026-09-18T02:00:00Z'), periodSeconds: 900 });
    expect(w.splitAtMs).toBe(Date.parse('2026-09-18T02:00:00Z'));
    expect(w.range).toBe('12h');
  });

  it('gives every range a period that divides it exactly', () => {
    for (const range of REPORT_RANGES) {
      const w = doubleWindow(range, now);
      const halfSeconds = (w.current.end.getTime() - w.current.start.getTime()) / 1000;
      expect(halfSeconds % REPORT_PERIOD_SECONDS[range]).toBe(0);
      expect(w.fetch.end.getTime() % (REPORT_PERIOD_SECONDS[range] * 1000)).toBe(0);
    }
  });

  it('is stable for a whole period, so two renders share one cache key', () => {
    expect(doubleWindow('3h', now)).toEqual(doubleWindow('3h', now + 299_000));
    expect(doubleWindow('3h', now).fetch.end).not.toEqual(doubleWindow('3h', now + 600_000).fetch.end);
  });
});

describe('parseReportRange', () => {
  it('falls back to 12 h and takes the first value of an array', () => {
    expect(parseReportRange(undefined)).toBe(DEFAULT_REPORT_RANGE);
    expect(parseReportRange('1h')).toBe('12h');   // 1h is not a report range
    expect(parseReportRange(['7d', '3h'])).toBe('7d');
  });
});

describe('splitSeries', () => {
  // A CloudWatch datapoint is timestamped at the START of its period, so t >= splitAt is the current half.
  const series = { timestamps: [10, 20, 30, 40], values: [1, 2, 3, 4] };
  it('puts the datapoint on the boundary in the current half', () => {
    expect(splitSeries(series, 30)).toEqual({
      previous: { timestamps: [10, 20], values: [1, 2] },
      current: { timestamps: [30, 40], values: [3, 4] },
    });
  });
  it('handles an empty series and an all-previous series', () => {
    expect(splitSeries({ timestamps: [], values: [] }, 30)).toEqual({ previous: { timestamps: [], values: [] }, current: { timestamps: [], values: [] } });
    expect(splitSeries(series, 99).current).toEqual({ timestamps: [], values: [] });
  });
});

describe('aggregateSeries', () => {
  it('averages, sums and maxes, and returns null for an empty series', () => {
    const s = { timestamps: [1, 2, 3], values: [2, 4, 9] };
    expect(aggregateSeries(s, 'average')).toBe(5);
    expect(aggregateSeries(s, 'sum')).toBe(15);
    expect(aggregateSeries(s, 'max')).toBe(9);
    expect(aggregateSeries({ timestamps: [], values: [] }, 'average')).toBeNull();
    expect(aggregateSeries({ timestamps: [], values: [] }, 'sum')).toBeNull();
    expect(aggregateSeries({ timestamps: [], values: [] }, 'max')).toBeNull();
  });
});

describe('compareWindows', () => {
  it('classifies up, down, flat, new and unavailable', () => {
    expect(compareWindows(120, 100)).toEqual({ kind: 'up', ratio: 0.2 });
    expect(compareWindows(80, 100)).toEqual({ kind: 'down', ratio: -0.2 });
    expect(compareWindows(100.5, 100)).toEqual({ kind: 'flat', ratio: 0.005 });
    expect(CHANGE_FLAT_RATIO).toBe(0.01);
    expect(compareWindows(0, 0)).toEqual({ kind: 'flat', ratio: 0 });
    expect(compareWindows(5, 0)).toEqual({ kind: 'new' });
    expect(compareWindows(null, 100)).toEqual({ kind: 'unavailable' });
    expect(compareWindows(100, null)).toEqual({ kind: 'unavailable' });
  });
  it('treats a negative previous value as uncomparable rather than inverting the arrow', () => {
    expect(compareWindows(10, -5)).toEqual({ kind: 'unavailable' });
  });
});

describe('windowedMetric', () => {
  it('splits, aggregates each half and compares in one go', () => {
    const w = doubleWindow('3h', now);
    const step = 300_000;
    const start = w.fetch.start.getTime();
    // 36 datapoints of 10 in the previous half, 36 of 15 in the current half.
    const timestamps = Array.from({ length: 72 }, (_, i) => start + i * step);
    const values = timestamps.map((t) => (t < w.splitAtMs ? 10 : 15));
    expect(windowedMetric({ timestamps, values }, w, 'average')).toEqual({ current: 15, previous: 10, change: { kind: 'up', ratio: 0.5 } });
    expect(windowedMetric({ timestamps, values }, w, 'sum')).toEqual({ current: 540, previous: 360, change: { kind: 'up', ratio: 0.5 } });
    expect(windowedMetric({ timestamps: [], values: [] }, w, 'max')).toEqual({ current: null, previous: null, change: { kind: 'unavailable' } });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/analysis-window.test.ts`
Expected: FAIL — `Cannot find module '@/lib/analysis/window'`.

- [ ] **Step 3: Write the module**

Create `src/lib/analysis/window.ts`. The whole arithmetic, so nothing is left to interpretation:

```ts
import 'server-only';
import { average, sum } from '../monitoring/evaluate';
import type { SeriesData } from '../monitoring/metrics';
import { RANGE_SECONDS, type TimeRange, type TimeWindow } from '../monitoring/shared/time-range';
import { isOneOf } from '../type-guards';

export const REPORT_RANGES = ['3h', '12h', '24h', '7d'] as const satisfies readonly TimeRange[];
export type ReportRange = (typeof REPORT_RANGES)[number];
export const DEFAULT_REPORT_RANGE: ReportRange = '12h';

/** Coarser than the live pages (§3): a report reads a trend, not a spike. Each range divides exactly by its period. */
export const REPORT_PERIOD_SECONDS: Record<ReportRange, number> = { '3h': 300, '12h': 900, '24h': 1800, '7d': 3600 };

export function parseReportRange(value: string | string[] | undefined): ReportRange {
  const first = Array.isArray(value) ? value[0] : value;
  return isOneOf(REPORT_RANGES, first) ? first : DEFAULT_REPORT_RANGE;
}

export type DoubleWindow = { fetch: TimeWindow; current: TimeWindow; previous: TimeWindow; splitAtMs: number; range: ReportRange };

/**
 * One window of twice the range, plus the two halves it splits into (amendment 6). The end is floored to the
 * period, not to the minute, so the split lands on a datapoint boundary and the cache key stays stable for a
 * whole period instead of a whole minute.
 */
export function doubleWindow(range: ReportRange, nowMs: number): DoubleWindow {
  const periodSeconds = REPORT_PERIOD_SECONDS[range];
  const periodMs = periodSeconds * 1000;
  const endMs = Math.floor(nowMs / periodMs) * periodMs;
  const halfMs = RANGE_SECONDS[range] * 1000;
  const splitAtMs = endMs - halfMs;
  const startMs = endMs - 2 * halfMs;
  return {
    fetch: { start: new Date(startMs), end: new Date(endMs), periodSeconds },
    current: { start: new Date(splitAtMs), end: new Date(endMs), periodSeconds },
    previous: { start: new Date(startMs), end: new Date(splitAtMs), periodSeconds },
    splitAtMs,
    range,
  };
}

/** A CloudWatch datapoint is stamped at the start of its period, so the boundary datapoint belongs to the current half. */
export function splitSeries(series: SeriesData, splitAtMs: number): { current: SeriesData; previous: SeriesData } {
  const at = series.timestamps.findIndex((t) => t >= splitAtMs);
  const cut = at === -1 ? series.timestamps.length : at;
  return {
    previous: { timestamps: series.timestamps.slice(0, cut), values: series.values.slice(0, cut) },
    current: { timestamps: series.timestamps.slice(cut), values: series.values.slice(cut) },
  };
}

export type Aggregate = 'average' | 'sum' | 'max';

export function aggregateSeries(series: SeriesData, aggregate: Aggregate): number | null {
  if (series.values.length === 0) return null;
  if (aggregate === 'average') return average(series.values);
  if (aggregate === 'sum') return sum(series.values);
  return Math.max(...series.values);
}

export type Change = { kind: 'up' | 'down' | 'flat'; ratio: number } | { kind: 'new' } | { kind: 'unavailable' };
/** Below one per cent either way the arrow would be noise, so it reads as flat. */
export const CHANGE_FLAT_RATIO = 0.01;

export function compareWindows(current: number | null, previous: number | null): Change {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return { kind: 'unavailable' };
  // A negative baseline has no meaningful ratio; no metric this stage reads can be negative anyway.
  if (previous < 0) return { kind: 'unavailable' };
  if (previous === 0) return current === 0 ? { kind: 'flat', ratio: 0 } : { kind: 'new' };
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < CHANGE_FLAT_RATIO) return { kind: 'flat', ratio };
  return { kind: ratio > 0 ? 'up' : 'down', ratio };
}

export type WindowedMetric = { current: number | null; previous: number | null; change: Change };

export function windowedMetric(series: SeriesData, split: DoubleWindow, aggregate: Aggregate): WindowedMetric {
  const halves = splitSeries(series, split.splitAtMs);
  const current = aggregateSeries(halves.current, aggregate);
  const previous = aggregateSeries(halves.previous, aggregate);
  return { current, previous, change: compareWindows(current, previous) };
}
```

- [ ] **Step 4: Register the module boundary**

In `tests/unit/module-boundaries.test.ts`, append `'lib/analysis/window.ts'` to the `SERVER_ONLY_MODULES` array, after `'lib/monitoring/logs-route.ts'`.

- [ ] **Step 5: Add the change messages**

These are used by Task 6's `ChangeArrow` and by Task 3's Markdown; they are added now so both languages stay in step.

`messages/en.json`, under `Monitoring.common`, add a `change` object:

| Key | EN | FR |
|---|---|---|
| `Monitoring.common.change.up` | `Up {percent} against the previous {window}` | `En hausse de {percent} par rapport aux {window} précédentes` |
| `Monitoring.common.change.down` | `Down {percent} against the previous {window}` | `En baisse de {percent} par rapport aux {window} précédentes` |
| `Monitoring.common.change.flat` | `Unchanged against the previous {window}` | `Stable par rapport aux {window} précédentes` |
| `Monitoring.common.change.new` | `No value in the previous {window}` | `Aucune valeur sur les {window} précédentes` |
| `Monitoring.common.change.unavailable` | `No comparison available` | `Comparaison indisponible` |
| `Monitoring.common.change.label` | `Change` | `Évolution` |
| `Monitoring.common.window.3h` | `3 hours` | `3 heures` |
| `Monitoring.common.window.12h` | `12 hours` | `12 heures` |
| `Monitoring.common.window.24h` | `24 hours` | `24 heures` |
| `Monitoring.common.window.7d` | `7 days` | `7 jours` |

(`{window}` is filled with `Monitoring.common.window.<range>`; the FR wording is written so "les 12 heures précédentes" reads correctly for every value above.)

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/unit/analysis-window.test.ts tests/unit/module-boundaries.test.ts tests/unit/i18n-messages.test.ts`
Expected: all pass, no console output.

- [ ] **Step 7: Verify and commit**

Run: `npm test` (all suites pass), `npm run typecheck` (no output), `npm run lint` (no output), `npx knip` (no unused export — `window.ts` is imported by nothing yet, so **temporarily** knip will flag the file; add nothing to `knip.json`, instead verify with `npx knip --include files` and accept the "unused file" report only for this task, noting it in the commit body; Task 12 imports it and the report clears). If knip's exit code fails the task, re-run it at the end of Task 12 instead and record that in the commit body.
Commit: `feat(analysis): double-window split and change arithmetic`.

**moto limits:** none — this task calls nothing.
**Owner-only verification:** none.

---

### Task 2: Coverage caps and the "N of M covered" wording

Implements spec §5 (cost control) and amendment 11 (the cost budget covers both axes and every page states its coverage).

**Files:**
- Create: `src/lib/analysis/coverage.ts`
- Create: `src/components/analysis/coverage-note.tsx`, `src/components/analysis/not-covered-list.tsx`
- Create: `tests/unit/analysis-coverage.test.ts`
- Modify: `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `MonitoringFailure`, `isFailure` from `@/lib/monitoring/result`; `FailureNotice` is *not* used here (a not-covered row is not a card failure); `getTranslations` from `next-intl/server`.
- Produces (`src/lib/analysis/coverage.ts`):
  - `export const REPORT_METRIC_QUERY_CAP = 300;`
  - `export const AUDIT_METRIC_QUERY_CAP = 500;`
  - `export const AUDIT_BUDGET = { ecs: 200, rds: 150, alb: 90, logs: 60 } as const;`
  - `export const AUDIT_QUERIES_PER = { ecs: 2, rds: 3, alb: 3, logs: 1 } as const;`
  - `export const QUERIES_MAX_INSTANCES = 50;`
  - `export const AUDIT_MAX_PI_CALLS = 20;`
  - `export type Coverage = { covered: number; total: number; truncated: boolean };`
  - `export function coverageOf(covered: number, total: number): Coverage`
  - `export function capResources<T>(resources: readonly T[], queriesPerResource: number, cap: number): { included: T[]; excluded: T[]; coverage: Coverage }`
  - `export type NotCoveredReason = 'cap' | 'pi_disabled' | 'no_resource_id' | 'unknown_class' | 'denied' | 'throttled' | 'error';`
  - `export type NotCovered = { resource: string; reason: NotCoveredReason; code: string | null; action: string | null };`
  - `export function notCoveredFromFailure(resource: string, failure: MonitoringFailure): NotCovered`
  - `export function notCovered(resource: string, reason: Exclude<NotCoveredReason, 'denied' | 'throttled' | 'error'>): NotCovered`
  - `export function sortNotCovered(rows: readonly NotCovered[]): NotCovered[]`
- Produces (`src/components/analysis/coverage-note.tsx`, server component):
  - `export async function CoverageNote({ coverage, resourceKey }: { coverage: Coverage; resourceKey: 'services' | 'instances' | 'loadBalancers' | 'logGroups' | 'alarms' }): Promise<React.JSX.Element | null>`
- Produces (`src/components/analysis/not-covered-list.tsx`, server component):
  - `export async function NotCoveredList({ rows, titleKey }: { rows: readonly NotCovered[]; titleKey: string }): Promise<React.JSX.Element | null>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analysis-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AUDIT_BUDGET, AUDIT_METRIC_QUERY_CAP, AUDIT_QUERIES_PER, REPORT_METRIC_QUERY_CAP,
  capResources, coverageOf, notCovered, notCoveredFromFailure, sortNotCovered,
} from '@/lib/analysis/coverage';

describe('the budget', () => {
  it('splits the audit cap exactly and fits the documented resource counts', () => {
    expect(Object.values(AUDIT_BUDGET).reduce((a, b) => a + b, 0)).toBe(AUDIT_METRIC_QUERY_CAP);
    expect(AUDIT_BUDGET.ecs / AUDIT_QUERIES_PER.ecs).toBe(100);
    expect(AUDIT_BUDGET.rds / AUDIT_QUERIES_PER.rds).toBe(50);
    expect(AUDIT_BUDGET.alb / AUDIT_QUERIES_PER.alb).toBe(30);
    expect(AUDIT_BUDGET.logs / AUDIT_QUERIES_PER.logs).toBe(60);
    expect(REPORT_METRIC_QUERY_CAP).toBe(300);
  });
});

describe('capResources', () => {
  const items = Array.from({ length: 10 }, (_, i) => `r${i}`);
  it('takes as many resources as the cap allows and reports the rest', () => {
    const { included, excluded, coverage } = capResources(items, 4, 20);  // 20 / 4 = 5
    expect(included).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(excluded).toEqual(['r5', 'r6', 'r7', 'r8', 'r9']);
    expect(coverage).toEqual({ covered: 5, total: 10, truncated: true });
  });
  it('keeps everything when the cap is not reached', () => {
    expect(capResources(items, 4, 400).coverage).toEqual({ covered: 10, total: 10, truncated: false });
  });
  it('rounds down rather than overspending, and never goes below zero', () => {
    expect(capResources(items, 3, 10).included).toHaveLength(3);   // floor(10 / 3)
    expect(capResources(items, 3, 2).included).toEqual([]);
    expect(capResources(items, 3, 2).coverage).toEqual({ covered: 0, total: 10, truncated: true });
  });
  it('treats a zero cost per resource as unlimited', () => {
    expect(capResources(items, 0, 5).coverage).toEqual({ covered: 10, total: 10, truncated: false });
  });
  it('reports an empty input as fully covered', () => {
    expect(capResources([], 4, 20).coverage).toEqual({ covered: 0, total: 0, truncated: false });
  });
});

describe('coverageOf', () => {
  it('marks truncation only when something was left out', () => {
    expect(coverageOf(3, 3)).toEqual({ covered: 3, total: 3, truncated: false });
    expect(coverageOf(3, 7)).toEqual({ covered: 3, total: 7, truncated: true });
  });
});

describe('notCovered', () => {
  it('carries the AWS reason, code and action of a failure', () => {
    expect(notCoveredFromFailure('db-orders', { ok: false, reason: 'denied', code: 'AccessDenied', action: 'pi:DescribeDimensionKeys' }))
      .toEqual({ resource: 'db-orders', reason: 'denied', code: 'AccessDenied', action: 'pi:DescribeDimensionKeys' });
  });
  it('carries no code for a structural reason', () => {
    expect(notCovered('db-legacy', 'pi_disabled')).toEqual({ resource: 'db-legacy', reason: 'pi_disabled', code: null, action: null });
  });
  it('sorts worst first, then by resource name', () => {
    const rows = [notCovered('b', 'cap'), notCovered('a', 'pi_disabled'), notCoveredFromFailure('c', { ok: false, reason: 'denied', code: 'X', action: 'y' }), notCovered('a', 'cap')];
    expect(sortNotCovered(rows).map((r) => [r.resource, r.reason])).toEqual([
      ['c', 'denied'], ['a', 'pi_disabled'], ['a', 'cap'], ['b', 'cap'],
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/analysis-coverage.test.ts`
Expected: FAIL — `Cannot find module '@/lib/analysis/coverage'`.

- [ ] **Step 3: Write the module**

Create `src/lib/analysis/coverage.ts`. The ordering used by `sortNotCovered` is `denied, throttled, error, no_resource_id, unknown_class, pi_disabled, cap`, then resource name with `localeCompare(…, 'en')`.

```ts
import 'server-only';
import type { MonitoringFailure } from '../monitoring/result';

/** Per page load (amendment 11). */
export const REPORT_METRIC_QUERY_CAP = 300;
/** Per audit run, split so no family can starve another. */
export const AUDIT_METRIC_QUERY_CAP = 500;
export const AUDIT_BUDGET = { ecs: 200, rds: 150, alb: 90, logs: 60 } as const;
/**
 * RDS is budgeted at three queries because Aurora readers add AuroraReplicaLag to CPU and FreeableMemory;
 * instances that are not readers spend two, so the cap is conservative on purpose.
 */
export const AUDIT_QUERIES_PER = { ecs: 2, rds: 3, alb: 3, logs: 1 } as const;
/** One Performance Insights call per instance is the second axis of the budget; this bounds it. */
export const QUERIES_MAX_INSTANCES = 50;
export const AUDIT_MAX_PI_CALLS = 20;

export type Coverage = { covered: number; total: number; truncated: boolean };

export function coverageOf(covered: number, total: number): Coverage {
  return { covered, total, truncated: covered < total };
}

export function capResources<T>(resources: readonly T[], queriesPerResource: number, cap: number): { included: T[]; excluded: T[]; coverage: Coverage } {
  const limit = queriesPerResource <= 0 ? resources.length : Math.max(0, Math.floor(cap / queriesPerResource));
  const included = resources.slice(0, limit);
  return { included, excluded: resources.slice(limit), coverage: coverageOf(included.length, resources.length) };
}

export type NotCoveredReason = 'cap' | 'pi_disabled' | 'no_resource_id' | 'unknown_class' | 'denied' | 'throttled' | 'error';
export type NotCovered = { resource: string; reason: NotCoveredReason; code: string | null; action: string | null };

export function notCoveredFromFailure(resource: string, failure: MonitoringFailure): NotCovered {
  return { resource, reason: failure.reason, code: failure.code, action: failure.action };
}

export function notCovered(resource: string, reason: Exclude<NotCoveredReason, 'denied' | 'throttled' | 'error'>): NotCovered {
  return { resource, reason, code: null, action: null };
}

const REASON_ORDER: Record<NotCoveredReason, number> = { denied: 0, throttled: 1, error: 2, no_resource_id: 3, unknown_class: 4, pi_disabled: 5, cap: 6 };

export function sortNotCovered(rows: readonly NotCovered[]): NotCovered[] {
  return [...rows].sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || a.resource.localeCompare(b.resource, 'en'));
}
```

- [ ] **Step 4: Write the two server components**

`src/components/analysis/coverage-note.tsx` — one line of muted text under a page header. Props: `coverage: Coverage`, `resourceKey`. Renders `null` when `coverage.total === 0`. Otherwise a `<p className="text-sm text-muted-foreground">` containing `t('coverage.covered', { covered, total, resource: t(\`coverage.resource.${resourceKey}\`) })`, followed by a space and, only when `coverage.truncated`, `t('coverage.truncated', { covered })` inside a `<span className={TONE_TEXT.warning}>`. Translations come from `getTranslations('Monitoring.common')`.

`src/components/analysis/not-covered-list.tsx` — props: `rows: readonly NotCovered[]`, `titleKey` (a full message key such as `Monitoring.queries.notCoveredTitle`). Renders `null` for an empty list. Otherwise a `<section>` with an `<h3 className="text-sm font-medium">` holding the title and a `<ul className="mt-2 space-y-1 text-sm text-muted-foreground">`. Each `<li>` shows the resource name in `font-medium text-foreground`, then an em dash, then the reason: `t(\`notCovered.${row.reason}\`)`, and when `row.code !== null` also `t('notCovered.code', { code: row.code, action: row.action })`. Rows are passed through `sortNotCovered` by the caller; the component does not sort (it is a pure renderer and sorting is tested in the module).

- [ ] **Step 5: Add the messages**

Under `Monitoring.common`, add a `coverage` object and a `notCovered` object.

| Key | EN | FR |
|---|---|---|
| `Monitoring.common.coverage.covered` | `Covering {covered} of {total} {resource}.` | `Couvre {covered} {resource} sur {total}.` |
| `Monitoring.common.coverage.truncated` | `The query budget stopped the scan at {covered}; narrow the region or the window to see the rest.` | `Le budget de requêtes a arrêté l'analyse à {covered} ; réduisez la région ou la fenêtre pour voir le reste.` |
| `Monitoring.common.coverage.resource.services` | `services` | `services` |
| `Monitoring.common.coverage.resource.instances` | `database instances` | `instances de base de données` |
| `Monitoring.common.coverage.resource.loadBalancers` | `load balancers` | `répartiteurs de charge` |
| `Monitoring.common.coverage.resource.logGroups` | `log groups` | `groupes de journaux` |
| `Monitoring.common.coverage.resource.alarms` | `alarms` | `alarmes` |
| `Monitoring.common.notCovered.cap` | `left out by the query budget` | `écarté par le budget de requêtes` |
| `Monitoring.common.notCovered.pi_disabled` | `Performance Insights is disabled` | `Performance Insights est désactivé` |
| `Monitoring.common.notCovered.no_resource_id` | `AWS returned no Performance Insights resource id` | `AWS n'a renvoyé aucun identifiant de ressource Performance Insights` |
| `Monitoring.common.notCovered.unknown_class` | `this instance class is not in the memory table` | `cette classe d'instance ne figure pas dans la table mémoire` |
| `Monitoring.common.notCovered.denied` | `OpsWatch is not allowed to read it` | `OpsWatch n'est pas autorisé à le lire` |
| `Monitoring.common.notCovered.throttled` | `AWS throttled the request` | `AWS a limité la requête` |
| `Monitoring.common.notCovered.error` | `AWS returned an error` | `AWS a renvoyé une erreur` |
| `Monitoring.common.notCovered.code` | `({action}: {code})` | `({action} : {code})` |

- [ ] **Step 6: Register the boundary and run the tests**

Add `'lib/analysis/coverage.ts'` to `SERVER_ONLY_MODULES` in `tests/unit/module-boundaries.test.ts`.
Run: `npx vitest run tests/unit/analysis-coverage.test.ts tests/unit/module-boundaries.test.ts tests/unit/i18n-messages.test.ts`
Expected: all pass.

- [ ] **Step 7: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`. (`npx knip` will report `coverage.ts`, `coverage-note.tsx` and `not-covered-list.tsx` as unused files until Task 11 imports them; record that in the commit body and re-check at the Phase 2 checkpoint.)
Commit: `feat(analysis): query budget caps and the covered-of-total wording`.

**moto limits:** none.
**Owner-only verification:** none.

---

### Task 3: Markdown renderer

Implements spec §4's "Copy report" and "Download": the findings become Markdown the owner can paste into a ticket. The renderer never generates prose — it is handed strings that next-intl already localized.

**Files:**
- Create: `src/lib/analysis/markdown.ts`
- Create: `tests/unit/analysis-markdown.test.ts`
- Modify: `tests/unit/module-boundaries.test.ts`

**Interfaces:**
- Consumes: nothing. The module is pure string work and imports only `server-only`.
- Produces (`src/lib/analysis/markdown.ts`):
  - `export type MarkdownTable = { headers: string[]; rows: string[][] };`
  - `export type MarkdownSection = { heading: string; paragraphs?: string[]; bullets?: string[]; table?: MarkdownTable };`
  - `export type MarkdownDoc = { title: string; subtitle?: string; sections: MarkdownSection[] };`
  - `export function escapeMarkdownCell(value: string): string`
  - `export function renderMarkdown(doc: MarkdownDoc): string`
  - `export function markdownFilename(prefix: string, region: string, endMs: number): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analysis-markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { escapeMarkdownCell, markdownFilename, renderMarkdown } from '@/lib/analysis/markdown';

describe('escapeMarkdownCell', () => {
  it('keeps a pipe from breaking the table and flattens newlines', () => {
    expect(escapeMarkdownCell('a | b')).toBe('a \\| b');
    expect(escapeMarkdownCell('line one\nline two')).toBe('line one line two');
    expect(escapeMarkdownCell('back\\slash')).toBe('back\\\\slash');
    expect(escapeMarkdownCell('  padded  ')).toBe('padded');
    expect(escapeMarkdownCell('')).toBe('');
  });
  it('leaves SQL and AWS identifiers readable', () => {
    expect(escapeMarkdownCell('SELECT * FROM orders WHERE id = ?')).toBe('SELECT * FROM orders WHERE id = ?');
    expect(escapeMarkdownCell('arn:aws:ecs:eu-west-1:1:service/web')).toBe('arn:aws:ecs:eu-west-1:1:service/web');
  });
});

describe('renderMarkdown', () => {
  it('renders a title, a subtitle, headings, paragraphs, bullets and a table', () => {
    const out = renderMarkdown({
      title: 'OpsWatch audit',
      subtitle: 'Production · eu-west-1 · last 24 hours',
      sections: [
        { heading: 'Critical', paragraphs: ['2 findings.'], bullets: ['web ran 0 of 2 tasks.', 'api-alb returned 412 5xx errors.'] },
        { heading: 'Coverage', table: { headers: ['Resource', 'Covered'], rows: [['Services', '12 of 12'], ['Instances', '3 of 5']] } },
      ],
    });
    expect(out).toBe(
      '# OpsWatch audit\n' +
      '\n' +
      'Production · eu-west-1 · last 24 hours\n' +
      '\n' +
      '## Critical\n' +
      '\n' +
      '2 findings.\n' +
      '\n' +
      '- web ran 0 of 2 tasks.\n' +
      '- api-alb returned 412 5xx errors.\n' +
      '\n' +
      '## Coverage\n' +
      '\n' +
      '| Resource | Covered |\n' +
      '| --- | --- |\n' +
      '| Services | 12 of 12 |\n' +
      '| Instances | 3 of 5 |\n',
    );
  });

  it('omits an absent subtitle and an empty section body', () => {
    expect(renderMarkdown({ title: 'T', sections: [{ heading: 'Empty' }] })).toBe('# T\n\n## Empty\n');
  });

  it('escapes every cell and pads short rows so the table stays rectangular', () => {
    const out = renderMarkdown({ title: 'T', sections: [{ heading: 'H', table: { headers: ['a|b', 'c'], rows: [['x|y'], ['p', 'q', 'r']] } }] });
    expect(out).toContain('| a\\|b | c |\n');
    expect(out).toContain('| x\\|y |  |\n');
    expect(out).toContain('| p | q |\n');   // extra cells are dropped, never widening the table
  });

  it('ends with exactly one newline', () => {
    const out = renderMarkdown({ title: 'T', sections: [{ heading: 'H', paragraphs: ['p'] }] });
    expect(out.endsWith('p\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

describe('markdownFilename', () => {
  it('names the file from the prefix, the region and the window end', () => {
    expect(markdownFilename('opswatch-audit', 'eu-west-1', Date.parse('2026-09-18T14:00:00Z'))).toBe('opswatch-audit-eu-west-1-2026-09-18.md');
  });
  it('refuses anything that is not a plain region token', () => {
    expect(markdownFilename('opswatch-audit', 'eu west/1"', Date.parse('2026-09-18T14:00:00Z'))).toBe('opswatch-audit-2026-09-18.md');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/analysis-markdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
import 'server-only';

export type MarkdownTable = { headers: string[]; rows: string[][] };
export type MarkdownSection = { heading: string; paragraphs?: string[]; bullets?: string[]; table?: MarkdownTable };
export type MarkdownDoc = { title: string; subtitle?: string; sections: MarkdownSection[] };

/** Cells are localized text and AWS identifiers: only the pipe, the backslash and newlines can break a table. */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function renderTable(table: MarkdownTable): string[] {
  const width = table.headers.length;
  const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => escapeMarkdownCell(cells[i] ?? '')).join(' | ')} |`;
  return [row(table.headers), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...table.rows.map(row)];
}

/** Blocks are joined by a blank line; the document ends with exactly one newline. */
export function renderMarkdown(doc: MarkdownDoc): string {
  const blocks: string[] = [`# ${doc.title}`];
  if (doc.subtitle) blocks.push(doc.subtitle);
  for (const section of doc.sections) {
    blocks.push(`## ${section.heading}`);
    for (const paragraph of section.paragraphs ?? []) blocks.push(paragraph);
    if (section.bullets && section.bullets.length > 0) blocks.push(section.bullets.map((b) => `- ${b}`).join('\n'));
    if (section.table) blocks.push(renderTable(section.table).join('\n'));
  }
  return `${blocks.join('\n\n')}\n`;
}

const SAFE_REGION = /^[a-z0-9-]{1,32}$/;

/** The filename reaches a Content-Disposition header, so anything but a plain region token is dropped. */
export function markdownFilename(prefix: string, region: string, endMs: number): string {
  const day = new Date(endMs).toISOString().slice(0, 10);
  return SAFE_REGION.test(region) ? `${prefix}-${region}-${day}.md` : `${prefix}-${day}.md`;
}
```

- [ ] **Step 4: Register the boundary and run the tests**

Add `'lib/analysis/markdown.ts'` to `SERVER_ONLY_MODULES`.
Run: `npx vitest run tests/unit/analysis-markdown.test.ts tests/unit/module-boundaries.test.ts`
Expected: pass.

- [ ] **Step 5: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`. (knip reports the file as unused until Task 24; note it in the commit body.)
Commit: `feat(analysis): Markdown renderer for reports and audit findings`.

**moto limits:** none.
**Owner-only verification:** the Markdown pastes cleanly into their ticket system — checked at the Phase 3 checkpoint.

---

### Task 4: Client-safe facet, sort and band primitives

Implements the data half of spec §1b: facets with counts computed over the *unfiltered* set, sortable columns, and the threshold bands and value bands the dense components colour by. These live in `src/lib/monitoring/shared/` because both server pages and client components read them.

**Files:**
- Create: `src/lib/monitoring/shared/facets.ts`, `src/lib/monitoring/shared/table-sort.ts`, `src/lib/monitoring/shared/bands.ts`
- Create: `tests/unit/monitoring-facets.test.ts`, `tests/unit/monitoring-table-sort.test.ts`, `tests/unit/monitoring-bands.test.ts`

**Interfaces:**
- Consumes: `Tone` from `@/lib/ui/tones` (dependency-free, client-safe). Nothing else — these files must import no AWS, zod, Node, database, `server-only` or `next-intl/server` symbol, which `tests/unit/module-boundaries.test.ts` already enforces for the client module graph.
- Produces (`facets.ts`):
  - `export type FacetValue = { value: string; count: number };`
  - `export type FacetGroup = { id: string; values: FacetValue[] };`
  - `export type FacetSelection = Record<string, string[]>;`
  - `export type FacetAccessors<T> = Record<string, (item: T) => string | null>;`
  - `export function countFacets<T>(items: readonly T[], accessors: FacetAccessors<T>): FacetGroup[]`
  - `export function parseFacetSelection(params: Record<string, string | string[] | undefined>, groupIds: readonly string[]): FacetSelection`
  - `export function applyFacets<T>(items: readonly T[], selection: FacetSelection, accessors: FacetAccessors<T>): T[]`
  - `export function toggleFacetQuery(search: string, groupId: string, value: string, checked: boolean): string`
  - `export function clearFacetsQuery(search: string, groupIds: readonly string[]): string`
  - `export function isFacetSelected(selection: FacetSelection, groupId: string, value: string): boolean`
  - `export const FACET_VALUE_MAX = 40;` (longest facet value kept from the URL)
- Produces (`table-sort.ts`):
  - `export type SortDirection = 'asc' | 'desc';`
  - `export type SortState = { column: string; direction: SortDirection };`
  - `export type SortAccessors<T> = Record<string, (row: T) => number | string | null>;`
  - `export function parseSort(value: string | string[] | undefined, columns: readonly string[], fallback: SortState): SortState`
  - `export function sortRows<T>(rows: readonly T[], state: SortState, accessors: SortAccessors<T>): T[]`
  - `export function sortQuery(search: string, column: string, current: SortState): string`
  - `export function nextDirection(column: string, current: SortState): SortDirection`
- Produces (`bands.ts`):
  - `export type ThresholdLevels = { warning: number; critical?: number; direction: 'above' | 'below' };`
  - `export type ThresholdBand = { from: number; to: number | null; tone: Tone };`
  - `export function bandsFor(levels: ThresholdLevels, max: number | null): ThresholdBand[]`
  - `export function toneForValue(value: number | null, levels: ThresholdLevels): Tone | null`
  - `export const CPU_BANDS = [10, 50, 85] as const;`
  - `export function cpuBand(value: number | null): 'unknown' | 'idle' | 'low' | 'medium' | 'high'`
  - `export const VOLUME_BANDS = [1_048_576, 1_073_741_824, 10_737_418_240] as const;`
  - `export function volumeBand(bytes: number | null): 'unknown' | 'tiny' | 'small' | 'large' | 'huge'`

- [ ] **Step 1: Write the failing facet test**

Create `tests/unit/monitoring-facets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyFacets, clearFacetsQuery, countFacets, isFacetSelected, parseFacetSelection, toggleFacetQuery } from '@/lib/monitoring/shared/facets';

type Row = { name: string; engine: string; role: string; pi: boolean };
const rows: Row[] = [
  { name: 'a', engine: 'mysql', role: 'writer', pi: true },
  { name: 'b', engine: 'mysql', role: 'reader', pi: false },
  { name: 'c', engine: 'aurora-postgresql', role: 'writer', pi: true },
  { name: 'd', engine: 'aurora-postgresql', role: 'reader', pi: false },
];
const accessors = { engine: (r: Row) => r.engine, role: (r: Row) => r.role, pi: (r: Row) => (r.pi ? 'on' : 'off') };

describe('countFacets', () => {
  it('counts every value of every group, most frequent first then alphabetical', () => {
    expect(countFacets(rows, accessors)).toEqual([
      { id: 'engine', values: [{ value: 'aurora-postgresql', count: 2 }, { value: 'mysql', count: 2 }] },
      { id: 'role', values: [{ value: 'reader', count: 2 }, { value: 'writer', count: 2 }] },
      { id: 'pi', values: [{ value: 'off', count: 2 }, { value: 'on', count: 2 }] },
    ]);
  });
  it('skips items whose accessor returns null and drops a group with no value', () => {
    expect(countFacets([{ name: 'a', engine: 'mysql', role: 'writer', pi: true }], { cluster: () => null })).toEqual([]);
  });
  it('orders by count before name', () => {
    const many = [...rows, { name: 'e', engine: 'mysql', role: 'writer', pi: true }];
    expect(countFacets(many, { engine: (r: Row) => r.engine })[0].values).toEqual([
      { value: 'mysql', count: 3 }, { value: 'aurora-postgresql', count: 2 },
    ]);
  });
});

describe('parseFacetSelection', () => {
  it('reads only the known groups, deduplicates and bounds each value', () => {
    expect(parseFacetSelection({ engine: ['mysql', 'mysql'], role: 'writer', other: 'x' }, ['engine', 'role'])).toEqual({ engine: ['mysql'], role: ['writer'] });
    expect(parseFacetSelection({ engine: 'x'.repeat(60) }, ['engine']).engine[0]).toHaveLength(40);
    expect(parseFacetSelection({}, ['engine'])).toEqual({});
  });
});

describe('applyFacets', () => {
  it('ORs inside a group and ANDs across groups', () => {
    expect(applyFacets(rows, { engine: ['mysql'] }, accessors).map((r) => r.name)).toEqual(['a', 'b']);
    expect(applyFacets(rows, { engine: ['mysql', 'aurora-postgresql'] }, accessors).map((r) => r.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyFacets(rows, { engine: ['mysql'], role: ['writer'] }, accessors).map((r) => r.name)).toEqual(['a']);
  });
  it('keeps everything when nothing is selected, and excludes null values of a selected group', () => {
    expect(applyFacets(rows, {}, accessors)).toHaveLength(4);
    expect(applyFacets(rows, { cluster: ['x'] }, { cluster: () => null })).toEqual([]);
  });
});

describe('the URL round trip', () => {
  it('adds, removes and clears values while keeping the rest of the query', () => {
    expect(toggleFacetQuery('range=12h&engine=mysql', 'engine', 'aurora-postgresql', true)).toBe('range=12h&engine=mysql&engine=aurora-postgresql');
    expect(toggleFacetQuery('range=12h&engine=mysql&engine=x', 'engine', 'mysql', false)).toBe('range=12h&engine=x');
    expect(toggleFacetQuery('range=12h&engine=mysql', 'engine', 'mysql', true)).toBe('range=12h&engine=mysql');
    expect(clearFacetsQuery('range=12h&engine=mysql&role=writer&sort=cpu', ['engine', 'role'])).toBe('range=12h&sort=cpu');
  });
  it('tells whether a value is selected', () => {
    expect(isFacetSelected({ engine: ['mysql'] }, 'engine', 'mysql')).toBe(true);
    expect(isFacetSelected({ engine: ['mysql'] }, 'engine', 'x')).toBe(false);
    expect(isFacetSelected({}, 'engine', 'mysql')).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing sort test**

Create `tests/unit/monitoring-table-sort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextDirection, parseSort, sortQuery, sortRows } from '@/lib/monitoring/shared/table-sort';

type Row = { name: string; cpu: number | null };
const rows: Row[] = [{ name: 'b', cpu: 10 }, { name: 'a', cpu: null }, { name: 'c', cpu: 40 }, { name: 'd', cpu: 10 }];
const accessors = { name: (r: Row) => r.name, cpu: (r: Row) => r.cpu };
const fallback = { column: 'name', direction: 'asc' } as const;

describe('parseSort', () => {
  it('reads "column:direction" and falls back on anything else', () => {
    expect(parseSort('cpu:desc', ['name', 'cpu'], fallback)).toEqual({ column: 'cpu', direction: 'desc' });
    expect(parseSort('cpu', ['name', 'cpu'], fallback)).toEqual({ column: 'cpu', direction: 'asc' });
    expect(parseSort('unknown:desc', ['name', 'cpu'], fallback)).toEqual(fallback);
    expect(parseSort(['cpu:desc', 'name:asc'], ['name', 'cpu'], fallback)).toEqual({ column: 'cpu', direction: 'desc' });
    expect(parseSort(undefined, ['name', 'cpu'], fallback)).toEqual(fallback);
  });
});

describe('sortRows', () => {
  it('sorts numbers, is stable for ties, and keeps nulls last in both directions', () => {
    expect(sortRows(rows, { column: 'cpu', direction: 'desc' }, accessors).map((r) => r.name)).toEqual(['c', 'b', 'd', 'a']);
    expect(sortRows(rows, { column: 'cpu', direction: 'asc' }, accessors).map((r) => r.name)).toEqual(['b', 'd', 'c', 'a']);
  });
  it('sorts strings with the English collator', () => {
    expect(sortRows(rows, { column: 'name', direction: 'asc' }, accessors).map((r) => r.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortRows(rows, { column: 'name', direction: 'desc' }, accessors).map((r) => r.name)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('returns the rows untouched when the column has no accessor', () => {
    expect(sortRows(rows, { column: 'nope', direction: 'asc' }, accessors)).toEqual(rows);
  });
});

describe('sortQuery and nextDirection', () => {
  it('a new column starts descending, the active column flips', () => {
    expect(nextDirection('cpu', { column: 'name', direction: 'asc' })).toBe('desc');
    expect(nextDirection('cpu', { column: 'cpu', direction: 'desc' })).toBe('asc');
    expect(sortQuery('range=12h&sort=name:asc', 'cpu', { column: 'name', direction: 'asc' })).toBe('range=12h&sort=cpu%3Adesc');
  });
});
```

- [ ] **Step 3: Write the failing band test**

Create `tests/unit/monitoring-bands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bandsFor, cpuBand, toneForValue, volumeBand } from '@/lib/monitoring/shared/bands';

const cpu = { warning: 85, critical: 95, direction: 'above' } as const;
const memory = { warning: 5, direction: 'below' } as const;

describe('bandsFor', () => {
  it('builds healthy, warning and critical bands for an upward threshold', () => {
    expect(bandsFor(cpu, 100)).toEqual([
      { from: 0, to: 85, tone: 'success' },
      { from: 85, to: 95, tone: 'warning' },
      { from: 95, to: 100, tone: 'danger' },
    ]);
  });
  it('leaves the top band open when there is no maximum', () => {
    expect(bandsFor({ warning: 1, direction: 'above' }, null)).toEqual([
      { from: 0, to: 1, tone: 'success' },
      { from: 1, to: null, tone: 'warning' },
    ]);
  });
  it('inverts the bands for a downward threshold', () => {
    expect(bandsFor(memory, 100)).toEqual([
      { from: 0, to: 5, tone: 'warning' },
      { from: 5, to: 100, tone: 'success' },
    ]);
  });
});

describe('toneForValue', () => {
  it('is exclusive at the threshold, matching breachActive', () => {
    expect(toneForValue(84.9, cpu)).toBe('success');
    expect(toneForValue(85, cpu)).toBe('success');
    expect(toneForValue(85.1, cpu)).toBe('warning');
    expect(toneForValue(96, cpu)).toBe('danger');
    expect(toneForValue(4, memory)).toBe('warning');
    expect(toneForValue(6, memory)).toBe('success');
    expect(toneForValue(null, cpu)).toBeNull();
  });
});

describe('cpuBand and volumeBand', () => {
  it('bands CPU on 10, 50 and 85 per cent', () => {
    expect([null, 0, 9.9, 10, 49, 60, 90].map(cpuBand)).toEqual(['unknown', 'idle', 'idle', 'low', 'low', 'medium', 'high']);
  });
  it('bands volume on 1 MiB, 1 GiB and 10 GiB', () => {
    expect([null, 0, 1_048_575, 1_048_576, 1_073_741_823, 1_073_741_824, 10_737_418_240].map(volumeBand))
      .toEqual(['unknown', 'tiny', 'tiny', 'small', 'small', 'large', 'huge']);
  });
});
```

- [ ] **Step 4: Run all three to see them fail**

Run: `npx vitest run tests/unit/monitoring-facets.test.ts tests/unit/monitoring-table-sort.test.ts tests/unit/monitoring-bands.test.ts`
Expected: FAIL — three missing modules.

- [ ] **Step 5: Write the three modules**

`facets.ts`. Counting always runs on the unfiltered list (spec §1b: "counts always reflect the unfiltered set so the user can see what they are excluding"), which is why `countFacets` takes the items and never the selection. The non-obvious parts:

```ts
export const FACET_VALUE_MAX = 40;

export function countFacets<T>(items: readonly T[], accessors: FacetAccessors<T>): FacetGroup[] {
  return Object.entries(accessors)
    .map(([id, read]) => {
      const counts = new Map<string, number>();
      for (const item of items) {
        const value = read(item);
        if (value === null) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return {
        id,
        values: [...counts.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'en')),
      };
    })
    .filter((group) => group.values.length > 0);
}

export function applyFacets<T>(items: readonly T[], selection: FacetSelection, accessors: FacetAccessors<T>): T[] {
  const active = Object.entries(selection).filter(([, values]) => values.length > 0);
  if (active.length === 0) return [...items];
  return items.filter((item) =>
    active.every(([id, values]) => {
      const read = accessors[id];
      if (!read) return true;            // an unknown group never filters anything out
      const value = read(item);
      return value !== null && values.includes(value);
    }),
  );
}

export function toggleFacetQuery(search: string, groupId: string, value: string, checked: boolean): string {
  const params = new URLSearchParams(search);
  const kept = params.getAll(groupId).filter((v) => v !== value);
  params.delete(groupId);
  for (const v of kept) params.append(groupId, v);
  if (checked) params.append(groupId, value);
  return params.toString();
}
```

`parseFacetSelection` reads `params[groupId]`, normalizes to an array, trims, drops blanks, slices each value to `FACET_VALUE_MAX`, deduplicates with a `Set`, and omits the group entirely when nothing is left (so `{}` means "no filter"). `clearFacetsQuery` deletes each group id and returns the rest of the query string.

`table-sort.ts`:

```ts
export function parseSort(value: string | string[] | undefined, columns: readonly string[], fallback: SortState): SortState {
  const first = Array.isArray(value) ? value[0] : value;
  const [column, direction] = (first ?? '').split(':');
  if (!columns.includes(column)) return fallback;
  return { column, direction: direction === 'desc' ? 'desc' : 'asc' };
}

export function sortRows<T>(rows: readonly T[], state: SortState, accessors: SortAccessors<T>): T[] {
  const read = accessors[state.column];
  if (!read) return [...rows];
  const sign = state.direction === 'asc' ? 1 : -1;
  // Decorate with the original index so ties keep their input order in both directions.
  return rows
    .map((row, index) => ({ row, index, key: read(row) }))
    .sort((a, b) => {
      // Nulls sort last whichever way the column points: an absent value is never "the best" or "the worst".
      if (a.key === null && b.key === null) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      const compared = typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key), 'en');
      return compared === 0 ? a.index - b.index : compared * sign;
    })
    .map((entry) => entry.row);
}

export function nextDirection(column: string, current: SortState): SortDirection {
  return current.column === column && current.direction === 'desc' ? 'asc' : 'desc';
}

export function sortQuery(search: string, column: string, current: SortState): string {
  const params = new URLSearchParams(search);
  params.set('sort', `${column}:${nextDirection(column, current)}`);
  return params.toString();
}
```

`bands.ts`:

```ts
import type { Tone } from '@/lib/ui/tones';

export function bandsFor(levels: ThresholdLevels, max: number | null): ThresholdBand[] {
  if (levels.direction === 'below') {
    return [{ from: 0, to: levels.warning, tone: 'warning' }, { from: levels.warning, to: max, tone: 'success' }];
  }
  const bands: ThresholdBand[] = [{ from: 0, to: levels.warning, tone: 'success' }];
  if (levels.critical === undefined) return [...bands, { from: levels.warning, to: max, tone: 'warning' }];
  return [...bands, { from: levels.warning, to: levels.critical, tone: 'warning' }, { from: levels.critical, to: max, tone: 'danger' }];
}

/** Exclusive at the threshold, exactly like `breachActive` in evaluate.ts, so a chart band and a rule agree. */
export function toneForValue(value: number | null, levels: ThresholdLevels): Tone | null {
  if (value === null || !Number.isFinite(value)) return null;
  const past = (t: number) => (levels.direction === 'above' ? value > t : value < t);
  if (levels.critical !== undefined && past(levels.critical)) return 'danger';
  return past(levels.warning) ? 'warning' : 'success';
}
```

`cpuBand` and `volumeBand` use `>=` against `CPU_BANDS` / `VOLUME_BANDS` from the top down and return `'unknown'` for `null` or a non-finite value.

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/unit/monitoring-facets.test.ts tests/unit/monitoring-table-sort.test.ts tests/unit/monitoring-bands.test.ts tests/unit/module-boundaries.test.ts`
Expected: all pass. The boundary test must stay green without any change: these three files import nothing forbidden.

- [ ] **Step 7: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`.
Commit: `feat(monitoring): facet, sort and threshold-band primitives`.

**moto limits:** none.
**Owner-only verification:** none.

---

### Task 5: Dense list components — facets panel, status bar, dense table

Implements the list half of spec §1b. Built once here and reused by the Queries, Volume, Endpoints, report and list pages. The components are described by their props and behaviour, not by their JSX; the implementer writes the markup.

**Files:**
- Create: `src/components/analysis/facets-panel.tsx` (client), `src/components/analysis/status-bar.tsx` (server), `src/components/analysis/dense-table.tsx` (server)
- Create: `tests/unit/analysis-dense-table.test.ts`
- Modify: `src/i18n/client-messages.ts` is **not** modified (the panel lives under the already-listed `Monitoring.client`), `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `FacetGroup`, `FacetSelection`, `isFacetSelected`, `toggleFacetQuery`, `clearFacetsQuery` from `@/lib/monitoring/shared/facets`; `SortState`, `nextDirection`, `sortQuery` from `@/lib/monitoring/shared/table-sort`; `Tone`, `TONE_SOFT`, `TONE_DOT` from `@/lib/ui/tones`; `Link`, `usePathname` from `@/i18n/navigation`; `useSearchParams` from `next/navigation`; `Checkbox` from `@/components/ui/checkbox`; `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow` from `@/components/ui/table`; `cn` from `@/lib/utils`; `getTranslations` from `next-intl/server`; `useTranslations` from `next-intl`.
- Produces (`facets-panel.tsx`):
  - `export type FacetGroupView = { id: string; label: string; values: { value: string; label: string; count: number }[] };`
  - `export function FacetsPanel({ groups, selection }: { groups: FacetGroupView[]; selection: FacetSelection }): React.JSX.Element | null`
- Produces (`status-bar.tsx`):
  - `export type StatusSegment = { key: string; label: string; count: number; tone: Tone; href: string };`
  - `export async function StatusBar({ segments, label }: { segments: readonly StatusSegment[]; label: string }): Promise<React.JSX.Element | null>`
- Produces (`dense-table.tsx`):
  - `export type ColumnPriority = 'always' | 'sm' | 'md' | 'lg';`
  - `export type DenseColumn = { id: string; label: string; align?: 'left' | 'right'; priority?: ColumnPriority; sortable?: boolean };`
  - `export type DenseRow = { id: string; cells: Record<string, React.ReactNode>; tone?: Tone };`
  - `export function columnClass(priority: ColumnPriority | undefined): string`
  - `export async function DenseTable({ caption, columns, rows, sort, sortParam, shown, total, emptyKey }: { caption: string; columns: readonly DenseColumn[]; rows: readonly DenseRow[]; sort?: SortState; sortParam?: string; shown: number; total: number; emptyKey: string }): Promise<React.JSX.Element>`

**Component behaviour, precisely:**

`FacetsPanel` — a client component because it writes the URL as the user ticks boxes. It renders `null` when `groups` is empty. Layout: `<nav aria-label={t('facets.label')}>` containing one `<fieldset>` per group; the `<legend>` is `group.label`; each value is a `<label>` wrapping a shadcn `Checkbox` (checked from `isFacetSelected(selection, group.id, value.value)`), the value's `label`, and the count in `<span className="ml-auto tabular-nums text-xs text-muted-foreground">`. Ticking navigates: the checkbox's `onCheckedChange` pushes `` `${pathname}?${toggleFacetQuery(searchParams.toString(), group.id, value, checked)}` `` through the next-intl `Link`'s router equivalent — **implement it as a `<Link>` wrapping the row with the checkbox rendered non-interactive (`tabIndex={-1}` and `aria-hidden`) so the whole thing works without JavaScript**, which is what "Selecting a value filters the table and keeps the URL shareable" and "everything stays a plain link" require. A "Clear filters" `<Link href={pathname + '?' + clearFacetsQuery(...)}>`, labelled `t('facets.clear')`, appears only when at least one group has a selection. Below 1024 px the panel collapses into a `<details>` whose `<summary>` is `t('facets.label')` plus the number of active filters (`t('facets.active', { count })`).

`StatusBar` — a server component. Renders `null` when every segment count is 0. One `<div role="img" aria-label={label}>` holding a flex row of `<Link>` segments; each segment's width is `flex-grow` proportional to its count (`style={{ flexGrow: segment.count }}`), its background is `TONE_SOFT[segment.tone]`, and it contains `segment.label` (already interpolated, e.g. "3 degraded"). Segments with count 0 are dropped. Colour is never the only signal: each segment also carries its label as text and, when the segment is too narrow for text (under 64 px it cannot be measured server-side, so it is always rendered), the label stays in a `sr-only` span in addition. A legend `<ul>` under the bar repeats every segment as a `TONE_DOT` dot plus its label, so the bar is readable at 360 px.

`DenseTable` — a server component around the existing shadcn `Table`. `columnClass('always')` is `''`, `'sm'` is `'hidden sm:table-cell'`, `'md'` is `'hidden md:table-cell'`, `'lg'` is `'hidden lg:table-cell'` — this is how "row density stays readable at 360 px by dropping the least important columns first" is implemented. A header cell whose column is `sortable` and whose `sort`/`sortParam` props are present renders a `<Link href={`?${sortQuery(currentSearch, column.id, sort)}`}>` carrying `aria-sort={sort.column === column.id ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}` on the `<TableHead>` and an up or down chevron. `currentSearch` cannot be read on the server from the component, so `DenseTable` takes the sort link builder pre-bound: **add a prop `sortHref?: (column: string) => string`** and require it whenever `sort` is given; the page builds it from its own `searchParams`. Right-aligned numeric columns get `text-right tabular-nums`. A row with a `tone` gets a 2 px left border in that tone. Under the table, one line: `t('table.showing', { shown, total })`. An empty `rows` array renders `t(emptyKey)` in muted text instead of a `<tbody>`.

- [ ] **Step 1: Write the failing test for the pure part**

Only `columnClass` is pure and worth a unit test; the components are covered by the e2e specs of Phase 2 and 3. Create `tests/unit/analysis-dense-table.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { columnClass } from '@/components/analysis/dense-table';

describe('columnClass', () => {
  it('drops the least important columns first as the screen narrows', () => {
    expect(columnClass('always')).toBe('');
    expect(columnClass(undefined)).toBe('');
    expect(columnClass('sm')).toBe('hidden sm:table-cell');
    expect(columnClass('md')).toBe('hidden md:table-cell');
    expect(columnClass('lg')).toBe('hidden lg:table-cell');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/analysis-dense-table.test.ts`
Expected: FAIL — `Cannot find module '@/components/analysis/dense-table'`.

- [ ] **Step 3: Write the three components** as described above.

- [ ] **Step 4: Add the messages**

Under `Monitoring.client`, add a `facets` object (client-side, because the panel is a client component); under `Monitoring.common`, add a `table` object (server-side).

| Key | EN | FR |
|---|---|---|
| `Monitoring.client.facets.label` | `Filters` | `Filtres` |
| `Monitoring.client.facets.clear` | `Clear filters` | `Effacer les filtres` |
| `Monitoring.client.facets.active` | `{count, plural, one {# filter} other {# filters}}` | `{count, plural, one {# filtre} other {# filtres}}` |
| `Monitoring.common.table.showing` | `Showing {shown} of {total}` | `{shown} sur {total} affichés` |
| `Monitoring.common.table.sortBy` | `Sort by {column}` | `Trier par {column}` |
| `Monitoring.common.statusBar.label` | `Resources by state` | `Ressources par état` |

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/analysis-dense-table.test.ts tests/unit/i18n-messages.test.ts tests/unit/client-messages.test.ts tests/unit/module-boundaries.test.ts`
Expected: all pass. `client-messages.test.ts` proves `Monitoring.client.facets` reaches the browser; `module-boundaries.test.ts` proves `facets-panel.tsx` imports nothing server-only.

- [ ] **Step 6: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`.
Commit: `feat(analysis): facets panel, status bar and dense table`.

**moto limits:** none — no AWS call.
**Owner-only verification:** none, but the Phase 1 checkpoint (Task 7) renders all three on a scratch page at 360 px.

---

### Task 6: Dense figure components — KPI tiles, top-N bars, heat grid, change arrow, threshold bands

Implements the figure half of spec §1b: "KPI tiles", "Top-N bars", "Heat grid", "Charts with threshold bands", plus the change arrow that every report row needs (spec §3 item 3).

**Files:**
- Create: `src/components/analysis/kpi-tile.tsx` (server), `src/components/analysis/top-n-bars.tsx` (server), `src/components/analysis/heat-grid.tsx` (server), `src/components/analysis/change-arrow.tsx` (server)
- Create: `tests/unit/analysis-figures.test.ts`
- Modify: `src/components/monitoring/metric-chart.tsx` (add the optional `bands` prop), `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `Change` from `@/lib/analysis/window` — **but `metric-chart.tsx` is a client component and must not import a server-only module**, so the `Change` type is re-declared where the client needs it: `ChangeArrow` is a *server* component and imports `Change` from `@/lib/analysis/window`; `MetricChart` only gains `bands?: ThresholdBand[]` from the client-safe `@/lib/monitoring/shared/bands`. Also consumes `ThresholdBand`, `toneForValue` from `@/lib/monitoring/shared/bands`; `Tone`, `TONE_SOFT`, `TONE_TEXT`, `TONE_DOT` from `@/lib/ui/tones`; `formatMetricValue`, `MetricUnit`, `NO_VALUE` from `@/lib/monitoring/shared/format`; `getLocale`, `getTranslations` from `next-intl/server`; `Link` from `@/i18n/navigation`; `ReferenceArea` from `recharts` (already a dependency).
- Produces (`change-arrow.tsx`):
  - `export async function ChangeArrow({ change, rangeKey }: { change: Change; rangeKey: '3h' | '12h' | '24h' | '7d' }): Promise<React.JSX.Element>`
  - `export function changeText(change: Change, locale: string): string` — the percentage as text, used by Markdown and by the arrow's label.
- Produces (`kpi-tile.tsx`):
  - `export async function KpiTile({ label, value, unit, tone, windowLabel, change, rangeKey, href }: { label: string; value: number | null; unit: MetricUnit; tone: Tone | null; windowLabel: string; change?: Change; rangeKey?: '3h' | '12h' | '24h' | '7d'; href?: string }): Promise<React.JSX.Element>`
- Produces (`top-n-bars.tsx`):
  - `export type BarItem = { id: string; name: string; value: number | null; href?: string; tone?: Tone };`
  - `export async function TopNBars({ label, items, unit, max }: { label: string; items: readonly BarItem[]; unit: MetricUnit; max?: number | null }): Promise<React.JSX.Element>`
  - `export function barWidths(items: readonly BarItem[], max: number | null | undefined): number[]`
- Produces (`heat-grid.tsx`):
  - `export type HeatCell = { id: string; name: string; value: number | null; tone: Tone | null; href: string };`
  - `export async function HeatGrid({ label, cells, unit }: { label: string; cells: readonly HeatCell[]; unit: MetricUnit }): Promise<React.JSX.Element>`

**Component behaviour, precisely:**

`ChangeArrow` — `<span>` carrying, by kind: `up` a `TrendingUp` icon in `TONE_TEXT.danger` (a rise is the bad direction for every metric this stage ranks: CPU, errors, latency, bytes) plus the signed percentage; `down` a `TrendingDown` icon in `TONE_TEXT.success`; `flat` a `Minus` icon in `text-muted-foreground` plus `NO_VALUE`… no — plus the message `Monitoring.common.change.flat`; `new` a `Sparkle` icon plus the message; `unavailable` a muted `NO_VALUE` with an `sr-only` `Monitoring.common.change.unavailable`. Every kind also carries an `sr-only` span with the full sentence `t(\`change.${kind}\`, { percent, window: t(\`window.${rangeKey}\`) })`, because colour and an icon are never the only signal. Where a rise is the *good* direction the caller passes nothing — no report in this stage ranks a metric where up is good, and that is stated in the component's doc comment.

`changeText(change, locale)` returns `Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(change.ratio)` for `up`, `down` and `flat`, and `NO_VALUE` for `new` and `unavailable`.

`KpiTile` — a bordered box: the label in `text-sm text-muted-foreground`, the value in `text-3xl font-semibold tabular-nums` from `formatMetricValue(value, unit, locale)`, the `windowLabel` under it in `text-xs text-muted-foreground`, and the `ChangeArrow` when `change` and `rangeKey` are given. `tone` colours the border (`TONE_SOFT[tone]` background at low opacity plus a `TONE_DOT[tone]` dot beside the label); `tone === null` leaves it neutral. With `href` the whole tile is a `<Link>`.

`TopNBars` — an ordered list, one row per item, the name on the left (a `<Link>` when `href` is given), a bar whose width is `barWidths(items, max)[i]` per cent of the track, and the formatted value right-aligned in `tabular-nums`. `barWidths` is the only testable arithmetic: the denominator is `max ?? the largest finite value`, a null or non-finite value gives 0, a denominator of 0 or less gives 0 for every row, and the result is clamped to `[0, 100]` and rounded to one decimal. The bar's colour is `TONE_SOFT[item.tone]` or the accent when no tone is given, and each row carries `aria-label` built from the name and the formatted value.

`HeatGrid` — `<ul role="list" aria-label={label}>` in a CSS grid of `minmax(2.5rem, 1fr)` columns; each cell is a `<Link>` whose background is `TONE_SOFT[cell.tone]` (neutral `bg-muted` when `tone` is null), whose `title` is `` `${cell.name} — ${formatMetricValue(cell.value, unit, locale)}` `` (this is the hover text §1b asks for, and it needs no JavaScript), and which contains an `sr-only` span with the same text plus, visible, the first two characters of the name. A legend under the grid names each tone with `Monitoring.common.heat.<tone>`.

`MetricChart` gains `bands?: ThresholdBand[]`. When present it renders one `<ReferenceArea y1={band.from} y2={band.to ?? undefined} fill="var(--tone-<tone>)" fillOpacity={0.08} strokeOpacity={0} />` per band, before the `<Line>` elements so the lines draw on top, and a visually-hidden `<figcaption>` addition listing the bands as text (`Monitoring.client.chart.bands`). The three CSS variables `--tone-success`, `--tone-warning`, `--tone-danger` must be added to `src/app/globals.css` in both themes, meeting WCAG AA against the chart background at the 8 % opacity used.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analysis-figures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { changeText } from '@/components/analysis/change-arrow';
import { barWidths } from '@/components/analysis/top-n-bars';

describe('changeText', () => {
  it('shows a signed percentage for a comparable change', () => {
    expect(changeText({ kind: 'up', ratio: 0.2 }, 'en')).toBe('+20%');
    expect(changeText({ kind: 'down', ratio: -0.205 }, 'en')).toBe('-20.5%');
    expect(changeText({ kind: 'flat', ratio: 0.004 }, 'en')).toBe('+0.4%');
    expect(changeText({ kind: 'new' }, 'en')).toBe('—');
    expect(changeText({ kind: 'unavailable' }, 'en')).toBe('—');
  });
  it('formats in French with its own separator', () => {
    expect(changeText({ kind: 'down', ratio: -0.205 }, 'fr')).toBe('-20,5 %');
  });
});

describe('barWidths', () => {
  const items = [
    { id: 'a', name: 'a', value: 100 },
    { id: 'b', name: 'b', value: 25 },
    { id: 'c', name: 'c', value: null },
  ];
  it('scales to the largest value when no maximum is given', () => {
    expect(barWidths(items, undefined)).toEqual([100, 25, 0]);
  });
  it('scales to an explicit maximum and clamps above it', () => {
    expect(barWidths(items, 200)).toEqual([50, 12.5, 0]);
    expect(barWidths([{ id: 'a', name: 'a', value: 300 }], 200)).toEqual([100]);
  });
  it('gives every row zero width when nothing is comparable', () => {
    expect(barWidths([{ id: 'a', name: 'a', value: 0 }, { id: 'b', name: 'b', value: 0 }], undefined)).toEqual([0, 0]);
    expect(barWidths([], undefined)).toEqual([]);
    expect(barWidths(items, 0)).toEqual([0, 0, 0]);
  });
  it('rounds to one decimal', () => {
    expect(barWidths([{ id: 'a', name: 'a', value: 1 }, { id: 'b', name: 'b', value: 3 }], undefined)).toEqual([33.3, 100]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/analysis-figures.test.ts`
Expected: FAIL — two missing modules.

- [ ] **Step 3: Write the four components and extend `MetricChart`** as described above.

- [ ] **Step 4: Add the CSS tone variables**

In `src/app/globals.css`, inside the existing `:root` block and its dark counterpart, add `--tone-success`, `--tone-warning` and `--tone-danger` with the same hues the `TONE_*` maps use (emerald 500, amber 500, red 500 in light; emerald 400, amber 400, red 400 in dark), so a band matches the badge beside it.

- [ ] **Step 5: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Monitoring.common.heat.success` | `Healthy` | `Sain` |
| `Monitoring.common.heat.warning` | `Warning` | `Avertissement` |
| `Monitoring.common.heat.danger` | `Critical` | `Critique` |
| `Monitoring.common.heat.unknown` | `No data` | `Aucune donnée` |
| `Monitoring.common.kpi.window` | `over the last {window}` | `sur les {window} écoulées` |
| `Monitoring.common.topN.label` | `{metric}, highest first` | `{metric}, du plus élevé au plus faible` |
| `Monitoring.common.topN.row` | `{name}: {value}` | `{name} : {value}` |
| `Monitoring.client.chart.bands` | `Bands: healthy up to {warning}, warning up to {critical}, critical above.` | `Bandes : sain jusqu'à {warning}, avertissement jusqu'à {critical}, critique au-delà.` |
| `Monitoring.client.chart.bandsWarningOnly` | `Bands: healthy up to {warning}, warning above.` | `Bandes : sain jusqu'à {warning}, avertissement au-delà.` |

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/analysis-figures.test.ts tests/unit/i18n-messages.test.ts tests/unit/client-messages.test.ts tests/unit/module-boundaries.test.ts`
Expected: all pass. The boundary test must still be green: `metric-chart.tsx` gained only an import from `@/lib/monitoring/shared/bands`, which is client-safe.

- [ ] **Step 7: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
Commit: `feat(analysis): KPI tiles, top-N bars, heat grid, change arrow and chart bands`.

**moto limits:** none.
**Owner-only verification:** that the band colours read correctly on their monitor in both themes — checked at the Phase 1 checkpoint.

---

### Task 7: Phase 1 checkpoint

No new behaviour. This task proves the primitives hold together, are reachable from nothing yet (so knip is honest about it), and are readable at 360 px, before Phase 2 starts building on them.

**Files:**
- Modify: `knip.json` **only if** the checkpoint concludes an entry is needed — see step 3.
- Create: nothing permanent. The scratch page of step 4 is deleted before the commit.

- [ ] **Step 1: Run every verification command**

Run each and record its output in the task report:
- `npm test` → every suite passes; the new suites are `analysis-window`, `analysis-coverage`, `analysis-markdown`, `analysis-dense-table`, `analysis-figures`, `monitoring-facets`, `monitoring-table-sort`, `monitoring-bands`. Expected: the pre-existing 425 unit tests still pass and the total has grown by at least 45.
- `npm run typecheck` → no output.
- `npm run lint` → no output.
- `npm run build` → succeeds.

- [ ] **Step 2: Check EN/FR parity by hand as well as by test**

Run: `node -e "const a=require('./messages/en.json'),b=require('./messages/fr.json');const k=(o,p='')=>Object.entries(o).flatMap(([x,v])=>typeof v==='object'&&v!==null?k(v,p+x+'.'):[p+x]);const A=k(a).sort(),B=k(b).sort();console.log(A.length,B.length);console.log(A.filter(x=>!B.includes(x)),B.filter(x=>!A.includes(x)))"`
Expected: two equal counts and two empty arrays.

- [ ] **Step 3: Settle knip**

Run: `npx knip`.
Expected at this point: `src/lib/analysis/window.ts`, `coverage.ts`, `markdown.ts`, `src/components/analysis/*` and the three `shared/` modules are reported as unused files, because nothing imports them yet. **Do not add them to `knip.json` ignores.** Record the exact list in the task report, note that Phase 2 Tasks 8–16 and Phase 3 Tasks 18–27 consume every one of them, and state that the Phase 2 checkpoint (Task 17) must show the list shrunk and the Phase 3 checkpoint (Task 28) must show it empty. If any file on the list is *not* claimed by a later task, delete the file now — it was not needed.

- [ ] **Step 4: Eyeball the primitives at 360 px**

Create a throwaway page at `src/app/[locale]/(app)/c/[connectionId]/[region]/overview/scratch/page.tsx` that calls `initMonitoringRoute(params)` first and then renders, with hard-coded fixture data and hard-coded English strings: a `StatusBar` with three segments (27 healthy, 3 degraded, 1 unreachable), a row of four `KpiTile`s (one of each tone plus one null value), a `TopNBars` with five items, a `HeatGrid` with 24 cells, a `DenseTable` with eight columns of mixed priority and twelve rows, a `FacetsPanel` with three groups, and a `MetricChart` with bands.
Run: `npm run dev`, open the page in a browser at 360 px, 768 px and 1440 px width in both themes.
Expected: no horizontal overflow at 360 px; the `lg` and `md` columns are hidden at 360 px and back at 1440 px; every tone is distinguishable *and* labelled in text; the facets panel is a `<details>` at 360 px and a sidebar at 1440 px; ticking a facet changes the URL and the checkbox state survives a reload.
Then **delete the scratch page and its directory** and re-run `npm run build`.

- [ ] **Step 5: Write the checkpoint report and commit**

Write the findings (test counts, the knip list, the screen-width observations, anything that needed changing) into the task report. Fix anything broken before committing.
Commit: `chore(analysis): phase 1 checkpoint — shared primitives verified`.

**moto limits:** none; no AWS call exists yet in this stage.
**Owner-only verification:** step 4's visual pass is the one thing worth showing the owner before Phase 2 builds twelve pages on it.

---

## Phase 2 — Navigation, cross-instance Queries, the first two reports and the first two dashboards

### Task 8: Sub-section catalogue and path helpers

Implements spec §1's URL scheme: `/<locale>/c/<connectionId>/<region>/<section>/<subsection>`. This task changes only the path vocabulary and the modules that build paths; Task 9 moves the actual route files. Splitting it this way keeps the move mechanical.

**Files:**
- Create: `src/lib/monitoring/shared/sections.ts`
- Modify: `src/lib/monitoring/shared/paths.ts`, `src/lib/monitoring/insights.ts`, `src/components/nav-items.ts`
- Modify: `tests/unit/monitoring-paths.test.ts`, `tests/unit/monitoring-insights.test.ts`, `tests/unit/nav-items.test.ts`
- Create: `tests/unit/monitoring-sections.test.ts`
- Modify: `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `MONITORING_SECTIONS`, `MonitoringSection`, `ScopeRef`, `monitoringPath`, `parseMonitoringPath` from `@/lib/monitoring/shared/paths`; `isOneOf` from `@/lib/type-guards`.
- Produces (`src/lib/monitoring/shared/sections.ts`):
  - `export const SUBSECTIONS = { … } as const satisfies Record<MonitoringSection, readonly [string, ...string[]]>;` with exactly the segments fixed in "Naming decisions fixed once".
  - `export type Subsection = (typeof SUBSECTIONS)[MonitoringSection][number];`
  - `export function subsectionsOf(section: MonitoringSection): readonly string[]`
  - `export function defaultSubsection(section: MonitoringSection): string`
  - `export function isSubsectionOf(section: MonitoringSection, value: string | undefined): boolean`
  - `export function subsectionLabelKey(section: MonitoringSection, subsection: string): string` → `` `Sections.${section}.${subsection}` ``
  - `export const SUBSECTION_ICONS: Record<string, 'list' | 'report' | 'audit' | 'queries' | 'volume' | 'endpoints' | 'search' | 'insights'>` — one icon name per segment, so the collapsed section panel has an icon for every entry.
- Produces (added to `src/lib/monitoring/shared/paths.ts`):
  - `export function subsectionPath(scope: ScopeRef, section: MonitoringSection, subsection: string, ...segments: string[]): string`
  - `ParsedMonitoringPath` gains `subsection: string | null`; `segments` now means the path parts *after* the subsection.
  - `withRegion` keeps the section **and** the subsection (resource segments are still dropped, because resources differ per region).
  - `switchConnectionPath` keeps the section and the subsection.

- [ ] **Step 1: Write the failing section test**

Create `tests/unit/monitoring-sections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MONITORING_SECTIONS } from '@/lib/monitoring/shared/paths';
import { SUBSECTIONS, SUBSECTION_ICONS, defaultSubsection, isSubsectionOf, subsectionLabelKey, subsectionsOf } from '@/lib/monitoring/shared/sections';

describe('the sub-section catalogue', () => {
  it('matches the spec table exactly', () => {
    expect(SUBSECTIONS).toEqual({
      overview: ['insights', 'audit'],
      containers: ['services', 'report'],
      databases: ['instances', 'queries', 'report'],
      'load-balancers': ['list', 'report'],
      alarms: ['list', 'report'],
      // Task 22 moves 'volume' to the front when the Logs dashboard exists; until then 'search' is the default.
      logs: ['search', 'volume', 'endpoints'],
    });
  });
  it('covers every section and gives each one a default', () => {
    for (const section of MONITORING_SECTIONS) {
      expect(subsectionsOf(section).length).toBeGreaterThan(0);
      expect(defaultSubsection(section)).toBe(subsectionsOf(section)[0]);
    }
    expect(defaultSubsection('databases')).toBe('instances');
    expect(defaultSubsection('load-balancers')).toBe('list');
  });
  it('recognises only its own segments', () => {
    expect(isSubsectionOf('databases', 'queries')).toBe(true);
    expect(isSubsectionOf('databases', 'audit')).toBe(false);
    expect(isSubsectionOf('databases', undefined)).toBe(false);
    expect(isSubsectionOf('databases', '')).toBe(false);
  });
  it('names one message key and one icon per segment', () => {
    expect(subsectionLabelKey('logs', 'volume')).toBe('Sections.logs.volume');
    for (const section of MONITORING_SECTIONS) {
      for (const sub of subsectionsOf(section)) expect(SUBSECTION_ICONS[sub]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Extend the failing path test**

Add to `tests/unit/monitoring-paths.test.ts`:

```ts
import { parseMonitoringPath, subsectionPath, switchConnectionPath, withRegion } from '@/lib/monitoring/shared/paths';

describe('sub-section paths', () => {
  const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };

  it('builds a sub-page path and a resource path under it', () => {
    expect(subsectionPath(scope, 'databases', 'queries')).toBe('/c/abc123def456/eu-west-1/databases/queries');
    expect(subsectionPath(scope, 'containers', 'services', 'prod', 'web')).toBe('/c/abc123def456/eu-west-1/containers/services/prod/web');
    expect(subsectionPath(scope, 'load-balancers', 'list', 'api alb')).toBe('/c/abc123def456/eu-west-1/load-balancers/list/api%20alb');
  });

  it('parses the sub-section and the segments after it', () => {
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/containers/services/prod/web')).toEqual({
      connectionId: 'abc123def456', region: 'eu-west-1', section: 'containers', subsection: 'services', segments: ['prod', 'web'],
    });
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/databases')).toEqual({
      connectionId: 'abc123def456', region: 'eu-west-1', section: 'databases', subsection: null, segments: [],
    });
    // An unknown segment is not a sub-section; it is left in segments so the page can 404 on it.
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/databases/nope')).toEqual({
      connectionId: 'abc123def456', region: 'eu-west-1', section: 'databases', subsection: null, segments: ['nope'],
    });
    expect(parseMonitoringPath('/accounts/abc123def456')).toBeNull();
  });

  it('keeps the sub-page when the region changes, and drops the resource', () => {
    expect(withRegion('/c/abc123def456/eu-west-1/databases/queries', 'us-east-1', 'range=12h&group=user'))
      .toBe('/c/abc123def456/us-east-1/databases/queries?range=12h&group=user');
    expect(withRegion('/c/abc123def456/eu-west-1/containers/services/prod/web', 'us-east-1'))
      .toBe('/c/abc123def456/us-east-1/containers/services');
    // Without a sub-section the default one is used, so a switch never lands on a bare section.
    expect(withRegion('/c/abc123def456/eu-west-1/alarms', 'us-east-1')).toBe('/c/abc123def456/us-east-1/alarms/list');
  });

  it('keeps the sub-page when the connection changes', () => {
    expect(switchConnectionPath('/c/abc123def456/eu-west-1/logs/volume', { connectionId: 'zzz999', region: 'us-east-1' }))
      .toBe('/c/zzz999/us-east-1/logs/volume');
    expect(switchConnectionPath('/accounts/abc123def456', { connectionId: 'zzz999', region: 'us-east-1' })).toBe('/accounts/zzz999');
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npx vitest run tests/unit/monitoring-sections.test.ts tests/unit/monitoring-paths.test.ts`
Expected: FAIL — missing `sections.ts`, missing `subsectionPath`, `subsection` absent from the parse result.

- [ ] **Step 4: Write `sections.ts` and extend `paths.ts`**

`sections.ts`:

```ts
import { MONITORING_SECTIONS, type MonitoringSection } from './paths';

/**
 * The second menu of §1. The first segment of each section is its default, and `/<section>` redirects there.
 * These segments are URL vocabulary and are never translated; `Sections.<section>.<segment>` holds their labels.
 */
export const SUBSECTIONS = {
  overview: ['insights', 'audit'],
  containers: ['services', 'report'],
  databases: ['instances', 'queries', 'report'],
  'load-balancers': ['list', 'report'],
  alarms: ['list', 'report'],
  // Task 22 moves 'volume' to the front when the Logs dashboard exists; until then 'search' stays the default
  // so `/logs` never redirects to a page that does not exist yet.
  logs: ['search', 'volume', 'endpoints'],
} as const satisfies Record<MonitoringSection, readonly [string, ...string[]]>;
```

plus `subsectionsOf`, `defaultSubsection` (`subsectionsOf(section)[0]`), `isSubsectionOf` (`value !== undefined && subsectionsOf(section).includes(value)`), `subsectionLabelKey`, and `SUBSECTION_ICONS` mapping `insights→insights`, `audit→audit`, `services→list`, `instances→list`, `list→list`, `report→report`, `queries→queries`, `search→search`, `volume→volume`, `endpoints→endpoints`. The `MONITORING_SECTIONS` import is used by nothing at runtime, so import only the type unless a runtime check needs it.

`paths.ts` changes:

```ts
export function subsectionPath(scope: ScopeRef, section: MonitoringSection, subsection: string, ...segments: string[]): string {
  return monitoringPath(scope, section, subsection, ...segments);
}

export type ParsedMonitoringPath = ScopeRef & { section: MonitoringSection | null; subsection: string | null; segments: string[] };

export function parseMonitoringPath(pathname: string): ParsedMonitoringPath | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'c' || parts.length < 3) return null;
  const section = isOneOf(MONITORING_SECTIONS, parts[3]) ? parts[3] : null;
  const rest = section ? parts.slice(4) : [];
  const subsection = section && isSubsectionOf(section, rest[0]) ? rest[0] : null;
  return { connectionId: parts[1], region: parts[2], section, subsection, segments: subsection ? rest.slice(1) : rest };
}

export function withRegion(pathname: string, region: string, search = ''): string {
  const parsed = parseMonitoringPath(pathname);
  if (!parsed) return search ? `${pathname}?${search}` : pathname;
  const section = parsed.section ?? 'overview';
  const path = subsectionPath({ connectionId: parsed.connectionId, region }, section, parsed.subsection ?? defaultSubsection(section));
  return search ? `${path}?${search}` : path;
}
```

`switchConnectionPath` gets the same treatment: keep its account-page branch untouched, then return `subsectionPath(target, section, parsed?.subsection ?? defaultSubsection(section))`.

**Circular import warning:** `sections.ts` imports the `MonitoringSection` type from `paths.ts`, and `paths.ts` now imports `isSubsectionOf`/`defaultSubsection` from `sections.ts`. Type-only imports do not create a runtime cycle, so `sections.ts` must import `MonitoringSection` with `import type`. Verify with `npm run build` (Next.js warns on genuine cycles).

- [ ] **Step 5: Point the insight and nav links at sub-pages**

In `src/lib/monitoring/insights.ts` replace every `monitoringPath` call:
- `monitoringPath(ctx.scope, 'containers', cluster, name)` → `subsectionPath(ctx.scope, 'containers', 'services', cluster, name)`
- `monitoringPath(ctx.scope, 'containers')` → `subsectionPath(ctx.scope, 'containers', 'services')`
- `monitoringPath(ctx.scope, 'databases', id)` / `(…, s.id)` → `subsectionPath(ctx.scope, 'databases', 'instances', id)`
- `monitoringPath(ctx.scope, 'databases')` → `subsectionPath(ctx.scope, 'databases', 'instances')`
- `monitoringPath(ctx.scope, 'load-balancers', name)` → `subsectionPath(ctx.scope, 'load-balancers', 'list', name)`
- `` `${monitoringPath(ctx.scope, 'alarms')}?state=ALARM` `` → `` `${subsectionPath(ctx.scope, 'alarms', 'list')}?state=ALARM` ``

Update the expected hrefs in `tests/unit/monitoring-insights.test.ts` accordingly.

In `src/components/nav-items.ts`, `navHref` must send a sidebar link to the section's default sub-page when there is no current selection and to the **same section's default sub-page** when there is: `monitoringPath(current, item.section)` becomes `subsectionPath(current, item.section, defaultSubsection(item.section))`, and the no-selection branch stays `/${item.section}` (the redirect page of Task 9 handles it). `isNavActive` is unchanged — it already matches on the section only, which is what highlights "Databases" while the Queries sub-page is open. Update `tests/unit/nav-items.test.ts` expectations.

- [ ] **Step 6: Add the sub-page labels**

New top-level namespace `Sections` in both message files. It is read by the client-side section panel (Task 9), so **add `'Sections'` to `CLIENT_NAMESPACES` in `src/i18n/client-messages.ts`** in Task 9, not here — here the keys only need to exist.

| Key | EN | FR |
|---|---|---|
| `Sections.overview.insights` | `Insights` | `Analyses` |
| `Sections.overview.audit` | `Audit` | `Audit` |
| `Sections.containers.services` | `Services` | `Services` |
| `Sections.containers.report` | `Report` | `Rapport` |
| `Sections.databases.instances` | `Instances` | `Instances` |
| `Sections.databases.queries` | `Queries` | `Requêtes` |
| `Sections.databases.report` | `Report` | `Rapport` |
| `Sections.load-balancers.list` | `Load balancers` | `Répartiteurs` |
| `Sections.load-balancers.report` | `Report` | `Rapport` |
| `Sections.alarms.list` | `Alarms` | `Alarmes` |
| `Sections.alarms.report` | `Report` | `Rapport` |
| `Sections.logs.search` | `Search` | `Recherche` |
| `Sections.logs.volume` | `Volume` | `Volume` |
| `Sections.logs.endpoints` | `Endpoints` | `Points d'entrée` |

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run tests/unit/monitoring-sections.test.ts tests/unit/monitoring-paths.test.ts tests/unit/monitoring-insights.test.ts tests/unit/nav-items.test.ts tests/unit/i18n-messages.test.ts`
Expected: all pass.

- [ ] **Step 8: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
Note: `npm test` will still pass because no route file has moved yet; the *e2e* suite would now fail (the insight links point at paths that do not exist), so **do not run e2e in this task** — Task 9 moves the routes and runs it.
Commit: `feat(monitoring): sub-section catalogue and sub-section-aware paths`.

**moto limits:** none.
**Owner-only verification:** none.

---

### Task 9: Section panel, page header, collapsible main rail, and the route move

Implements spec §1 in full (section panel with a collapse control, page header with breadcrumb plus region, range and auto-refresh, filter row, the sub-page URLs, the horizontal strip below 1024 px) and **spec §9.1**, which is binding: both menus collapse to icons with tooltips and both states are remembered per browser.

This is the largest task of the stage. Its risk is the file move, so the move comes first and is verified before any new component is written.

**Files:**
- Move (git mv, keeping content): every page and card file under `src/app/[locale]/(app)/c/[connectionId]/[region]/` into its sub-page directory —
  - `overview/page.tsx`, `overview/cards.tsx` → `overview/insights/`
  - `containers/page.tsx`, `containers/cards.tsx` → `containers/services/`; `containers/[cluster]/[service]/*` → `containers/services/[cluster]/[service]/`
  - `databases/page.tsx`, `databases/cards.tsx` → `databases/instances/`; `databases/[instance]/*` → `databases/instances/[instance]/`
  - `load-balancers/page.tsx`, `load-balancers/cards.tsx` → `load-balancers/list/`; `load-balancers/[name]/*` → `load-balancers/list/[name]/`
  - `alarms/page.tsx`, `alarms/cards.tsx` → `alarms/list/`
  - `logs/*` → `logs/search/` — **before moving, list the directory** (`ls "src/app/[locale]/(app)/c/[connectionId]/[region]/logs"`) and move whatever is there. At the time this plan was written it held `page.tsx`, `log-group-picker.tsx`, `log-group-list.tsx`, `logs-query-panel.tsx` and `logs-selection.tsx`, but **another agent is changing the Logs group picker in parallel**, so the file set may differ. Move the whole directory contents unchanged and change nothing inside those files except the `MonitoringHeader` call of step 4.
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/<section>/page.tsx` for all six sections — a redirect to the default sub-page.
- Create: `src/components/monitoring/section-panel.tsx` (client), `src/components/monitoring/section-page-header.tsx` (server), `src/components/monitoring/section-layout.tsx` (server), `src/components/monitoring/breadcrumb.tsx` (server), `src/components/rail-collapse.tsx` (client)
- Modify: `src/components/sidebar.tsx`, `src/components/app-shell.tsx`, `src/i18n/client-messages.ts`
- Delete: `src/components/monitoring/monitoring-header.tsx` (replaced by `section-page-header.tsx`)
- Create: `tests/unit/monitoring-section-panel.test.ts`, `tests/e2e/08-analysis.spec.ts`
- Modify: `tests/e2e/06-monitoring.spec.ts`, `tests/e2e/07-logs.spec.ts`, `tests/e2e/helpers.ts`, `tests/unit/monitoring-redirect.test.ts`, `tests/unit/monitoring-page-clock.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `initMonitoringRoute`, `MonitoringParams`, `MonitoringPageContext` from `@/lib/monitoring/route`; `initProtectedRoute` from `@/lib/auth/route`; `redirect` from `@/i18n/navigation`; `SUBSECTIONS`, `subsectionsOf`, `defaultSubsection`, `subsectionLabelKey`, `SUBSECTION_ICONS` from `@/lib/monitoring/shared/sections`; `subsectionPath`, `parseMonitoringPath` from `@/lib/monitoring/shared/paths`; `RegionSelector`, `TimeRangeSelector`, `AutoRefresh` from `@/components/monitoring/*`; `NAV_ITEMS`, `navHref`, `isNavActive` from `@/components/nav-items`; `Tooltip`, `TooltipContent`, `TooltipTrigger` from `@/components/ui/tooltip`.
- Produces (`section-panel.tsx`, client):
  - `export const SECTION_PANEL_STORAGE_KEY = 'opswatch.sectionPanel.collapsed';`
  - `export function SectionPanel({ section, subsection, links }: { section: MonitoringSection; subsection: string; links: { subsection: string; href: string; label: string }[] }): React.JSX.Element`
- Produces (`breadcrumb.tsx`, server):
  - `export async function MonitoringBreadcrumb({ sectionLabel, connectionName, subsectionLabel, sectionHref }: { sectionLabel: string; connectionName: string; subsectionLabel: string; sectionHref: string }): Promise<React.JSX.Element>`
- Produces (`section-page-header.tsx`, server):
  - `export async function SectionPageHeader({ context, section, subsection, range, ranges, autoRefresh, actions }: { context: MonitoringPageContext; section: MonitoringSection; subsection: string; range?: TimeRange; ranges?: readonly TimeRange[]; autoRefresh?: boolean; actions?: React.ReactNode }): Promise<React.JSX.Element>`
- Produces (`section-layout.tsx`, server):
  - `export async function SectionLayout({ context, section, subsection, range, ranges, autoRefresh, headerActions, filters, children }: { … ; filters?: React.ReactNode; children: React.ReactNode }): Promise<React.JSX.Element>`
- Produces (`rail-collapse.tsx`, client):
  - `export const RAIL_STORAGE_KEY = 'opswatch.rail.collapsed';`
  - `export function RailCollapseToggle(): React.JSX.Element`
  - `export function useRailCollapsed(): { collapsed: boolean; toggle: () => void }`

- [ ] **Step 1: Move the routes and make the section roots redirect**

Use `git mv` for every path listed under Files so history follows. Then create one redirect page per section. All six are the same file with a different constant, so write them from this template (this is the `containers` one):

```tsx
import { redirect } from '@/i18n/navigation';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { defaultSubsection } from '@/lib/monitoring/shared/sections';

type Props = { params: Promise<MonitoringParams>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The section root is not a page: it opens the section's first sub-page, keeping the query string. */
export default async function ContainersSectionPage({ params, searchParams }: Props) {
  // Session, connection and region first, exactly like a monitoring page, so an unknown selection still 404s.
  const context = await initMonitoringRoute(params);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  const path = subsectionPath(context.scope, 'containers', defaultSubsection('containers'));
  return redirect({ href: query.size > 0 ? `${path}?${query.toString()}` : path, locale: context.locale });
}
```

Adjust every moved page's relative imports (`./cards` still resolves; `@/…` imports do not change). The moved detail pages' `params` types are unchanged.

Run: `npm run typecheck`
Expected: no output. If a moved file imports `./cards` from the wrong depth, typecheck says so.

- [ ] **Step 2: Update the existing e2e specs to the new URLs, and see them fail**

In `tests/e2e/helpers.ts`, change `monitoringUrl` so it takes an optional sub-page: `export const monitoringUrl = (connectionId: string, section: string, subsection?: string, locale = 'en') => \`/${locale}/c/${connectionId}/${section}\` …` — keep the existing signature working by appending `/${subsection}` only when given. In `06-monitoring.spec.ts` and `07-logs.spec.ts`, change every asserted URL and every `page.goto` to the sub-page form (`…/overview/insights`, `…/containers/services`, `…/containers/services/opswatch-e2e/web`, `…/databases/instances`, `…/databases/instances/opswatch-e2e-db`, `…/load-balancers/list`, `…/load-balancers/list/opswatch-e2e-alb`, `…/alarms/list`, `…/logs/search`), and change the sidebar-href assertion to `/en/c/${connectionId}/us-east-1/containers/services`.

Run: `docker compose -f docker-compose.test.yml up -d --build --wait && npx playwright test --config tests/e2e/playwright.config.ts 06-monitoring 07-logs; docker compose -f docker-compose.test.yml down -v`
Expected: PASS for the moved pages (they still render their old header), FAIL for nothing — if a spec fails, the move is wrong. Fix before continuing.

- [ ] **Step 3: Write the failing unit test for the panel's pure part**

Create `tests/unit/monitoring-section-panel.test.ts`. The panel's testable logic is the link list it is given, which the layout builds; extract that builder into `section-layout.tsx` and export it:

```ts
import { describe, expect, it } from 'vitest';
import { sectionLinks } from '@/components/monitoring/section-layout';

describe('sectionLinks', () => {
  const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };
  it('lists every sub-page of the section, in order, keeping the shareable query string', () => {
    expect(sectionLinks(scope, 'databases', 'range=12h&sort=load:desc')).toEqual([
      { subsection: 'instances', href: '/c/abc123def456/eu-west-1/databases/instances?range=12h' },
      { subsection: 'queries', href: '/c/abc123def456/eu-west-1/databases/queries?range=12h' },
      { subsection: 'report', href: '/c/abc123def456/eu-west-1/databases/report?range=12h' },
    ]);
  });
  it('drops sub-page-specific parameters and keeps only the time range', () => {
    // A sort or a facet belongs to one table; carrying it to a sibling page would filter the wrong thing.
    expect(sectionLinks(scope, 'alarms', 'state=ALARM&tt=1&range=3h')[0].href).toBe('/c/abc123def456/eu-west-1/alarms/list?range=3h');
  });
  it('carries nothing when there is no range', () => {
    expect(sectionLinks(scope, 'overview', '')).toEqual([
      { subsection: 'insights', href: '/c/abc123def456/eu-west-1/overview/insights' },
      { subsection: 'audit', href: '/c/abc123def456/eu-west-1/overview/audit' },
    ]);
  });
});
```

Run: `npx vitest run tests/unit/monitoring-section-panel.test.ts` → FAIL (no `sectionLinks`).

- [ ] **Step 4: Write the four new components and wire every page**

`sectionLinks(scope, section, search)` is a plain exported function in `section-layout.tsx`: it reads `range` out of `search` (nothing else) and returns one entry per `subsectionsOf(section)`, each `subsectionPath(scope, section, sub)` with `?range=…` appended when present. Labels are added by the layout with `getTranslations('Sections')`.

`SectionPanel` (client) — a `<nav aria-label={t('sectionNav.label', { section })}>`. At `lg` and above: a vertical `<ul>` of `<Link>`s, 14 rem wide, the active one (`subsection === link.subsection`) carrying `aria-current="page"` and `bg-primary/10 font-medium text-primary`, each with its `SUBSECTION_ICONS` lucide icon. At its bottom a `<button type="button">` labelled `t('sectionNav.collapse')` / `t('sectionNav.expand')` with `aria-pressed`, which toggles a `collapsed` state persisted to `localStorage` under `SECTION_PANEL_STORAGE_KEY`; collapsed, the panel is 3.5 rem wide, shows icons only, and each link's label moves into a `Tooltip` **and** an `sr-only` span. Below `lg` the same links render as a horizontal, `overflow-x-auto` strip above the content, with the collapse button hidden — this is spec §1's "Below 1024 px the section panel becomes a horizontal, scrollable strip of links above the content, so nothing overflows at 360 px". Reading `localStorage` happens in a `useEffect` so the server and the first client render agree (no hydration mismatch); until it runs the panel renders expanded.

`MonitoringBreadcrumb` (server) — `<nav aria-label={t('breadcrumb.label')}><ol>` with three items: the section (a `<Link href={sectionHref}>`), the connection name (plain text), and the sub-page (plain text with `aria-current="page"`), separated by a `<span aria-hidden>›</span>`. At 360 px the first item is `hidden sm:inline` so the sub-page is always visible.

`SectionPageHeader` (server) — replaces `MonitoringHeader` everywhere. It renders the breadcrumb, then an `<h1>` holding the sub-page label (so the page's heading is "Queries", not "Databases"), then on the right, in this order: the `RegionSelector`, the `TimeRangeSelector` (only when `range` is given, with `ranges` defaulting to `TIME_RANGES`), the `AutoRefresh` (only when `autoRefresh` is true), and `actions`. Every control the Stage 2 header carried is kept.

`SectionLayout` (server) — a grid: `SectionPanel` on the left at `lg`, the header and content on the right; below `lg` the panel's strip sits between the header and the `filters` row. `filters`, when given, renders in a bordered row directly under the header. Children stream as before.

Then change **every** moved page: replace `<MonitoringHeader …>` with `<SectionLayout context={context} section="…" subsection="…" range={range} …>` wrapping the page's existing content, and move each page's existing filter markup (the Containers search `<form>`, the Alarms state and target-tracking filters, the Logs prefix input if the parallel agent's picker still has one) into the layout's `filters` prop. Delete `src/components/monitoring/monitoring-header.tsx`.

The pages pass `autoRefresh={false}` where they already did (Logs), `true` elsewhere. `pageNow()` stays exactly where it is in each page — one call, before the cards.

- [ ] **Step 5: Add the collapsible main rail (spec §9.1)**

`rail-collapse.tsx` (client) exports `RAIL_STORAGE_KEY`, a `RailCollapseToggle` button (a `PanelLeftClose` / `PanelLeftOpen` icon, `aria-label` from `Shell.rail.collapse` / `Shell.rail.expand`, `aria-pressed`) and a `useRailCollapsed` hook backed by `localStorage` and read in a `useEffect`. `Sidebar` becomes a client component that uses the hook: collapsed it is `w-16`, renders `NavIcon` only, wraps each link in a `Tooltip` whose content is the label, and keeps the label as an `sr-only` span; expanded it is unchanged at `w-72`. The toggle sits at the bottom of the rail, above `SignOutForm`. `AppShell` is otherwise untouched. The mobile menu in `TopBar` is untouched (it is already icons-plus-labels in a sheet).

- [ ] **Step 6: Register the client namespaces**

In `src/i18n/client-messages.ts`, add `'Sections'` to `CLIENT_NAMESPACES` (the section panel reads it). `Monitoring.client` and `Shell` are already listed.

- [ ] **Step 7: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Monitoring.client.sectionNav.label` | `{section} pages` | `Pages {section}` |
| `Monitoring.client.sectionNav.collapse` | `Collapse the section menu` | `Réduire le menu de section` |
| `Monitoring.client.sectionNav.expand` | `Expand the section menu` | `Déplier le menu de section` |
| `Monitoring.common.breadcrumb.label` | `Breadcrumb` | `Fil d'Ariane` |
| `Shell.rail.collapse` | `Collapse the menu` | `Réduire le menu` |
| `Shell.rail.expand` | `Expand the menu` | `Déplier le menu` |

- [ ] **Step 8: Write the end-to-end spec for the navigation**

Create `tests/e2e/08-analysis.spec.ts` with these tests (it grows in later tasks):

```ts
test('a section root opens its first sub-page and keeps the time range', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases?range=12h`);
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/databases/instances?range=12h`);
});

test('the section menu lists the sub-pages, marks the active one and keeps the region and range', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/instances?range=12h`);
  const nav = page.getByRole('navigation', { name: 'Databases pages' });
  await expect(nav.getByRole('link', { name: 'Instances' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Queries' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/queries?range=12h`);
  await nav.getByRole('link', { name: 'Queries' }).click();
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/databases/queries?range=12h`);
  await expect(page.getByRole('heading', { level: 1, name: 'Queries' })).toBeVisible();
});

test('the breadcrumb names the section, the connection and the sub-page', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/containers/services`);
  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumb).toContainText('Containers');
  await expect(crumb).toContainText(MONITORING_CONNECTION);
  await expect(crumb).toContainText('Services');
});

test('the section menu is a scrollable strip at 360 px and nothing overflows', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/en/c/${connectionId}/us-east-1/logs/search`);
  const nav = page.getByRole('navigation', { name: 'Logs pages' });
  await expect(nav.getByRole('link', { name: 'Volume' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Endpoints' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the section menu collapse is remembered per browser', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/c/${connectionId}/us-east-1/alarms/list`);
  await page.getByRole('button', { name: 'Collapse the section menu' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand the section menu' })).toHaveAttribute('aria-pressed', 'true');
});

test('the main rail collapses to icons and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/c/${connectionId}/us-east-1/overview/insights`);
  await page.getByRole('button', { name: 'Collapse the menu' }).click();
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Containers' })).toBeVisible();   // the sr-only label keeps the name
  await expect(page.getByRole('button', { name: 'Expand the menu' })).toHaveAttribute('aria-pressed', 'true');
});

test('switching region keeps the sub-page', async ({ page }) => {
  // The monitoring connection has one region, so this asserts the link the selector renders, not a navigation.
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/queries?range=12h`);
  await page.getByRole('button', { name: 'Region' }).click();
  await expect(page.getByRole('menuitem', { name: 'us-east-1' }).getByRole('link'))
    .toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/queries?range=12h`);
});
```

- [ ] **Step 9: Run every test**

Run: `npx vitest run` then `docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e; docker compose -f docker-compose.test.yml down -v`
Expected: all unit suites pass; all e2e specs pass, including the updated `06-monitoring` and `07-logs` and the new `08-analysis`.

- [ ] **Step 10: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip` (the Task 4 and 5 shared modules are still unused; `monitoring-header.tsx` must no longer be reported since it is deleted).
Commit: `feat(monitoring): section menu, page header, collapsible rail and sub-page routes`.

**moto limits:** none of these tests need AWS data beyond what Stage 2's seed already provides; the Queries, report, Volume, Endpoints and Audit sub-pages do not exist yet, so the section menu links to them are asserted by `href` only, not by clicking, except for Databases → Queries which Task 11 makes real. Until then, `sectionLinks` returns hrefs to pages that 404; **Step 8's "click Queries" test therefore belongs to Task 11, not here** — write it there and, in this task, assert the href only.
**Owner-only verification:** that the two collapsed menus read the way the Datadog screens they showed do. Spec §9.1 makes both collapses binding, so neither is optional any more.

---

### Task 10: Cross-instance Performance Insights merge

Implements spec §2 with amendments 2 (honest scope, `topSql` takes the limit as a parameter), 3 (merge by `db.sql_tokenized.id`, never by text), 4 (share of the statements shown), 5 (one grouping at a time) and 11 (one Performance Insights call per instance, capped).

**Files:**
- Modify: `src/lib/monitoring/pi.ts`
- Create: `src/lib/analysis/queries.ts`
- Modify: `tests/unit/monitoring-pi.test.ts`
- Create: `tests/unit/analysis-queries.test.ts`
- Modify: `tests/unit/module-boundaries.test.ts`

**Interfaces:**
- Consumes: `AwsTarget`, `MonitoringDeps` from `@/lib/monitoring/call`; `listDatabases`, `RdsInstance` from `@/lib/monitoring/rds`; `MonitoringResult`, `MonitoringFailure` from `@/lib/monitoring/result`; `piWindow`, `TOP_SQL_LIMIT` from `@/lib/monitoring/pi`; `TimeRange`, `TimeWindow` from `@/lib/monitoring/shared/time-range`; `Coverage`, `NotCovered`, `capResources`, `notCovered`, `notCoveredFromFailure`, `sortNotCovered`, `QUERIES_MAX_INSTANCES` from `@/lib/analysis/coverage`.
- Produces (added to `src/lib/monitoring/pi.ts`):
  - `export const FLEET_SQL_LIMIT = 25;`
  - `export const PI_GROUPS = ['sql', 'user', 'host'] as const;`
  - `export type PiGroup = (typeof PI_GROUPS)[number];`
  - `export type PiDimensionKey = { id: string | null; label: string; load: number };`
  - `export function topDimensionKeys(target: AwsTarget, resourceId: string, window: TimeWindow, group: PiGroup, limit: number, deps?: MonitoringDeps): Promise<MonitoringResult<PiDimensionKey[]>>`
  - `topSql` stays, with the same signature and the same default limit of 10, now implemented as `topDimensionKeys(target, resourceId, window, 'sql', TOP_SQL_LIMIT, deps)` mapped to `TopSqlEntry`.
- Produces (`src/lib/analysis/queries.ts`):
  - `export type FleetQueryOrigin = { instance: string; load: number; sharePercent: number; href: string };`
  - `export type FleetQueryRow = { key: string; label: string; totalLoad: number; sharePercent: number; instanceCount: number; origins: FleetQueryOrigin[] };`
  - `export type FleetQueriesData = { group: PiGroup; rows: FleetQueryRow[]; totalLoad: number; coverage: Coverage; notCovered: NotCovered[]; window: TimeWindow; limitPerInstance: number };`
  - `export const QUERY_SORTS = ['load', 'instances'] as const;`
  - `export type QuerySort = (typeof QUERY_SORTS)[number];`
  - `export function parseQueryGroup(value: string | string[] | undefined): PiGroup`
  - `export function parseQuerySort(value: string | string[] | undefined): QuerySort`
  - `export function mergeFleetKeys(perInstance: readonly { instance: string; href: string; keys: readonly PiDimensionKey[] }[], sort: QuerySort): { rows: FleetQueryRow[]; totalLoad: number }`
  - `export function fleetQueries(target: AwsTarget, options: { group: PiGroup; sort: QuerySort; range: TimeRange; nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<FleetQueriesData>>`

**The AWS request shapes** — one `GroupBy` per grouping, exactly these (they are what amendment 5 means by "one grouping at a time"):

| `PiGroup` | `GroupBy.Group` | `GroupBy.Dimensions` | id dimension | label dimension |
|---|---|---|---|---|
| `sql` | `db.sql_tokenized` | `['db.sql_tokenized.id', 'db.sql_tokenized.statement']` | `db.sql_tokenized.id` | `db.sql_tokenized.statement` |
| `user` | `db.user` | `['db.user.id', 'db.user.name']` | `db.user.id` | `db.user.name` |
| `host` | `db.host` | `['db.host.id', 'db.host.name']` | `db.host.id` | `db.host.name` |

Every call keeps `ServiceType: 'RDS'`, `Metric: 'db.load.avg'`, `StartTime`/`EndTime` from `piWindow(range, nowMs)` and `PeriodInSeconds: window.periodSeconds`.

**The merge arithmetic**, stated once so no task has to re-derive it:

- Every instance is asked over the **same** `piWindow(range, nowMs)`, so the per-instance windows are identical and the weighting §2 describes collapses to a plain sum. `totalLoad` of a row is `Σ load` over the instances that reported that key. This is written in a comment in the module so a later reader does not "fix" it into a weighted average.
- Rows are keyed on the **id** dimension (amendment 3). A key with `id === null` cannot be merged, because two different statements can share a truncated 500-byte text; it becomes its own row keyed `` `no-id:${instance}:${index}` `` and never merges with anything.
- `label` is the label of the highest-load occurrence of that key, so the text shown is the one from the instance that suffers most.
- `sharePercent` of a row is `totalLoad / Σ totalLoad over all rows × 100`, which is **the share of the statements shown, not of the instance's total load** (amendment 4). `Σ totalLoad === 0` gives every row `0`.
- `origins` are the per-instance entries sorted by `load` descending then instance name; each origin's `sharePercent` is `load / row.totalLoad × 100` (the share **within the row**), and `0` when `row.totalLoad === 0`.
- `sort === 'load'` orders rows by `totalLoad` descending, then `instanceCount` descending, then `key`; `sort === 'instances'` orders by `instanceCount` descending, then `totalLoad` descending, then `key`.
- `href` of an origin is `subsectionPath(scope, 'databases', 'instances', instance)` — built by the caller (`fleetQueries`), because `mergeFleetKeys` must stay free of scope.

- [ ] **Step 1: Extend the failing `pi.ts` test**

Add to `tests/unit/monitoring-pi.test.ts`:

```ts
import { FLEET_SQL_LIMIT, topDimensionKeys } from '@/lib/monitoring/pi';

describe('topDimensionKeys', () => {
  it('groups by db.user with its own dimensions and the requested limit', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({
      Keys: [
        { Dimensions: { 'db.user.id': 'u1', 'db.user.name': 'app_rw' }, Total: 2.5 },
        { Dimensions: { 'db.user.id': 'u2', 'db.user.name': 'reporting' }, Total: 0.5 },
      ],
    });
    const window = piWindow('3h', t);
    const result = await topDimensionKeys(target, 'db-ORDERS1', window, 'user', 25, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)[0].args[0].input).toEqual({
      ServiceType: 'RDS', Identifier: 'db-ORDERS1', StartTime: window.start, EndTime: window.end,
      PeriodInSeconds: 60, Metric: 'db.load.avg',
      GroupBy: { Group: 'db.user', Dimensions: ['db.user.id', 'db.user.name'], Limit: 25 },
    });
    expect(result).toEqual({ ok: true, data: [{ id: 'u1', label: 'app_rw', load: 2.5 }, { id: 'u2', label: 'reporting', load: 0.5 }] });
  });

  it('groups by db.host', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [{ Dimensions: { 'db.host.id': 'h1', 'db.host.name': '10.0.3.7' }, Total: 1 }] });
    await topDimensionKeys(target, 'db-ORDERS1', piWindow('3h', t), 'host', 25, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)[0].args[0].input.GroupBy)
      .toEqual({ Group: 'db.host', Dimensions: ['db.host.id', 'db.host.name'], Limit: 25 });
  });

  it('sorts by load, truncates to the limit and keeps a key with no id', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({
      Keys: [
        { Dimensions: { 'db.sql_tokenized.statement': 'SELECT 1' }, Total: 9 },       // no id
        { Dimensions: { 'db.sql_tokenized.id': 'A', 'db.sql_tokenized.statement': 'SELECT 2' }, Total: 3 },
        { Dimensions: { 'db.sql_tokenized.id': 'B', 'db.sql_tokenized.statement': 'SELECT 3' }, Total: 5 },
      ],
    });
    const result = await topDimensionKeys(target, 'db-ORDERS1', piWindow('3h', t), 'sql', 2, deps);
    expect(result).toEqual({ ok: true, data: [{ id: null, label: 'SELECT 1', load: 9 }, { id: 'B', label: 'SELECT 3', load: 5 }] });
  });

  it('caches a different grouping and a different limit separately', async () => {
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [] });
    const window = piWindow('3h', t);
    await topDimensionKeys(target, 'db-ORDERS1', window, 'sql', 25, deps);
    await topDimensionKeys(target, 'db-ORDERS1', window, 'sql', 25, deps);   // cache hit
    await topDimensionKeys(target, 'db-ORDERS1', window, 'user', 25, deps);  // different group
    await topDimensionKeys(target, 'db-ORDERS1', window, 'sql', 10, deps);   // different limit
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(3);
  });

  it('keeps the fleet limit at 25 and the instance limit at 10', () => {
    expect(FLEET_SQL_LIMIT).toBe(25);
    expect(TOP_SQL_LIMIT).toBe(10);
  });
});
```

The existing `topSql` tests stay unchanged and must keep passing — that is the proof amendment 2's "default stays 10 for the instance page" held.

- [ ] **Step 2: Write the failing merge test**

Create `tests/unit/analysis-queries.test.ts`. Start with the pure merge, which is the heart of the task:

```ts
import { describe, expect, it } from 'vitest';
import { mergeFleetKeys, parseQueryGroup, parseQuerySort } from '@/lib/analysis/queries';

const href = (i: string) => `/c/abc/eu-west-1/databases/instances/${i}`;

describe('mergeFleetKeys', () => {
  it('merges the same digest across instances, sums the load and keeps each origin', () => {
    const { rows, totalLoad } = mergeFleetKeys(
      [
        { instance: 'db-a', href: href('db-a'), keys: [{ id: 'A1', label: 'SELECT * FROM orders WHERE id = ?', load: 3 }, { id: 'B2', label: 'UPDATE stock SET qty = ?', load: 1 }] },
        { instance: 'db-b', href: href('db-b'), keys: [{ id: 'A1', label: 'SELECT * FROM orders WHERE id = ?', load: 1 }] },
      ],
      'load',
    );
    expect(totalLoad).toBe(5);
    expect(rows).toEqual([
      {
        key: 'A1', label: 'SELECT * FROM orders WHERE id = ?', totalLoad: 4, sharePercent: 80, instanceCount: 2,
        origins: [
          { instance: 'db-a', load: 3, sharePercent: 75, href: href('db-a') },
          { instance: 'db-b', load: 1, sharePercent: 25, href: href('db-b') },
        ],
      },
      { key: 'B2', label: 'UPDATE stock SET qty = ?', totalLoad: 1, sharePercent: 20, instanceCount: 1, origins: [{ instance: 'db-a', load: 1, sharePercent: 100, href: href('db-a') }] },
    ]);
  });

  it('never merges two statements that only share their truncated text', () => {
    const { rows } = mergeFleetKeys(
      [{ instance: 'db-a', href: href('db-a'), keys: [{ id: 'A1', label: 'SELECT x FROM t WHERE', load: 2 }, { id: 'A2', label: 'SELECT x FROM t WHERE', load: 1 }] }],
      'load',
    );
    expect(rows.map((r) => r.key)).toEqual(['A1', 'A2']);
  });

  it('keeps a key with no id as its own row, per instance', () => {
    const { rows } = mergeFleetKeys(
      [
        { instance: 'db-a', href: href('db-a'), keys: [{ id: null, label: 'SELECT 1', load: 2 }] },
        { instance: 'db-b', href: href('db-b'), keys: [{ id: null, label: 'SELECT 1', load: 1 }] },
      ],
      'load',
    );
    expect(rows.map((r) => [r.key, r.instanceCount])).toEqual([['no-id:db-a:0', 1], ['no-id:db-b:0', 1]]);
  });

  it('shows the label of the heaviest occurrence', () => {
    const { rows } = mergeFleetKeys(
      [
        { instance: 'db-a', href: href('db-a'), keys: [{ id: 'A1', label: 'short', load: 1 }] },
        { instance: 'db-b', href: href('db-b'), keys: [{ id: 'A1', label: 'the longer truncated text', load: 9 }] },
      ],
      'load',
    );
    expect(rows[0].label).toBe('the longer truncated text');
  });

  it('sorts by most instances affected when asked', () => {
    const input = [
      { instance: 'db-a', href: href('db-a'), keys: [{ id: 'HEAVY', label: 'h', load: 10 }, { id: 'WIDE', label: 'w', load: 1 }] },
      { instance: 'db-b', href: href('db-b'), keys: [{ id: 'WIDE', label: 'w', load: 1 }] },
      { instance: 'db-c', href: href('db-c'), keys: [{ id: 'WIDE', label: 'w', load: 1 }] },
    ];
    expect(mergeFleetKeys(input, 'load').rows.map((r) => r.key)).toEqual(['HEAVY', 'WIDE']);
    expect(mergeFleetKeys(input, 'instances').rows.map((r) => r.key)).toEqual(['WIDE', 'HEAVY']);
  });

  it('gives every row a zero share when nothing carries load', () => {
    const { rows, totalLoad } = mergeFleetKeys([{ instance: 'db-a', href: href('db-a'), keys: [{ id: 'A', label: 'a', load: 0 }] }], 'load');
    expect(totalLoad).toBe(0);
    expect(rows[0]).toMatchObject({ sharePercent: 0, origins: [{ instance: 'db-a', load: 0, sharePercent: 0, href: href('db-a') }] });
  });

  it('returns nothing for no instances', () => {
    expect(mergeFleetKeys([], 'load')).toEqual({ rows: [], totalLoad: 0 });
  });
});

describe('parseQueryGroup and parseQuerySort', () => {
  it('default to statements sorted by load', () => {
    expect(parseQueryGroup(undefined)).toBe('sql');
    expect(parseQueryGroup('user')).toBe('user');
    expect(parseQueryGroup('nope')).toBe('sql');
    expect(parseQuerySort(['instances'])).toBe('instances');
    expect(parseQuerySort('nope')).toBe('load');
  });
});
```

- [ ] **Step 3: Write the failing loader test**

Append to the same file, mocking `RDSClient` and `PIClient`:

```ts
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { DescribeDimensionKeysCommand, PIClient } from '@aws-sdk/client-pi';
import { mockClient } from 'aws-sdk-client-mock';
import { createTtlCache } from '@/lib/monitoring/cache';
import { fleetQueries } from '@/lib/analysis/queries';

const rds = mockClient(RDSClient);
const pi = mockClient(PIClient);
const instance = (id: string, extra: object = {}) => ({ DBInstanceIdentifier: id, Engine: 'mysql', DBInstanceClass: 'db.t3.medium', DBInstanceStatus: 'available', DbiResourceId: `res-${id}`, PerformanceInsightsEnabled: true, ...extra });

describe('fleetQueries', () => {
  it('calls Performance Insights once per covered instance and merges the answers', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [instance('db-a'), instance('db-b')] });
    pi.on(DescribeDimensionKeysCommand, { Identifier: 'res-db-a' }).resolves({ Keys: [{ Dimensions: { 'db.sql_tokenized.id': 'A1', 'db.sql_tokenized.statement': 'SELECT 1' }, Total: 3 }] });
    pi.on(DescribeDimensionKeysCommand, { Identifier: 'res-db-b' }).resolves({ Keys: [{ Dimensions: { 'db.sql_tokenized.id': 'A1', 'db.sql_tokenized.statement': 'SELECT 1' }, Total: 1 }] });

    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(2);
    expect(result.ok && result.data.rows[0]).toMatchObject({ key: 'A1', totalLoad: 4, instanceCount: 2 });
    expect(result.ok && result.data.coverage).toEqual({ covered: 2, total: 2, truncated: false });
    expect(result.ok && result.data.notCovered).toEqual([]);
    expect(result.ok && result.data.limitPerInstance).toBe(25);
  });

  it('lists an instance without Performance Insights as not covered instead of calling it', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [instance('db-a'), instance('db-off', { PerformanceInsightsEnabled: false }), instance('db-null', { DbiResourceId: undefined })] });
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [] });

    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(1);
    expect(result.ok && result.data.notCovered).toEqual([
      { resource: 'db-null', reason: 'no_resource_id', code: null, action: null },
      { resource: 'db-off', reason: 'pi_disabled', code: null, action: null },
    ]);
    expect(result.ok && result.data.coverage).toEqual({ covered: 1, total: 3, truncated: true });
  });

  it('keeps a denied or failing instance in the list with its error code', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [instance('db-a'), instance('db-bad')] });
    pi.on(DescribeDimensionKeysCommand, { Identifier: 'res-db-a' }).resolves({ Keys: [{ Dimensions: { 'db.sql_tokenized.id': 'A1', 'db.sql_tokenized.statement': 'SELECT 1' }, Total: 2 }] });
    pi.on(DescribeDimensionKeysCommand, { Identifier: 'res-db-bad' }).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));

    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.rows).toHaveLength(1);
    expect(result.ok && result.data.notCovered).toEqual([{ resource: 'db-bad', reason: 'denied', code: 'AccessDeniedException', action: 'pi:DescribeDimensionKeys' }]);
  });

  it('fails as a whole only when the instance list fails', async () => {
    rds.on(DescribeDBClustersCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));
    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(result).toEqual({ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'rds:DescribeDBClusters' });
  });

  it('caps the fleet at 50 Performance Insights calls and says the rest was capped', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: Array.from({ length: 52 }, (_, i) => instance(`db-${String(i).padStart(2, '0')}`)) });
    pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [] });
    const result = await fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs: t }, deps);
    expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(50);
    expect(result.ok && result.data.coverage).toEqual({ covered: 50, total: 52, truncated: true });
    expect(result.ok && result.data.notCovered.map((r) => [r.resource, r.reason])).toEqual([['db-50', 'cap'], ['db-51', 'cap']]);
  });
});
```

- [ ] **Step 4: Run both to see them fail**

Run: `npx vitest run tests/unit/monitoring-pi.test.ts tests/unit/analysis-queries.test.ts`
Expected: FAIL — `topDimensionKeys` and `@/lib/analysis/queries` do not exist.

- [ ] **Step 5: Extend `pi.ts`**

```ts
export const FLEET_SQL_LIMIT = 25;
export const PI_GROUPS = ['sql', 'user', 'host'] as const;
export type PiGroup = (typeof PI_GROUPS)[number];
export type PiDimensionKey = { id: string | null; label: string; load: number };

/** One grouping per call (amendment 5): asking for three would cost three calls per instance. */
const GROUP_SHAPES: Record<PiGroup, { group: string; id: string; label: string }> = {
  sql: { group: 'db.sql_tokenized', id: 'db.sql_tokenized.id', label: 'db.sql_tokenized.statement' },
  user: { group: 'db.user', id: 'db.user.id', label: 'db.user.name' },
  host: { group: 'db.host', id: 'db.host.id', label: 'db.host.name' },
};

export function topDimensionKeys(target: AwsTarget, resourceId: string, window: TimeWindow, group: PiGroup, limit: number, deps: MonitoringDeps = {}): Promise<MonitoringResult<PiDimensionKey[]>> {
  const shape = GROUP_SHAPES[group];
  return describeCall(
    target,
    'pi:DescribeDimensionKeys',
    // The group and the limit are part of the key: two views of one instance must not share a cache entry.
    { resourceId, start: window.start, end: window.end, period: window.periodSeconds, group, limit },
    async () => {
      const client = new PIClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(
        client,
        new DescribeDimensionKeysCommand({
          ServiceType: 'RDS',
          Identifier: resourceId,
          StartTime: window.start,
          EndTime: window.end,
          PeriodInSeconds: window.periodSeconds,
          Metric: 'db.load.avg',
          GroupBy: { Group: shape.group, Dimensions: [shape.id, shape.label], Limit: limit },
        }),
        describeTimeout(deps),
      );
      return (out.Keys ?? [])
        .map((k) => ({ id: k.Dimensions?.[shape.id] ?? null, label: k.Dimensions?.[shape.label] ?? '', load: k.Total ?? 0 }))
        .sort((a, b) => b.load - a.load)
        .slice(0, limit);
    },
    deps,
    PI_TTL_MS,
  );
}

/** The instance detail page's view: statements only, top 10 (amendment 2 keeps this default). */
export async function topSql(target: AwsTarget, resourceId: string, window: TimeWindow, deps: MonitoringDeps = {}): Promise<MonitoringResult<TopSqlEntry[]>> {
  const keys = await topDimensionKeys(target, resourceId, window, 'sql', TOP_SQL_LIMIT, deps);
  return keys.ok ? { ok: true, data: keys.data.map((k) => ({ id: k.id, statement: k.label, load: k.load })) } : keys;
}
```

- [ ] **Step 6: Write `src/lib/analysis/queries.ts`**

`mergeFleetKeys` implements the arithmetic stated above. `fleetQueries`:

1. `const databases = await listDatabases(target, deps); if (!databases.ok) return databases;`
2. Partition `databases.data.instances`: `eligible` = `performanceInsights === true && resourceId !== null`; the rest become `notCovered(i.id, i.resourceId === null ? 'no_resource_id' : 'pi_disabled')`.
3. `const { included, excluded, coverage: capCoverage } = capResources(eligible, 1, QUERIES_MAX_INSTANCES);` — one call per instance, so the cost is 1. `excluded` become `notCovered(i.id, 'cap')`.
4. `const window = piWindow(options.range, options.nowMs);`
5. `await Promise.all(included.map((i) => topDimensionKeys(target, i.resourceId as string, window, options.group, FLEET_SQL_LIMIT, deps)))`. A failed result becomes `notCoveredFromFailure(instance.id, result)`; a successful one feeds the merge. **A failure never fails the page** — only `listDatabases` does.
6. `coverage` is `coverageOf(number of instances that answered, databases.data.instances.length)`, which is stricter than `capCoverage` because it also excludes the failures.
7. Sort `notCovered` with `sortNotCovered`.
8. Return `{ group, rows, totalLoad, coverage, notCovered, window, limitPerInstance: FLEET_SQL_LIMIT }`.

- [ ] **Step 7: Register the boundary and run the tests**

Add `'lib/analysis/queries.ts'` to `SERVER_ONLY_MODULES`.
Run: `npx vitest run tests/unit/monitoring-pi.test.ts tests/unit/analysis-queries.test.ts tests/unit/module-boundaries.test.ts`
Expected: all pass, including every pre-existing `topSql` test.

- [ ] **Step 8: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`.
Commit: `feat(analysis): cross-instance Performance Insights merge by statement digest`.

**moto limits:** moto has **no Performance Insights backend** (fact 8) and never reports `PerformanceInsightsEnabled` (fact 7), so none of this can be end-to-end tested — every case above is unit-tested with `aws-sdk-client-mock`. Task 11's e2e asserts only the "not covered" list.
**Owner-only verification:** that real `db.user` and `db.host` groupings return keys on their account (AWS only populates them for engines that report those dimensions), and that the merged statements look right against what they saw in the console.

---

### Task 11: Databases → Queries page

Implements spec §2's page, with the honesty wording of amendments 2 and 4 and the one-grouping-at-a-time control of amendment 5.

**Files:**
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/databases/queries/page.tsx`, `…/databases/queries/cards.tsx`
- Modify: `tests/e2e/08-analysis.spec.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `initMonitoringRoute`, `MonitoringParams` from `@/lib/monitoring/route`; `SectionLayout` from `@/components/monitoring/section-layout`; `SuspenseCard` from `@/components/monitoring/suspense-card`; `MonitoringCard`, `FailureNotice` from `@/components/monitoring/*`; `CoverageNote`, `NotCoveredList` from `@/components/analysis/*`; `DenseTable`, `TopNBars` from `@/components/analysis/*`; `fleetQueries`, `parseQueryGroup`, `parseQuerySort`, `QUERY_SORTS` from `@/lib/analysis/queries`; `PI_GROUPS` from `@/lib/monitoring/pi`; `resolveTarget` from `@/lib/monitoring/target`; `pageNow`, `parseTimeRange` from `@/lib/monitoring/shared/time-range`; `subsectionPath` from `@/lib/monitoring/shared/paths`; `localizedTitle` from `@/i18n/metadata`; `formatMetricValue` from `@/lib/monitoring/shared/format`.
- Produces: `export const generateMetadata = localizedTitle('Sections.databases.queries');` and `export default async function DatabaseQueriesPage(props)`; `export async function FleetQueriesCard({ scope, group, sort, range, nowMs }: { scope: MonitoringScope; group: PiGroup; sort: QuerySort; range: TimeRange; nowMs: number })`.

**Page shape:**
- `initMonitoringRoute(params)` first; then `parseTimeRange(sp.range)`, `parseQueryGroup(sp.group)`, `parseQuerySort(sp.sort)`, then **one** `pageNow()`.
- `SectionLayout` with `section="databases"`, `subsection="queries"`, `range`, `autoRefresh={false}` (each refresh costs one Performance Insights call per instance), and a `filters` row holding two link groups, both plain `<Link>`s that rewrite one query parameter and keep the rest: **Group by** (`Statements` / `Database users` / `Client hosts`, from `PI_GROUPS`) and **Sort by** (`Total load` / `Most instances affected`, from `QUERY_SORTS`), each with `aria-current="page"` on the active one.
- One `<SuspenseCard key={`${range}|${group}|${sort}`} title={…} variant="table" rows={8}>` around `FleetQueriesCard`.

**Card shape:**
1. `resolveTarget(scope)`; on failure a `MonitoringCard` with `FailureNotice`.
2. `fleetQueries(target.data, { group, sort, range, nowMs })`; on failure the same.
3. A scope note above everything, always visible: `t('scopeNote', { limit: data.limitPerInstance })` — "These are the statements visible in each instance's top {limit}, not a guaranteed fleet-wide ranking." (amendment 2).
4. `<CoverageNote coverage={data.coverage} resourceKey="instances" />`.
5. `<TopNBars label={t('topLabel')} items={rows.slice(0, 10).map(…)} unit="rate" />` — load is average active sessions, which formats as a `rate`.
6. `<DenseTable>` with columns `statement` (priority `always`), `load` (`always`, right), `share` (`sm`, right), `instances` (`sm`, right), `origins` (`md`). The `statement` cell is a `<details>` whose `<summary>` shows the label truncated to 120 characters with `font-mono text-xs` and whose body shows the full label in a `<pre className="whitespace-pre-wrap break-words">` — **text only, never syntax-highlighted and never executed**. The `share` cell shows `formatMetricValue(row.sharePercent, 'percent', locale)` followed by the footnote marker for `t('shareNote')`. The `origins` cell is a small `<ul>` of `instance — load — share`, the instance name a `<Link href={origin.href}>`, sorted by load.
7. `t('shareNote')` printed under the table: "Share of the statements shown, not of each instance's total database load." (amendment 4).
8. `<NotCoveredList rows={data.notCovered} titleKey="Monitoring.queries.notCoveredTitle" />`.
9. When `rows.length === 0` and `notCovered.length > 0`, the table is replaced by `t('emptyButUncovered')`; when both are empty, `t('empty')`.

- [ ] **Step 1: Write the failing end-to-end test**

Add to `tests/e2e/08-analysis.spec.ts`:

```ts
test('the databases queries page names its scope and lists the instances it could not cover', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/queries?range=3h`);
  await expect(page).toHaveTitle('Queries · OpsWatch');
  await expect(page.getByRole('heading', { level: 1, name: 'Queries' })).toBeVisible();
  // moto never reports PerformanceInsightsEnabled, so the seeded instance is always "not covered".
  await expect(page.getByText("These are the statements visible in each instance's top 25", { exact: false })).toBeVisible();
  await expect(page.getByText('Covering 0 of 1 database instances.')).toBeVisible();
  const notCovered = page.getByRole('heading', { name: 'Instances not covered' });
  await expect(notCovered).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'opswatch-e2e-db' })).toContainText('Performance Insights is disabled');
  await expect(page.getByText('No statement was returned for the instances that could be read.')).toBeVisible();
});

test('the grouping and the sort ride in the URL and keep the range', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/queries?range=3h`);
  await expect(page.getByRole('link', { name: 'Statements' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Database users' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/queries?range=3h&group=user`);
  await page.getByRole('link', { name: 'Most instances affected' }).click();
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/databases/queries?range=3h&sort=instances`);
  await expect(page.getByRole('link', { name: 'Most instances affected' })).toHaveAttribute('aria-current', 'page');
});

test('the section menu reaches the queries page from the instances list', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/instances?range=12h`);
  await page.getByRole('navigation', { name: 'Databases pages' }).getByRole('link', { name: 'Queries' }).click();
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/databases/queries?range=12h`);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -f docker-compose.test.yml up -d --build --wait && npx playwright test --config tests/e2e/playwright.config.ts 08-analysis; docker compose -f docker-compose.test.yml down -v`
Expected: FAIL — the page 404s.

- [ ] **Step 3: Write the page and the card** as described above.

- [ ] **Step 4: Add the messages** (new `Monitoring.queries` namespace, server-side only)

| Key | EN | FR |
|---|---|---|
| `Monitoring.queries.title` | `Queries` | `Requêtes` |
| `Monitoring.queries.description` | `Every instance's database load, merged, with where each entry comes from.` | `La charge de toutes les instances, fusionnée, avec l'origine de chaque entrée.` |
| `Monitoring.queries.cardTitle` | `Load across the fleet` | `Charge sur l'ensemble du parc` |
| `Monitoring.queries.scopeNote` | `These are the statements visible in each instance's top {limit}, not a guaranteed fleet-wide ranking.` | `Il s'agit des requêtes visibles dans le top {limit} de chaque instance, pas d'un classement garanti sur tout le parc.` |
| `Monitoring.queries.shareNote` | `Share of the statements shown, not of each instance's total database load.` | `Part des requêtes affichées, et non de la charge totale de chaque instance.` |
| `Monitoring.queries.topLabel` | `Heaviest entries` | `Entrées les plus lourdes` |
| `Monitoring.queries.groupBy.label` | `Group by` | `Regrouper par` |
| `Monitoring.queries.groupBy.sql` | `Statements` | `Requêtes` |
| `Monitoring.queries.groupBy.user` | `Database users` | `Utilisateurs` |
| `Monitoring.queries.groupBy.host` | `Client hosts` | `Hôtes clients` |
| `Monitoring.queries.groupBy.note` | `One grouping at a time: each view costs one Performance Insights call per instance.` | `Un seul regroupement à la fois : chaque vue coûte un appel Performance Insights par instance.` |
| `Monitoring.queries.sortBy.label` | `Sort by` | `Trier par` |
| `Monitoring.queries.sortBy.load` | `Total load` | `Charge totale` |
| `Monitoring.queries.sortBy.instances` | `Most instances affected` | `Plus d'instances touchées` |
| `Monitoring.queries.columns.statement` | `Entry` | `Entrée` |
| `Monitoring.queries.columns.load` | `Total load` | `Charge totale` |
| `Monitoring.queries.columns.share` | `Share` | `Part` |
| `Monitoring.queries.columns.instances` | `Instances` | `Instances` |
| `Monitoring.queries.columns.origins` | `Where it comes from` | `Origine` |
| `Monitoring.queries.origin` | `{instance} — {load} — {share}` | `{instance} — {load} — {share}` |
| `Monitoring.queries.expand` | `Show the full text` | `Afficher le texte complet` |
| `Monitoring.queries.notCoveredTitle` | `Instances not covered` | `Instances non couvertes` |
| `Monitoring.queries.empty` | `No database instance in this region has Performance Insights enabled.` | `Aucune instance de cette région n'a Performance Insights activé.` |
| `Monitoring.queries.emptyButUncovered` | `No statement was returned for the instances that could be read.` | `Aucune requête n'a été renvoyée pour les instances lisibles.` |
| `Monitoring.queries.tableCaption` | `Database load by {group}` | `Charge de base de données par {group}` |

- [ ] **Step 5: Run the tests**

Run: `npx vitest run` then the e2e command of step 2.
Expected: all pass.

- [ ] **Step 6: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip` (`queries.ts`, `coverage.ts`, `coverage-note.tsx`, `not-covered-list.tsx`, `dense-table.tsx`, `top-n-bars.tsx` are now imported and must have left the unused list).
Commit: `feat(databases): cross-instance queries page with per-instance origin`.

**moto limits:** fact 7 and fact 8 mean the table itself is always empty in e2e; the assertions above are exactly the states moto can produce. Everything about a populated table is unit-tested in Task 10.
**Owner-only verification:** the page's core promise — real statements with their per-instance origin on the owner's account — is spec §7's definition of done and can only be confirmed there.

---

### Task 12: Report and dashboard engine

Implements two shapes at once, because they share almost everything: the report shape (spec §3 items 1–4, with amendment 6 — the previous-window comparison costs nothing extra) and the dashboard shape (spec §9.2's fixed top-to-bottom order, with §9.3's headline sentences). Both evaluate the Stage 2 insight rules over their own window rather than the live 15 minutes, which needs one small change to `insights.ts`.

**Files:**
- Create: `src/lib/analysis/report.ts`
- Create: `src/components/analysis/report-shell.tsx`, `src/components/analysis/dashboard-shell.tsx`, `src/components/analysis/headline-list.tsx`
- Modify: `src/lib/monitoring/insights.ts` (add `windowMinutes` to `RuleContext`)
- Create: `tests/unit/analysis-report.test.ts`
- Modify: `tests/unit/monitoring-insights.test.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `DoubleWindow`, `ReportRange`, `Change`, `Aggregate`, `WindowedMetric`, `doubleWindow`, `windowedMetric`, `parseReportRange`, `REPORT_RANGES` from `@/lib/analysis/window`; `Coverage`, `NotCovered`, `capResources`, `coverageOf`, `REPORT_METRIC_QUERY_CAP` from `@/lib/analysis/coverage`; `MetricQuery`, `MetricSeries`, `SeriesData`, `getMetricSeries`, `seriesById` from `@/lib/monitoring/metrics`; `Insight`, `RuleContext`, `sortInsights` from `@/lib/monitoring/insights`; `MetricUnit` from `@/lib/monitoring/shared/format`; `Tone` from `@/lib/ui/tones`; `toneForValue`, `ThresholdLevels` from `@/lib/monitoring/shared/bands`.
- Produces (`src/lib/analysis/report.ts`):
  - `export type ReportMetricId = string;`
  - `export type ReportMetric = WindowedMetric & { unit: MetricUnit; tone: Tone | null };`
  - `export type ReportRow = { id: string; name: string; href: string; metrics: Record<ReportMetricId, ReportMetric>; tone: Tone | null };`
  - `export type Headline = { key: string; values: Record<string, string | number> };`
  - `export type ReportKpi = { id: string; labelKey: string; value: number | null; unit: MetricUnit; tone: Tone | null; change?: Change };`
  - `export type SectionReport = { range: ReportRange; window: DoubleWindow; kpis: ReportKpi[]; headlines: Headline[]; rows: ReportRow[]; coverage: Coverage; notCovered: NotCovered[]; insights: Insight[] };`
  - `export function reportMetric(series: SeriesData, split: DoubleWindow, aggregate: Aggregate, unit: MetricUnit, levels?: ThresholdLevels): ReportMetric`
  - `export function rankRows(rows: readonly ReportRow[], metricId: ReportMetricId, limit: number): ReportRow[]`
  - `export const REPORT_TOP_N = 10;`
  - `export function planQueries<T>(resources: readonly T[], queriesPerResource: number): { included: T[]; excluded: T[]; coverage: Coverage }` — a thin, named wrapper over `capResources(resources, queriesPerResource, REPORT_METRIC_QUERY_CAP)` so no report page has to remember the cap.
  - `export function reportRuleContext(scope: ScopeRef, split: DoubleWindow): RuleContext`
  - `export function sharePercent(part: number | null, whole: number | null): number | null`
  - `export type DashboardKpi = ReportKpi;` — a dashboard tile is a report tile; the type is aliased rather than duplicated.
  - `export type DashboardStatus = { key: string; count: number; tone: Tone; hrefQuery: string };` — one status-bar segment before localization; `hrefQuery` is the query string that filters the table to that state, so a click on the bar filters the list below it (spec §1b: "clickable to filter").
  - `export type SectionDashboard = { kpis: DashboardKpi[]; status: DashboardStatus[]; headlines: Headline[]; coverage: Coverage; notCovered: NotCovered[]; insights: Insight[] };`
  - `export function dashboardRuleContext(scope: ScopeRef, nowMs: number): RuleContext` — `{ scope, now: nowMs }` with **no** `windowMinutes`, so a dashboard fires exactly the live rules the Overview fires and a resource is never flagged on one page and clean on the other.
- Produces (`src/components/analysis/headline-list.tsx`, server):
  - `export async function HeadlineList({ headlines, namespace, label }: { headlines: readonly Headline[]; namespace: string; label: string }): Promise<React.JSX.Element | null>`

  `HeadlineList` renders `null` for an empty list, otherwise a `<section aria-label={label}>` of `<p>`s, each `t(\`${namespace}.headline.${h.key}\`, values)`. **A headline's `values.window`, when present, holds the raw range token (`'12h'`), and `HeadlineList` replaces it with `t(\`Monitoring.common.window.${token}\`)` before interpolating** — that is why the producers' unit tests assert `window: '12h'` and the rendered sentence reads "12 hours". Numeric values whose unit matters are pre-formatted by the producer through `formatMetricValue`, exactly as `formatInsightValues` does for insights; plain counts stay numbers so ICU plurals keep working.
- Produces (`src/components/analysis/report-shell.tsx`, server):
  - `export async function ReportShell({ report, namespace, resourceKey, children }: { report: SectionReport; namespace: string; resourceKey: 'services' | 'instances' | 'loadBalancers' | 'logGroups' | 'alarms'; children: React.ReactNode }): Promise<React.JSX.Element>`

**Why `insights.ts` changes.** Spec §3 item 4 says the "what to look at next" block evaluates the Stage 2 rules "over the report window". The rules slice the last `INSIGHT_WINDOW_MINUTES` (15) themselves through `minutesAgo(ctx, INSIGHT_WINDOW_MINUTES)`. So `RuleContext` gains one optional field and the **metric-threshold slices only** read it:

```ts
/** `now` is the end of the evaluation window (epoch ms); `windowMinutes` widens the slice the metric rules take,
 *  so a report can evaluate the same rules over 12 hours. The deployment rules keep their own fixed windows:
 *  "fewer tasks than desired for 10 minutes" and "rolling out for 30 minutes" are about state, not about a trend. */
export type RuleContext = { scope: ScopeRef; now: number; windowMinutes?: number };
const ruleWindowMinutes = (ctx: RuleContext) => ctx.windowMinutes ?? INSIGHT_WINDOW_MINUTES;
```

Every `minutesAgo(ctx, INSIGHT_WINDOW_MINUTES)` becomes `minutesAgo(ctx, ruleWindowMinutes(ctx))` — there are four of them: in `ecsServiceInsights`, in `rdsInstanceInsights`, in `replicaLagInsights` and in `albInsights`. `minutesAgo(ctx, TASKS_WINDOW_MINUTES)` and `minutesAgo(ctx, ROLLOUT_STUCK_MINUTES)` are **left alone**. The insight *messages* say "over 15 minutes", which would be wrong in a report, so the report renders insights through the same `InsightList` but under a heading that names the window (`Reports.insights.title` with `{window}`) and the per-message window wording is corrected by adding a `{window}` placeholder to the five affected `Insights.messages.*` keys — see step 5.

**The reusable report shell:** `ReportShell` renders, in order, the `CoverageNote`, the `HeadlineList`, a `<section>` of `KpiTile`s from `report.kpis`, `children` (the section's own table and figures), the `NotCoveredList`, and finally the "What to look at next" `<section>` holding an `InsightList` of `report.insights` (or `t('insights.none')` when empty).

**The reusable dashboard shell:** `DashboardShell` renders spec §9.2's order exactly, and every section's dashboard uses it so the six pages are one page with six fillings:

```tsx
export async function DashboardShell({ dashboard, namespace, resourceKey, figures, topN, table, statusHrefFor }: {
  dashboard: SectionDashboard;
  namespace: string;                       // e.g. 'Dashboards.containers'
  resourceKey: 'services' | 'instances' | 'loadBalancers' | 'logGroups' | 'alarms';
  figures?: React.ReactNode;               // charts or a heat grid
  topN?: React.ReactNode;                  // one or two TopNBars
  table: React.ReactNode;                  // the section's existing list, unchanged in behaviour
  statusHrefFor: (segment: DashboardStatus) => string;
}): Promise<React.JSX.Element>
```

**Who uses which shell:** Tasks 13 (Containers), 14 (Load balancers), 18 (Databases) and 20 (Alarms) render their report through `ReportShell`. Tasks 15 (Containers), 16 (Load balancers), 19 (Databases), 21 (Alarms) and 22 (Logs) render their dashboard through `DashboardShell`. Task 25 (Overview) is the one exception: spec §9.2 gives it category cards instead of a table, a status bar and figures, so it renders its own layout, reusing the category cards and the existing `InsightList`. No other page builds its own report or dashboard layout.

Order: `HeadlineList` (spec §9.3, "what stands out", first so the words come before the numbers) → `CoverageNote` → the `KpiTile` row (`grid gap-4 sm:grid-cols-2 xl:grid-cols-4`) → `StatusBar` built from `dashboard.status` with `statusHrefFor` → `figures` → `topN` → `table` → `NotCoveredList` → the insights `<section>` with `InsightList` and `windowLabel={t('Insights.window.live')}`. Each of `figures`, `topN` and `table` is passed already wrapped in its own `SuspenseCard` by the page, so a slow heat grid never holds the table.

- [ ] **Step 1: Write the failing report test**

Create `tests/unit/analysis-report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { doubleWindow } from '@/lib/analysis/window';
import { REPORT_TOP_N, planQueries, rankRows, reportMetric, reportRuleContext, sharePercent } from '@/lib/analysis/report';

const now = Date.parse('2026-09-18T14:07:42Z');
const w = doubleWindow('12h', now);
const seriesOf = (previous: number, current: number) => {
  const step = 900_000;
  const timestamps = Array.from({ length: 96 }, (_, i) => w.fetch.start.getTime() + i * step);
  return { timestamps, values: timestamps.map((t) => (t < w.splitAtMs ? previous : current)) };
};

describe('reportMetric', () => {
  it('aggregates both halves, compares them and picks a tone', () => {
    const cpu = { warning: 85, critical: 95, direction: 'above' } as const;
    expect(reportMetric(seriesOf(40, 90), w, 'average', 'percent', cpu)).toEqual({
      current: 90, previous: 40, change: { kind: 'up', ratio: 1.25 }, unit: 'percent', tone: 'warning',
    });
    expect(reportMetric(seriesOf(40, 40), w, 'average', 'percent', cpu).tone).toBe('success');
    expect(reportMetric(seriesOf(40, 98), w, 'average', 'percent', cpu).tone).toBe('danger');
  });
  it('leaves the tone null without thresholds and for an empty series', () => {
    expect(reportMetric(seriesOf(1, 2), w, 'sum', 'count').tone).toBeNull();
    expect(reportMetric({ timestamps: [], values: [] }, w, 'max', 'count', { warning: 1, direction: 'above' }))
      .toEqual({ current: null, previous: null, change: { kind: 'unavailable' }, unit: 'count', tone: null });
  });
});

describe('rankRows', () => {
  const row = (id: string, current: number | null) => ({ id, name: id, href: `/x/${id}`, tone: null, metrics: { cpu: { current, previous: null, change: { kind: 'unavailable' as const }, unit: 'percent' as const, tone: null } } });
  it('ranks by the current value, highest first, nulls last, and truncates', () => {
    expect(rankRows([row('a', 10), row('b', null), row('c', 90), row('d', 50)], 'cpu', 3).map((r) => r.id)).toEqual(['c', 'd', 'a']);
    expect(rankRows([row('a', 10), row('b', null)], 'cpu', 10).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('returns the rows unranked when the metric is unknown', () => {
    expect(rankRows([row('a', 10), row('c', 90)], 'nope', 10).map((r) => r.id)).toEqual(['a', 'c']);
  });
  it('defaults the report to ten rows', () => {
    expect(REPORT_TOP_N).toBe(10);
  });
});

describe('planQueries', () => {
  it('fits the 300-query budget', () => {
    expect(planQueries(Array.from({ length: 100 }, (_, i) => i), 4).coverage).toEqual({ covered: 75, total: 100, truncated: true });
    expect(planQueries(Array.from({ length: 10 }, (_, i) => i), 4).coverage).toEqual({ covered: 10, total: 10, truncated: false });
  });
});

describe('reportRuleContext', () => {
  it('evaluates the Stage 2 rules over the current half, not the last 15 minutes', () => {
    const ctx = reportRuleContext({ connectionId: 'abc', region: 'eu-west-1' }, w);
    expect(ctx.now).toBe(w.current.end.getTime());
    expect(ctx.windowMinutes).toBe(720);   // 12 h
  });
});

describe('sharePercent', () => {
  it('divides safely', () => {
    expect(sharePercent(25, 100)).toBe(25);
    expect(sharePercent(0, 0)).toBeNull();
    expect(sharePercent(5, null)).toBeNull();
    expect(sharePercent(null, 5)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing insight-window test**

Add to `tests/unit/monitoring-insights.test.ts` a case proving the new field and proving the deployment rules ignore it:

```ts
it('widens the metric slice when the rule context carries a window', () => {
  // A service at 90 % CPU for the first ten hours of a twelve-hour window and 20 % in the last hour:
  // the live 15-minute rule sees nothing, the 12-hour rule reports it.
  const now = Date.parse('2026-09-18T14:00:00Z');
  const step = 900_000;
  const timestamps = Array.from({ length: 48 }, (_, i) => now - (47 - i) * step);
  const cpu = { timestamps, values: timestamps.map((t) => (t <= now - 4 * 3600_000 ? 90 : 20)) };
  const signals = [{ cluster: 'prod', services: [{ service: serviceFixture, cpu, memory: emptySeries, running: null, desired: null }] }];
  expect(ecsInsights(signals, { scope, now })).toEqual([]);
  const widened = ecsInsights(signals, { scope, now, windowMinutes: 720 });
  expect(widened.map((i) => i.kind)).toContain('ecs_cpu_high');
});

it('keeps the deployment windows fixed whatever the rule window is', () => {
  // A deployment created 20 minutes ago is not stuck, even when the rules evaluate 12 hours of metrics.
  const now = Date.parse('2026-09-18T14:00:00Z');
  const service = { ...serviceFixture, primaryDeployment: { ...deploymentFixture, rolloutState: 'IN_PROGRESS', createdAt: now - 20 * 60_000 } };
  const signals = [{ cluster: 'prod', services: [{ service, cpu: emptySeries, memory: emptySeries, running: null, desired: null }] }];
  expect(ecsInsights(signals, { scope, now, windowMinutes: 720 }).map((i) => i.kind)).not.toContain('ecs_rollout_stuck');
});
```

(`serviceFixture`, `deploymentFixture`, `emptySeries` and `scope` already exist in that suite; reuse them and do not redefine them.)

- [ ] **Step 3: Run both to see them fail**

Run: `npx vitest run tests/unit/analysis-report.test.ts tests/unit/monitoring-insights.test.ts`
Expected: FAIL — `@/lib/analysis/report` missing and `windowMinutes` not honoured.

- [ ] **Step 4: Write the module, the two components and the `insights.ts` change**

`reportMetric` is `{ ...windowedMetric(series, split, aggregate), unit, tone: levels ? toneForValue(current, levels) : null }`. `rankRows` reads `row.metrics[metricId]?.current`, sorts descending with nulls last and a stable tie-break on `id`, then slices to `limit`; an unknown `metricId` returns `rows.slice(0, limit)` untouched. `reportRuleContext` returns `{ scope, now: split.current.end.getTime(), windowMinutes: (split.current.end.getTime() - split.current.start.getTime()) / 60_000 }`. `sharePercent` returns `null` when `whole` is `null`, `0` or not finite, or when `part` is `null`.

- [ ] **Step 5: Correct the insight wording for a wider window**

Five `Insights.messages.*` keys hard-code "15 minutes". Replace the literal with `{window}` in both languages and pass `window: t(\`Monitoring.common.window.${range}\`)` (or `Insights.window.live` for the Overview). Add `Insights.window.live` = `15 minutes` / `15 minutes`. The five keys and their new text:

| Key | EN | FR |
|---|---|---|
| `Insights.messages.ecs_cpu_high` | `{service} CPU averages {value} over {window} (threshold {threshold}).` | `Le CPU de {service} est en moyenne à {value} sur {window} (seuil {threshold}).` |
| `Insights.messages.ecs_memory_high` | `{service} memory averages {value} over {window} (threshold {threshold}).` | `La mémoire de {service} est en moyenne à {value} sur {window} (seuil {threshold}).` |
| `Insights.messages.rds_cpu_high` | `{instance} CPU averages {value} over {window} (threshold {threshold}).` | `Le CPU de {instance} est en moyenne à {value} sur {window} (seuil {threshold}).` |
| `Insights.messages.alb_5xx_rate` | `{loadBalancer} answers {rate} of requests with a 5xx error ({errors} of {requests} over {window}).` | `{loadBalancer} répond à {rate} des requêtes par une erreur 5xx ({errors} sur {requests} en {window}).` |
| `Insights.messages.alb_elb_5xx_count` | `{loadBalancer} itself returned {count} 5xx errors over {window}.` | `{loadBalancer} a lui-même renvoyé {count} erreurs 5xx en {window}.` |
| `Insights.window.live` | `15 minutes` | `15 minutes` |

The `window` value is injected where the insight is **rendered**, not where it is produced, so `insights.ts` and its `values` are unchanged. `InsightList` gains a required prop `windowLabel: string` and merges `{ window: windowLabel }` into the values it passes to `t(...)`; the Overview passes `t('Insights.window.live')`, a report passes its range label. Update `overview/insights/cards.tsx` accordingly.

- [ ] **Step 6: Add the shared report messages**

New top-level namespace `Reports` (server-side only, not in `CLIENT_NAMESPACES`). The shared part now; each report task adds its own sub-object.

| Key | EN | FR |
|---|---|---|
| `Reports.window.label` | `Report window` | `Fenêtre du rapport` |
| `Reports.window.subtitle` | `{connection} · {region} · last {window}` | `{connection} · {region} · dernières {window}` |
| `Reports.comparison` | `Compared with the previous {window}.` | `Comparé aux {window} précédentes.` |
| `Reports.noAutoRefresh` | `This report does not refresh on its own. Reload it to run it again.` | `Ce rapport ne s'actualise pas seul. Rechargez la page pour le relancer.` |
| `Reports.headlinesLabel` | `What happened` | `Ce qui s'est passé` |
| `Reports.kpisLabel` | `Key figures` | `Chiffres clés` |
| `Reports.insights.title` | `What to look at next, over the last {window}` | `À examiner ensuite, sur les {window} écoulées` |
| `Reports.insights.none` | `No rule fired over this window.` | `Aucune règle ne s'est déclenchée sur cette fenêtre.` |
| `Reports.empty` | `This region has nothing to report on.` | `Cette région n'a rien à signaler.` |

New top-level namespace `Dashboards` (server-side only), shared part now, one sub-object per section added by Tasks 15, 16, 19, 21, 22 and 25:

| Key | EN | FR |
|---|---|---|
| `Dashboards.headlinesLabel` | `What stands out` | `Ce qui ressort` |
| `Dashboards.kpisLabel` | `Key figures` | `Chiffres clés` |
| `Dashboards.statusLabel` | `By state` | `Par état` |
| `Dashboards.figuresLabel` | `Over time` | `Dans le temps` |
| `Dashboards.topLabel` | `Ranking` | `Classement` |
| `Dashboards.tableLabel` | `All resources` | `Toutes les ressources` |
| `Dashboards.insights.title` | `What to look at next` | `À examiner ensuite` |
| `Dashboards.insights.none` | `Nothing is firing right now.` | `Rien ne se déclenche actuellement.` |
| `Dashboards.reportLink` | `Open the {section} report` | `Ouvrir le rapport {section}` |
| `Dashboards.statusFilter` | `Filter the table to {state}` | `Filtrer le tableau sur {state}` |
| `Dashboards.rangeNote` | `The figures above read the last 15 minutes; the time range sets the table trends and the pages they link to.` | `Les indicateurs ci-dessus portent sur les 15 dernières minutes ; la plage horaire règle les tendances du tableau et les pages vers lesquelles il pointe.` |

- [ ] **Step 7: Add a failing test for the dashboard shape**

Append to `tests/unit/analysis-report.test.ts`:

```ts
import { dashboardRuleContext } from '@/lib/analysis/report';

describe('dashboardRuleContext', () => {
  it('fires exactly the live rules, so a dashboard and the Overview never disagree', () => {
    const ctx = dashboardRuleContext({ connectionId: 'abc', region: 'eu-west-1' }, now);
    expect(ctx).toEqual({ scope: { connectionId: 'abc', region: 'eu-west-1' }, now });
    expect(ctx.windowMinutes).toBeUndefined();
  });
});
```

- [ ] **Step 8: Register the boundary and run the tests**

Add `'lib/analysis/report.ts'` to `SERVER_ONLY_MODULES`.
Run: `npx vitest run tests/unit/analysis-report.test.ts tests/unit/monitoring-insights.test.ts tests/unit/monitoring-overview.test.ts tests/unit/module-boundaries.test.ts tests/unit/i18n-messages.test.ts`
Expected: all pass. `monitoring-overview.test.ts` must be unaffected: the Overview passes no `windowMinutes`, so the rules behave exactly as before.

- [ ] **Step 9: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and the full e2e suite (the Overview's insight sentences changed, so `06-monitoring.spec.ts` may assert the old "over 15 minutes" text — update it to the new rendering if it does).
Commit: `feat(analysis): report and dashboard engine with previous-window comparison`.

**moto limits:** the engine is pure; its e2e coverage comes with Tasks 13 to 16.
**Owner-only verification:** none.

---

### Task 13: Containers report

Implements spec §3 for the Containers section: headline sentences, ECS services ranked by average and peak CPU and memory, the change against the previous window, and the insight rules over the report window.

**Files:**
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/containers/report/page.tsx`, `…/containers/report/cards.tsx`
- Create: `src/lib/analysis/containers-report.ts`
- Create: `tests/unit/analysis-containers-report.test.ts`
- Modify: `tests/e2e/08-analysis.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `listClusters`, `listServices`, `serviceUtilizationQueries`, `EcsCluster`, `EcsService` from `@/lib/monitoring/ecs`; `getMetricSeries`, `seriesById`, `MetricQuery` from `@/lib/monitoring/metrics`; `ecsInsights`, `EcsClusterSignals`, `sortInsights`, `ECS_UTILIZATION_LEVELS` from `@/lib/monitoring/insights`; `doubleWindow`, `parseReportRange`, `REPORT_RANGES` from `@/lib/analysis/window`; `reportMetric`, `rankRows`, `planQueries`, `reportRuleContext`, `REPORT_TOP_N`, `SectionReport`, `ReportRow` from `@/lib/analysis/report`; `notCovered`, `sortNotCovered`, `coverageOf` from `@/lib/analysis/coverage`; `subsectionPath` from `@/lib/monitoring/shared/paths`.
- Produces (`src/lib/analysis/containers-report.ts`):
  - `export const CONTAINERS_REPORT_METRICS = ['cpuAvg', 'cpuMax', 'memAvg', 'memMax'] as const;`
  - `export function containersReport(target: AwsTarget, options: { range: ReportRange; nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<SectionReport>>`
  - `export function containersHeadlines(rows: readonly ReportRow[], range: ReportRange): Headline[]`

**The query plan.** Four queries per service, all in one `GetMetricData` call over the double window:

```ts
const serviceReportQueries = (cluster: string, service: string, prefix: string): MetricQuery[] => {
  const dimensions = { ClusterName: cluster, ServiceName: service };   // sorted by name inside metrics.ts (moto fact 4)
  return [
    { id: `${prefix}cpuAvg`, namespace: 'AWS/ECS', metricName: 'CPUUtilization', dimensions, stat: 'Average' },
    { id: `${prefix}cpuMax`, namespace: 'AWS/ECS', metricName: 'CPUUtilization', dimensions, stat: 'Maximum' },
    { id: `${prefix}memAvg`, namespace: 'AWS/ECS', metricName: 'MemoryUtilization', dimensions, stat: 'Average' },
    { id: `${prefix}memMax`, namespace: 'AWS/ECS', metricName: 'MemoryUtilization', dimensions, stat: 'Maximum' },
  ];
};
```

No percentile is requested here, so this is a single call. `planQueries(services, 4)` caps the fleet at 75 services out of the 300-query budget; the excluded ones become `notCovered(name, 'cap')`.

**The headlines** (spec §3 item 1, three sentences, each a key with placeholders, never generated prose):
1. `Reports.containers.headline.saturated` — the number of services whose `cpuAvg.current` exceeds `ECS_UTILIZATION_LEVELS.warning.threshold` (85).
2. `Reports.containers.headline.top` — the highest `cpuAvg` service with its average and its `cpuMax`. Omitted when no service was covered.
3. `Reports.containers.headline.memory` — the number of services whose `memAvg.current` exceeds 85.

**The KPI tiles:** services covered (`count`, no tone), highest average CPU (`percent`, toned by `ECS_UTILIZATION_LEVELS`, with its change), highest average memory (same), and services above 85 % CPU (`count`, toned `danger` when > 0).

**The table:** `DenseTable` with columns `service` (`always`), `cluster` (`md`), `cpuAvg` (`always`, right, with a `ChangeArrow`), `cpuMax` (`sm`, right), `memAvg` (`sm`, right, with a `ChangeArrow`), `memMax` (`lg`, right), `tasks` (`lg`, right — `runningCount` of `desiredCount` from the describe call, no metric cost). Sorted by `cpuAvg` descending by default, sortable on every numeric column through `sortHref`. Plus a `HeatGrid` of every covered service coloured by `cpuAvg`, which is §1b's "ECS services by CPU" fleet-at-a-glance.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/analysis-containers-report.test.ts` with an `aws-sdk-client-mock` on `ECSClient` and `CloudWatchClient`:

```ts
it('asks for four statistics per service over twice the range, in one call', async () => {
  // two clusters, one service each
  const result = await containersReport(target, { range: '12h', nowMs: t }, deps);
  const call = cw.commandCalls(GetMetricDataCommand)[0].args[0].input;
  expect(cw.commandCalls(GetMetricDataCommand)).toHaveLength(1);
  expect(call.MetricDataQueries).toHaveLength(8);
  expect(call.StartTime).toEqual(new Date('2026-09-17T14:00:00Z'));
  expect(call.EndTime).toEqual(new Date('2026-09-18T14:00:00Z'));
  expect(call.MetricDataQueries?.[0].MetricStat?.Period).toBe(900);
  expect(call.MetricDataQueries?.map((q) => q.MetricStat?.Stat)).toEqual(['Average', 'Maximum', 'Average', 'Maximum', 'Average', 'Maximum', 'Average', 'Maximum']);
  expect(result.ok && result.data.window.range).toBe('12h');
});

it('splits each series into the two halves and reports the change per row', async () => {
  // CPU 40 % for the first 12 h, 60 % for the last 12 h.
  const result = await containersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.rows[0].metrics.cpuAvg).toMatchObject({ current: 60, previous: 40, change: { kind: 'up', ratio: 0.5 } });
});

it('writes three headlines from the data', async () => {
  const result = await containersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.headlines).toEqual([
    { key: 'saturated', values: { count: 1, threshold: 85, window: '12h' } },
    { key: 'top', values: { service: 'web', cpu: 90, peak: 97, window: '12h' } },
    { key: 'memory', values: { count: 0, threshold: 85, window: '12h' } },
  ]);
});

it('caps the fleet at 75 services and lists the rest as not covered', async () => {
  // 80 services seeded
  const result = await containersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.coverage).toEqual({ covered: 75, total: 80, truncated: true });
  expect(result.ok && result.data.notCovered).toHaveLength(5);
  expect(cw.commandCalls(GetMetricDataCommand)[0].args[0].input.MetricDataQueries).toHaveLength(300);
});

it('evaluates the insight rules over the whole report window', async () => {
  // A service at 90 % CPU for ten of twelve hours and 20 % in the last hour.
  const result = await containersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.insights.map((i) => i.kind)).toContain('ecs_cpu_high');
});

it('returns the AWS failure when the cluster list cannot be read', async () => {
  ecs.on(ListClustersCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));
  expect(await containersReport(target, { range: '12h', nowMs: t }, deps))
    .toEqual({ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'ecs:ListClusters' });
});

it('still renders the table when only the metrics fail', async () => {
  cw.on(GetMetricDataCommand).rejects(Object.assign(new Error('no'), { name: 'ThrottlingException' }));
  const result = await containersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.rows.map((r) => r.metrics.cpuAvg.current)).toEqual([null, null]);
  expect(result.ok && result.data.notCovered.some((r) => r.reason === 'throttled')).toBe(true);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/analysis-containers-report.test.ts` → FAIL, module missing.

- [ ] **Step 3: Write `containers-report.ts`, the page and the cards**

The page: `initMonitoringRoute` first, `parseReportRange(sp.range)`, one `pageNow()`, then `SectionLayout` with `section="containers"`, `subsection="report"`, `range`, `ranges={REPORT_RANGES}`, `autoRefresh={false}`, and one `SuspenseCard` around `ContainersReportCard`. The card resolves the target, calls `containersReport`, and renders `ReportShell` wrapping the `HeatGrid` and the `DenseTable`.

- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Reports.containers.title` | `Containers report` | `Rapport conteneurs` |
| `Reports.containers.description` | `What the ECS services of {region} did over the window.` | `Ce qu'ont fait les services ECS de {region} sur la fenêtre.` |
| `Reports.containers.cardTitle` | `Services by load` | `Services par charge` |
| `Reports.containers.headline.saturated` | `Over the last {window}, {count, plural, =0 {no service} one {# service} other {# services}} used more than {threshold} CPU on average.` | `Sur les {window} écoulées, {count, plural, =0 {aucun service n'a} one {# service a} other {# services ont}} utilisé plus de {threshold} de CPU en moyenne.` |
| `Reports.containers.headline.top` | `{service} used the most CPU: {cpu} on average, peaking at {peak}.` | `{service} a le plus consommé de CPU : {cpu} en moyenne, avec un pic à {peak}.` |
| `Reports.containers.headline.memory` | `{count, plural, =0 {No service} one {# service} other {# services}} used more than {threshold} memory on average.` | `{count, plural, =0 {Aucun service n'a} one {# service a} other {# services ont}} utilisé plus de {threshold} de mémoire en moyenne.` |
| `Reports.containers.kpi.services` | `Services covered` | `Services couverts` |
| `Reports.containers.kpi.cpu` | `Highest average CPU` | `CPU moyen le plus élevé` |
| `Reports.containers.kpi.memory` | `Highest average memory` | `Mémoire moyenne la plus élevée` |
| `Reports.containers.kpi.saturated` | `Services above {threshold} CPU` | `Services au-dessus de {threshold} de CPU` |
| `Reports.containers.columns.service` | `Service` | `Service` |
| `Reports.containers.columns.cluster` | `Cluster` | `Cluster` |
| `Reports.containers.columns.cpuAvg` | `CPU, average` | `CPU, moyenne` |
| `Reports.containers.columns.cpuMax` | `CPU, peak` | `CPU, pic` |
| `Reports.containers.columns.memAvg` | `Memory, average` | `Mémoire, moyenne` |
| `Reports.containers.columns.memMax` | `Memory, peak` | `Mémoire, pic` |
| `Reports.containers.columns.tasks` | `Tasks` | `Tâches` |
| `Reports.containers.tasks` | `{running} of {desired}` | `{running} sur {desired}` |
| `Reports.containers.heatLabel` | `Every service by average CPU` | `Chaque service par CPU moyen` |
| `Reports.containers.notCoveredTitle` | `Services not covered` | `Services non couverts` |
| `Reports.containers.empty` | `This region runs no ECS service.` | `Cette région n'exécute aucun service ECS.` |
| `Reports.containers.tableCaption` | `ECS services ranked by average CPU` | `Services ECS classés par CPU moyen` |

- [ ] **Step 5: Write the failing end-to-end test**

Add to `tests/e2e/08-analysis.spec.ts`:

```ts
test('the containers report renders over 12 hours with headlines, a ranking and a comparison', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/containers/report`);
  await expect(page).toHaveTitle('Report · OpsWatch');
  await expect(page.getByRole('heading', { level: 1, name: 'Report' })).toBeVisible();
  await expect(page.getByText('Over the last 12 hours,', { exact: false })).toBeVisible();
  await expect(page.getByText('Covering 1 of 1 services.')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'web' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('opswatch-e2e');
  // The seed puts 30 minutes of datapoints in the current half and nothing in the previous one.
  await expect(row).toContainText('No value in the previous 12 hours');
  await expect(page.getByText('This report does not refresh on its own.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /auto-refresh/i })).toHaveCount(0);
});

test('the report range selector offers only the report ranges', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/containers/report`);
  const ranges = page.getByRole('navigation', { name: 'Time range' });
  await expect(ranges.getByRole('link', { name: '1 h' })).toHaveCount(0);
  await ranges.getByRole('link', { name: '24 h' }).click();
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/containers/report?range=24h`);
  await expect(page.getByText('Over the last 24 hours,', { exact: false })).toBeVisible();
});
```

- [ ] **Step 6: Run everything**

Run: `npx vitest run` then `docker compose -f docker-compose.test.yml up -d --build --wait && npx playwright test --config tests/e2e/playwright.config.ts 08-analysis; docker compose -f docker-compose.test.yml down -v`
Expected: all pass.

- [ ] **Step 7: Verify and commit**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`.
Add `'lib/analysis/containers-report.ts'` to `SERVER_ONLY_MODULES` before running the tests.
Commit: `feat(containers): section report with previous-window comparison`.

**moto limits:** moto's seed puts 30 whole minutes of CPU and memory datapoints ending at seed time, so the **previous** half of any report window is always empty and every change reads `new`. The e2e above asserts exactly that, which is honest; the populated-comparison case is unit-tested. moto's `runningCount` is 0 and `pendingCount` equals desired (fact 6), so the tasks column reads `0 of 2`.
**Owner-only verification:** that a real 12-hour report ranks the services they expect and that the change arrows match what they saw in the console.

---

### Task 14: Load balancers report

Implements spec §3 for the Load balancers section: load balancers ranked by requests, 5xx and p95, with the p95 isolated in its own `GetMetricData` call.

**Files:**
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/load-balancers/report/page.tsx`, `…/report/cards.tsx`
- Create: `src/lib/analysis/load-balancers-report.ts`
- Create: `tests/unit/analysis-load-balancers-report.test.ts`
- Modify: `tests/e2e/08-analysis.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `listLoadBalancers`, `loadBalancerQueries`, `loadBalancerLatencyQuery`, `LoadBalancer` from `@/lib/monitoring/elb`; `listTargetGroups`, `targetGroupQueries` are **not** used (the report ranks load balancers, not groups); `getMetricSeries`, `seriesById` from `@/lib/monitoring/metrics`; `albInsights`, `AlbSignals`, `ALB_5XX_RATE_LEVELS`, `ALB_MIN_REQUESTS` from `@/lib/monitoring/insights`; the Task 12 report engine; `sharePercent` from `@/lib/analysis/report`.
- Produces (`src/lib/analysis/load-balancers-report.ts`):
  - `export const LB_REPORT_METRICS = ['requests', 'elb5xx', 'target5xx', 'errorRate', 'p95'] as const;`
  - `export function loadBalancersReport(target: AwsTarget, options: { range: ReportRange; nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<SectionReport>>`

**The query plan.** Three `Sum` queries per load balancer in one call, then **one separate call** holding only the p95 queries (global constraint, moto fact 2):

```ts
const base = loadBalancers.flatMap((lb, n) => loadBalancerQueries(lb, `l${n}`));          // req, elb5xx, t5xx
const latency = loadBalancers.map((lb, n) => loadBalancerLatencyQuery(lb, `l${n}`));      // p95 only
const [sums, percentiles] = await Promise.all([
  getMetricSeries(target, base, split.fetch, deps),
  getMetricSeries(target, latency, split.fetch, deps),
]);
// A failed percentile call blanks the p95 column and nothing else.
```

`planQueries(loadBalancers, 4)` counts all four queries per load balancer against the 300 budget, so the cap is 75 load balancers, even though they arrive in two calls.

`errorRate` is derived, not fetched: `sharePercent(elb5xx.current + target5xx.current, requests.current)` for the current half and the same for the previous half, then `compareWindows` on the two rates. Write it as an explicit helper `rateMetric(errors: WindowedMetric, requests: WindowedMetric): ReportMetric` so the previous-half rate is computed from the previous halves and never from the current ones.

**Headlines:**
1. `Reports.loadBalancers.headline.traffic` — the busiest load balancer, its request count and its share of the region's requests (`sharePercent`). Omitted when no load balancer was covered or when total requests are 0.
2. `Reports.loadBalancers.headline.errors` — the number of load balancers whose `errorRate.current` exceeds `ALB_5XX_RATE_LEVELS.warning.threshold` (1 %) **and** whose `requests.current` reaches `ALB_MIN_REQUESTS`, so a handful of requests never produces a sentence.
3. `Reports.loadBalancers.headline.latency` — the worst p95 and its load balancer, or `Reports.loadBalancers.headline.latencyUnavailable` when the percentile call failed or returned nothing.

**KPI tiles:** requests (`count`, `Sum`, with change), error rate (`percent`, toned by `ALB_5XX_RATE_LEVELS`, with change), worst p95 (`seconds`, no tone, with change), load balancers covered (`count`).

**The table:** columns `loadBalancer` (`always`, a `<Link>` to `/load-balancers/list/<name>`), `requests` (`always`, right, `ChangeArrow`), `share` (`md`, right), `target5xx` (`sm`, right), `elb5xx` (`md`, right), `errorRate` (`always`, right, toned, `ChangeArrow`), `p95` (`sm`, right, `ChangeArrow`). Default sort `requests` descending. Plus `TopNBars` of the same rows by `requests`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/analysis-load-balancers-report.test.ts`:

```ts
it('sends the sums and the percentile in two separate calls', async () => {
  await loadBalancersReport(target, { range: '12h', nowMs: t }, deps);
  const calls = cw.commandCalls(GetMetricDataCommand).map((c) => c.args[0].input.MetricDataQueries ?? []);
  expect(calls).toHaveLength(2);
  const stats = calls.map((qs) => qs.map((q) => q.MetricStat?.Stat));
  expect(stats.some((s) => s.every((x) => x === 'p95'))).toBe(true);
  expect(stats.some((s) => s.every((x) => x === 'Sum'))).toBe(true);
  // No request mixes a percentile with anything else (moto fact 2).
  expect(stats.every((s) => new Set(s).size === 1 || !s.includes('p95'))).toBe(true);
});

it('computes the error rate from each half separately', async () => {
  // previous half: 1000 requests, 50 errors (5 %); current half: 2000 requests, 20 errors (1 %)
  const result = await loadBalancersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.rows[0].metrics.errorRate).toMatchObject({ current: 1, previous: 5, change: { kind: 'down', ratio: -0.8 } });
});

it('blanks only the p95 column when the percentile call fails', async () => {
  cw.on(GetMetricDataCommand, { MetricDataQueries: [expect.objectContaining({ MetricStat: expect.objectContaining({ Stat: 'p95' }) })] }).rejects(new Error('boom'));
  const result = await loadBalancersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.rows[0].metrics.p95.current).toBeNull();
  expect(result.ok && result.data.rows[0].metrics.requests.current).not.toBeNull();
  expect(result.ok && result.data.headlines.some((h) => h.key === 'latencyUnavailable')).toBe(true);
});

it('says nothing about an error rate below the minimum request count', async () => {
  // 40 requests, 20 of them 5xx: a 50 % rate on 40 requests is noise.
  const result = await loadBalancersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.headlines.find((h) => h.key === 'errors')?.values.count).toBe(0);
});

it('names the busiest load balancer with its share of the region', async () => {
  // api-alb 8000 requests, web-alb 2000
  const result = await loadBalancersReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.headlines[0]).toEqual({ key: 'traffic', values: { loadBalancer: 'api-alb', requests: 8000, total: 10000, share: 80, window: '12h' } });
});
```

- [ ] **Step 2: Run it to see it fail.** Run: `npx vitest run tests/unit/analysis-load-balancers-report.test.ts` → FAIL, module missing.

- [ ] **Step 3: Write the module, the page and the cards.**

- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Reports.loadBalancers.title` | `Load balancers report` | `Rapport répartiteurs` |
| `Reports.loadBalancers.description` | `Traffic, errors and response time across {region} over the window.` | `Trafic, erreurs et temps de réponse dans {region} sur la fenêtre.` |
| `Reports.loadBalancers.cardTitle` | `Load balancers by traffic` | `Répartiteurs par trafic` |
| `Reports.loadBalancers.headline.traffic` | `Over the last {window}, {loadBalancer} handled {share} of the requests ({requests} of {total}).` | `Sur les {window} écoulées, {loadBalancer} a traité {share} des requêtes ({requests} sur {total}).` |
| `Reports.loadBalancers.headline.errors` | `{count, plural, =0 {No load balancer} one {# load balancer} other {# load balancers}} returned more than {threshold} of requests as 5xx.` | `{count, plural, =0 {Aucun répartiteur n'a} one {# répartiteur a} other {# répartiteurs ont}} renvoyé plus de {threshold} des requêtes en 5xx.` |
| `Reports.loadBalancers.headline.latency` | `The slowest p95 response time was {value}, on {loadBalancer}.` | `Le temps de réponse p95 le plus lent était de {value}, sur {loadBalancer}.` |
| `Reports.loadBalancers.headline.latencyUnavailable` | `p95 response time was not available for this window.` | `Le temps de réponse p95 n'était pas disponible sur cette fenêtre.` |
| `Reports.loadBalancers.kpi.requests` | `Requests` | `Requêtes` |
| `Reports.loadBalancers.kpi.errorRate` | `5xx rate` | `Taux de 5xx` |
| `Reports.loadBalancers.kpi.p95` | `Worst p95 response time` | `Pire temps de réponse p95` |
| `Reports.loadBalancers.kpi.covered` | `Load balancers covered` | `Répartiteurs couverts` |
| `Reports.loadBalancers.columns.loadBalancer` | `Load balancer` | `Répartiteur` |
| `Reports.loadBalancers.columns.requests` | `Requests` | `Requêtes` |
| `Reports.loadBalancers.columns.share` | `Share of requests` | `Part des requêtes` |
| `Reports.loadBalancers.columns.target5xx` | `Target 5xx` | `5xx cibles` |
| `Reports.loadBalancers.columns.elb5xx` | `Load balancer 5xx` | `5xx du répartiteur` |
| `Reports.loadBalancers.columns.errorRate` | `5xx rate` | `Taux de 5xx` |
| `Reports.loadBalancers.columns.p95` | `p95 response time` | `Temps de réponse p95` |
| `Reports.loadBalancers.p95Unavailable` | `p95 is unavailable for this window.` | `Le p95 est indisponible sur cette fenêtre.` |
| `Reports.loadBalancers.topLabel` | `Requests by load balancer` | `Requêtes par répartiteur` |
| `Reports.loadBalancers.notCoveredTitle` | `Load balancers not covered` | `Répartiteurs non couverts` |
| `Reports.loadBalancers.empty` | `This region has no application load balancer.` | `Cette région n'a aucun répartiteur de charge applicatif.` |
| `Reports.loadBalancers.tableCaption` | `Load balancers ranked by requests` | `Répartiteurs classés par requêtes` |

- [ ] **Step 5: Write the failing end-to-end test**

```ts
test('the load balancers report ranks by requests and says the p95 is unavailable', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/load-balancers/report`);
  await expect(page.getByText('opswatch-e2e-alb handled', { exact: false })).toBeVisible();
  // moto rejects any request containing a percentile (fact 2), so the p95 call fails and only that column blanks.
  await expect(page.getByText('p95 response time was not available for this window.')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'opswatch-e2e-alb' });
  await expect(row).toContainText('3,600');   // 30 datapoints × 120 requests, from the seed
  await expect(page.getByText('No load balancer returned more than 1% of requests as 5xx.')).toBeVisible();
});

test('the report table sorts on a click and keeps the range', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/load-balancers/report?range=24h`);
  await page.getByRole('link', { name: 'Sort by 5xx rate' }).click();
  await expect(page).toHaveURL(/range=24h/);
  await expect(page).toHaveURL(/sort=errorRate%3Adesc/);
});
```

- [ ] **Step 6: Run everything.** `npx vitest run`, then the e2e command.

- [ ] **Step 7: Verify and commit**

Add `'lib/analysis/load-balancers-report.ts'` to `SERVER_ONLY_MODULES`.
Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`.
Commit: `feat(load-balancers): section report with traffic, 5xx and p95`.

**moto limits:** fact 2 makes the p95 column permanently unavailable in e2e, which the spec above asserts on purpose; real p95 values are unit-tested only. The seed's 30 minutes of datapoints again leave the previous half empty.
**Owner-only verification:** real p95 values and a real 5xx rate; spec §7's "each section report renders over 12 hours".

---

### Task 15: Containers dashboard

Implements spec §9.2 for Containers: the services list page becomes a dashboard whose table is the list that exists today, keeping its search filter and its links, with facets, a status bar, a heat grid, two rankings, headline sentences and the ECS insights around it.

**Files:**
- Create: `src/lib/analysis/containers-dashboard.ts`
- Modify: `src/app/[locale]/(app)/c/[connectionId]/[region]/containers/services/page.tsx`, `…/services/cards.tsx`
- Create: `tests/unit/analysis-containers-dashboard.test.ts`
- Create: `tests/e2e/09-dashboards.spec.ts`
- Modify: `tests/e2e/06-monitoring.spec.ts` (the services list assertions now sit inside a dashboard), `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `listClusters`, `listServices`, `serviceUtilizationQueries`, `serviceTaskCountQueries`, `EcsCluster`, `EcsService`, `MAX_SERVICES` from `@/lib/monitoring/ecs`; `getMetricSeries`, `seriesById`, `latestValue` from `@/lib/monitoring/metrics`; `ecsInsights`, `EcsClusterSignals`, `sortInsights`, `ECS_UTILIZATION_LEVELS`, `INSIGHT_FETCH_MINUTES` from `@/lib/monitoring/insights`; `recentWindow` from `@/lib/monitoring/shared/time-range`; `SectionDashboard`, `DashboardKpi`, `DashboardStatus`, `dashboardRuleContext`, `planQueries`, `sharePercent` from `@/lib/analysis/report`; `cpuBand`, `toneForValue` from `@/lib/monitoring/shared/bands`; `countFacets`, `applyFacets`, `parseFacetSelection` from `@/lib/monitoring/shared/facets`; `parseSort`, `sortRows`, `sortQuery` from `@/lib/monitoring/shared/table-sort`; `DashboardShell`, `FacetsPanel`, `DenseTable`, `HeatGrid`, `TopNBars` from `@/components/analysis/*`.
- Produces (`src/lib/analysis/containers-dashboard.ts`):
  - `export type ServiceRow = { cluster: string; service: EcsService; cpu: number | null; memory: number | null; href: string; state: ServiceState };`
  - `export type ServiceState = 'healthy' | 'deploying' | 'degraded' | 'unreachable';`
  - `export function serviceState(service: EcsService): ServiceState`
  - `export const CONTAINERS_FACETS = ['cluster', 'launchType', 'state', 'cpuBand'] as const;`
  - `export function containersFacetAccessors(): FacetAccessors<ServiceRow>`
  - `export function containersHeadlines(rows: readonly ServiceRow[]): Headline[]`
  - `export function containersDashboard(target: AwsTarget, options: { search: string; nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<{ dashboard: SectionDashboard; rows: ServiceRow[] }>>`

**`serviceState`, decided once** (it drives both the status bar and the `state` facet):
- `unreachable` when `service.status !== 'ACTIVE'`;
- `degraded` when `service.runningCount < service.desiredCount` **and** the primary deployment is not `IN_PROGRESS`;
- `deploying` when the primary deployment's `rolloutState` is `IN_PROGRESS`, or when it is `FAILED` (a failed rollout is still a deployment state and the insight names it);
- `healthy` otherwise.

**The query plan.** Exactly what the list page already spends, plus task counts where Container Insights is on — nothing new per service:

```ts
const queries = clusters.flatMap((cluster, c) => services[c].flatMap((service, s) => {
  const prefix = `c${c}s${s}`;
  return [
    ...serviceUtilizationQueries(cluster.name, service.name, prefix),                                  // cpu, mem
    ...(cluster.containerInsights ? serviceTaskCountQueries(cluster.name, service.name, prefix) : []), // running, desired
  ];
}));
```
`planQueries(services, 4)` against the 300 budget, so the dashboard covers 75 services; the excluded become `notCovered(name, 'cap')`. The window is `recentWindow(INSIGHT_FETCH_MINUTES, nowMs)` — the **same** window the Overview uses, so the two pages share their cache entries and never disagree (that is also why `dashboardRuleContext` carries no `windowMinutes`). The KPI values are `latestValue` of each series; the heat grid colours by the same CPU value.

**KPI tiles** (spec §9.2): `services` (count of covered services), `tasks` (`Σ runningCount` against `Σ desiredCount`, rendered through `Dashboards.containers.kpi.tasksValue`), `saturated` (services whose CPU exceeds `ECS_UTILIZATION_LEVELS.warning.threshold`, toned `danger` when > 0), `deploying` (services whose state is `deploying`).

**Status bar:** one segment per `ServiceState` with counts, tones `success`, `info`, `warning`, `danger`, and `hrefQuery` setting `?state=<state>` so clicking filters the table through the `state` facet.

**Headlines** (spec §9.3, three sentences): `busiest` (the service with the highest CPU and its value), `saturated` (how many are above the threshold), `deployments` (how many deployments are in progress, or that none are).

**Facets:** `cluster` (the cluster name), `launchType` (`service.launchType ?? 'UNKNOWN'` — `UNKNOWN` is an AWS-shaped token and is labelled through `Dashboards.containers.facet.launchTypeUnknown`), `state` (the `ServiceState`), `cpuBand` (`cpuBand(row.cpu)`). Counts always come from the **unfiltered** rows; `applyFacets` then filters what the table shows, and the "showing X of Y" line reports both.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/analysis-containers-dashboard.test.ts`:

```ts
describe('serviceState', () => {
  it('classifies a service from its counts and its rollout', () => {
    expect(serviceState({ ...svc, status: 'DRAINING' })).toBe('unreachable');
    expect(serviceState({ ...svc, runningCount: 1, desiredCount: 2, primaryDeployment: null })).toBe('degraded');
    expect(serviceState({ ...svc, runningCount: 1, desiredCount: 2, primaryDeployment: { ...dep, rolloutState: 'IN_PROGRESS' } })).toBe('deploying');
    expect(serviceState({ ...svc, primaryDeployment: { ...dep, rolloutState: 'FAILED' } })).toBe('deploying');
    expect(serviceState({ ...svc, runningCount: 2, desiredCount: 2, primaryDeployment: { ...dep, rolloutState: 'COMPLETED' } })).toBe('healthy');
  });
});

describe('containersFacetAccessors', () => {
  it('counts clusters, launch types, states and CPU bands over the unfiltered rows', () => {
    const rows = [row('prod', 'web', 'FARGATE', 92), row('prod', 'api', 'FARGATE', 12), row('staging', 'web', null, null)];
    expect(countFacets(rows, containersFacetAccessors())).toEqual([
      { id: 'cluster', values: [{ value: 'prod', count: 2 }, { value: 'staging', count: 1 }] },
      { id: 'launchType', values: [{ value: 'FARGATE', count: 2 }, { value: 'UNKNOWN', count: 1 }] },
      { id: 'state', values: [{ value: 'healthy', count: 3 }] },
      { id: 'cpuBand', values: [{ value: 'high', count: 1 }, { value: 'low', count: 1 }, { value: 'unknown', count: 1 }] },
    ]);
  });
});

describe('containersHeadlines', () => {
  it('names the busiest service, counts the saturated ones and the deployments', () => {
    const rows = [row('prod', 'web', 'FARGATE', 92), row('prod', 'api', 'FARGATE', 12)];
    expect(containersHeadlines(rows)).toEqual([
      { key: 'busiest', values: { service: 'web', cpu: 92 } },
      { key: 'saturated', values: { count: 1, threshold: 85 } },
      { key: 'deployments', values: { count: 0 } },
    ]);
  });
  it('says nothing about a busiest service when no CPU value came back', () => {
    expect(containersHeadlines([row('prod', 'web', 'FARGATE', null)]).map((h) => h.key)).toEqual(['saturated', 'deployments']);
  });
  it('returns nothing at all for an empty region', () => {
    expect(containersHeadlines([])).toEqual([]);
  });
});

describe('containersDashboard', () => {
  it('spends the same four queries per service the list already spent, over the Overview window', async () => {
    const result = await containersDashboard(target, { search: '', nowMs: t }, deps);
    const call = cw.commandCalls(GetMetricDataCommand)[0].args[0].input;
    expect(call.StartTime).toEqual(new Date(t - 20 * 60_000 - (t % 60_000)));  // recentWindow(20, t)
    expect(call.MetricDataQueries).toHaveLength(4);   // one cluster with Container Insights, one service
    expect(result.ok && result.data.dashboard.kpis.map((k) => k.id)).toEqual(['services', 'tasks', 'saturated', 'deploying']);
  });

  it('builds a status bar whose counts add up to the covered services', async () => {
    const result = await containersDashboard(target, { search: '', nowMs: t }, deps);
    const status = result.ok ? result.data.dashboard.status : [];
    expect(status.reduce((n, s) => n + s.count, 0)).toBe(result.ok ? result.data.rows.length : -1);
    expect(status.map((s) => s.key)).toEqual(['healthy', 'deploying', 'degraded', 'unreachable']);
    expect(status.find((s) => s.key === 'degraded')?.hrefQuery).toBe('state=degraded');
  });

  it('fires the live insight rules, not a widened window', async () => {
    const result = await containersDashboard(target, { search: '', nowMs: t }, deps);
    expect(result.ok && result.data.dashboard.insights.map((i) => i.kind)).toContain('ecs_cpu_high');
  });

  it('caps at 75 services and reports the rest', async () => {
    const result = await containersDashboard(target, { search: '', nowMs: t }, deps);   // 80 seeded
    expect(result.ok && result.data.dashboard.coverage).toEqual({ covered: 75, total: 80, truncated: true });
  });

  it('keeps the search filter of the list page', async () => {
    await containersDashboard(target, { search: 'api', nowMs: t }, deps);
    expect(ecs.commandCalls(DescribeServicesCommand).flatMap((c) => c.args[0].input.services ?? [])).toEqual(['api']);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `npx vitest run tests/unit/analysis-containers-dashboard.test.ts` → module missing.

- [ ] **Step 3: Write `containers-dashboard.ts`, then rebuild the page**

The page keeps `initMonitoringRoute` first, keeps reading `q` for the search, adds `parseFacetSelection(sp, CONTAINERS_FACETS)` and `parseSort(sp.sort, …, { column: 'cpu', direction: 'desc' })`, and calls `pageNow()` once. It renders `SectionLayout` (section `containers`, subsection `services`, `range` **kept exactly as the Stage 2 list page had it**, `autoRefresh` stays `true`) with `filters` holding the existing search `<form>` and the `FacetsPanel`. Inside, `DashboardShell` receives `figures={<SuspenseCard…><HeatGrid …/></SuspenseCard>}`, `topN` with two `TopNBars` (by CPU and by memory, ten rows each), and `table` with the `DenseTable` built from the filtered, sorted rows. The existing per-service links (`subsectionPath(scope, 'containers', 'services', cluster, name)`) are unchanged, `?range=` and all.

**What the range does on a dashboard, decided once for all six.** The KPI tiles, the status bar, the heat grid, the rankings and the insights always read `recentWindow(INSIGHT_FETCH_MINUTES, nowMs)` — the live window the Overview uses — so a dashboard and the Overview can never disagree about a resource, and the cache is shared. The `range` in the URL keeps doing exactly what it did in Stage 2: it feeds the table's sparklines and rides along on every per-resource link into the detail page. The one exception is the Logs volume dashboard (Task 22), whose subject *is* a window, so there the range drives the data. `Dashboards.rangeNote` states this on each dashboard so the selector is not misread.

**Keep working what already works:** the search input, its `SEARCH_MAX` bound, the per-service link, the cluster grouping in the table (as a `cluster` column plus the `cluster` facet, which replaces the old per-cluster `<section>` split), and the `FailureNotice` on a denied call.

- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Dashboards.containers.title` | `Containers` | `Conteneurs` |
| `Dashboards.containers.description` | `Every ECS service of {connection} in {region}.` | `Tous les services ECS de {connection} dans {region}.` |
| `Dashboards.containers.headline.busiest` | `{service} is using the most CPU right now, at {cpu}.` | `{service} consomme actuellement le plus de CPU, à {cpu}.` |
| `Dashboards.containers.headline.saturated` | `{count, plural, =0 {No service is} one {# service is} other {# services are}} above {threshold} CPU.` | `{count, plural, =0 {Aucun service n'est} one {# service est} other {# services sont}} au-dessus de {threshold} de CPU.` |
| `Dashboards.containers.headline.deployments` | `{count, plural, =0 {No deployment is} one {# deployment is} other {# deployments are}} in progress.` | `{count, plural, =0 {Aucun déploiement n'est} one {# déploiement est} other {# déploiements sont}} en cours.` |
| `Dashboards.containers.kpi.services` | `Services` | `Services` |
| `Dashboards.containers.kpi.tasks` | `Running tasks` | `Tâches en cours` |
| `Dashboards.containers.kpi.tasksValue` | `{running} of {desired}` | `{running} sur {desired}` |
| `Dashboards.containers.kpi.saturated` | `Above {threshold} CPU` | `Au-dessus de {threshold} de CPU` |
| `Dashboards.containers.kpi.deploying` | `Deployments in progress` | `Déploiements en cours` |
| `Dashboards.containers.state.healthy` | `{count} healthy` | `{count} sains` |
| `Dashboards.containers.state.deploying` | `{count} deploying` | `{count} en déploiement` |
| `Dashboards.containers.state.degraded` | `{count} degraded` | `{count} dégradés` |
| `Dashboards.containers.state.unreachable` | `{count} unreachable` | `{count} injoignables` |
| `Dashboards.containers.facet.cluster` | `Cluster` | `Cluster` |
| `Dashboards.containers.facet.launchType` | `Launch type` | `Type de lancement` |
| `Dashboards.containers.facet.launchTypeUnknown` | `Not reported` | `Non renseigné` |
| `Dashboards.containers.facet.state` | `State` | `État` |
| `Dashboards.containers.facet.cpuBand` | `CPU` | `CPU` |
| `Dashboards.containers.band.idle` | `Under 10%` | `Moins de 10 %` |
| `Dashboards.containers.band.low` | `10% to 50%` | `10 % à 50 %` |
| `Dashboards.containers.band.medium` | `50% to 85%` | `50 % à 85 %` |
| `Dashboards.containers.band.high` | `Above 85%` | `Au-dessus de 85 %` |
| `Dashboards.containers.band.unknown` | `No data` | `Aucune donnée` |
| `Dashboards.containers.heatLabel` | `Every service by CPU` | `Chaque service par CPU` |
| `Dashboards.containers.topCpu` | `Top ten by CPU` | `Top dix par CPU` |
| `Dashboards.containers.topMemory` | `Top ten by memory` | `Top dix par mémoire` |
| `Dashboards.containers.notCoveredTitle` | `Services not covered` | `Services non couverts` |

- [ ] **Step 5: Write the failing end-to-end test**

Create `tests/e2e/09-dashboards.spec.ts`:

```ts
test('the containers dashboard shows headlines, tiles, a state bar, a heat grid, rankings and the services table', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/containers/services`);
  await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What stands out' })).toContainText('is using the most CPU right now');
  await expect(page.getByRole('region', { name: 'Key figures' })).toContainText('Services');
  // moto reports runningCount 0 and pendingCount = desired (fact 6), so the seeded service is degraded.
  await expect(page.getByRole('img', { name: 'Resources by state' })).toContainText('degraded');
  await expect(page.getByRole('list', { name: 'Every service by CPU' })).toBeVisible();
  await expect(page.getByText('Top ten by CPU')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'web' })).toContainText('opswatch-e2e');
  await expect(page.getByRole('link', { name: 'web' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/containers/services/opswatch-e2e/web`);
});

test('a facet filters the table, keeps the counts of the whole set and stays in the URL', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/containers/services`);
  const facets = page.getByRole('navigation', { name: 'Filters' });
  await expect(facets).toContainText('opswatch-e2e');
  await facets.getByRole('link', { name: /opswatch-e2e/ }).click();
  await expect(page).toHaveURL(/cluster=opswatch-e2e/);
  await expect(page.getByText('Showing 1 of 1')).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/cluster=/);
});

test('the search filter of the old list still works inside the dashboard', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/containers/services`);
  await page.getByLabel('Service name').fill('nothing-matches');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=nothing-matches/);
  await expect(page.getByText('Showing 0 of 0')).toBeVisible();
});

test('the state bar filters the table', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/containers/services`);
  await page.getByRole('img', { name: 'Resources by state' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/state=/);
});
```

- [ ] **Step 6: Run everything.** `npx vitest run`, then `docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e; docker compose -f docker-compose.test.yml down -v`. Expected: all pass, including the updated `06-monitoring.spec.ts`.

- [ ] **Step 7: Verify and commit**

Add `'lib/analysis/containers-dashboard.ts'` to `SERVER_ONLY_MODULES`.
Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip` (`facets.ts`, `table-sort.ts`, `bands.ts`, `facets-panel.tsx`, `status-bar.tsx`, `heat-grid.tsx`, `kpi-tile.tsx` are now all imported).
Commit: `feat(containers): turn the services list into a category dashboard`.

**moto limits:** fact 6 fixes the seeded service at `runningCount: 0`, `pendingCount: 2`, `rolloutState: IN_PROGRESS`, so the dashboard shows it as `deploying` and the "running tasks" tile reads `0 of 2`; the `degraded` and `unreachable` segments are unit-tested only. There is one cluster and one service, so the heat grid and the rankings each hold a single entry — their layout at scale is checked on the scratch page of Task 7 and on the owner's account.
**Owner-only verification:** that the dashboard's density and ordering read like the Datadog screens they showed, with a real fleet in the heat grid.

---

### Task 16: Load balancers dashboard

Implements spec §9.2 for Load balancers: the list page becomes a dashboard with requests, error rate, p95 and unhealthy hosts as tiles, a requests-and-errors chart, a ranking of target groups by errors, the existing table and the ALB insights.

**Files:**
- Create: `src/lib/analysis/load-balancers-dashboard.ts`
- Modify: `src/app/[locale]/(app)/c/[connectionId]/[region]/load-balancers/list/page.tsx`, `…/list/cards.tsx`
- Create: `tests/unit/analysis-load-balancers-dashboard.test.ts`
- Modify: `tests/e2e/09-dashboards.spec.ts`, `tests/e2e/06-monitoring.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `listLoadBalancers`, `listTargetGroups`, `describeTargetGroups`, `targetHealth`, `summarizeTargetGroupHealth`, `loadBalancerQueries`, `loadBalancerLatencyQuery`, `targetGroupQueries`, `loadBalancerDimension`, `targetGroupDimension`, `MAX_TARGET_GROUPS_WITH_HEALTH` from `@/lib/monitoring/elb`; `albInsights`, `AlbSignals`, `ALB_5XX_RATE_LEVELS`, `ALB_MIN_REQUESTS` from `@/lib/monitoring/insights`; the Task 12 engine; `MetricChart`, `TopNBars`, `DashboardShell`, `FacetsPanel`, `DenseTable` from the components.
- Produces (`src/lib/analysis/load-balancers-dashboard.ts`):
  - `export type LbRow = { loadBalancer: LoadBalancer; requests: number | null; errorRate: number | null; p95: number | null; healthy: number; unhealthy: number; incomplete: boolean; href: string };`
  - `export type TargetGroupErrorRow = { name: string; loadBalancer: string; errors: number; requests: number | null; href: string };`
  - `export const LOAD_BALANCER_FACETS = ['scheme', 'state'] as const;`
  - `export function loadBalancerFacetAccessors(): FacetAccessors<LbRow>`
  - `export function loadBalancersHeadlines(rows: readonly LbRow[], groups: readonly TargetGroupErrorRow[]): Headline[]`
  - `export function loadBalancersDashboard(target: AwsTarget, options: { nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<{ dashboard: SectionDashboard; rows: LbRow[]; topGroups: TargetGroupErrorRow[]; series: { requests: SeriesData; errors: SeriesData } }>>`

**The query plan.** Three calls, the third holding only percentiles:
1. `loadBalancerQueries` per load balancer (3 each: `RequestCount` Sum, `HTTPCode_ELB_5XX_Count` Sum, `HTTPCode_Target_5XX_Count` Sum).
2. `targetGroupQueries` per attached target group (4 each: requests, target 5xx, healthy hosts, unhealthy hosts) — this is what feeds both the unhealthy-hosts tile and the "top target groups by errors" ranking.
3. `loadBalancerLatencyQuery` per load balancer, alone (`p95`).

`planQueries` is applied twice against one shared budget: `planQueries(loadBalancers, 4)` first (3 + 1 percentile), then `planQueries(groups, 4)` against **the remainder** — write an explicit `remainingBudget = REPORT_METRIC_QUERY_CAP - lbQueryCount` and call `capResources(groups, 4, remainingBudget)`, so the two plans can never overrun the 300 together. Target health (`DescribeTargetHealth`) stays capped at `MAX_TARGET_GROUPS_WITH_HEALTH` exactly as the Stage 2 page does, and `summarizeTargetGroupHealth` still marks an incomplete summary.

The window is `recentWindow(INSIGHT_FETCH_MINUTES, nowMs)`, shared with the Overview.

**KPI tiles:** `requests` (`Σ RequestCount` over the window, `count`), `errorRate` (`sharePercent(Σ elb5xx + Σ target5xx, Σ requests)`, `percent`, toned by `ALB_5XX_RATE_LEVELS`, shown as `NO_VALUE` when total requests are under `ALB_MIN_REQUESTS`), `p95` (the worst p95 across load balancers, `seconds`, or the unavailable message), `unhealthy` (`Σ unhealthy` from the health summaries, `count`, toned `danger` when > 0, with `Dashboards.loadBalancers.kpi.unhealthyIncomplete` appended when any summary is `incomplete`).

**Status bar:** by `loadBalancer.state` (`active`, `provisioning`, `active_impaired`, `failed`), tones `success`, `info`, `warning`, `danger`, unknown states falling into a fifth `other` segment toned `info`. AWS state codes are not translated; the segment label is `Dashboards.loadBalancers.state.<code>` with a `Dashboards.loadBalancers.state.other` fallback that takes `{state}`.

**Figures:** one `MetricChart` with two series — requests (`count`) and 5xx (`count`) summed across the covered load balancers — so a spike in errors is visible against traffic. No threshold bands (a request count has no threshold); the error-rate tile carries the tone instead.

**Ranking:** `TopNBars` of the ten target groups with the most `HTTPCode_Target_5XX_Count`, each linking to its load balancer's detail page.

**Facets:** `scheme` (`internet-facing` / `internal`, `null` → `'unknown'`) and `state`.
**The range** behaves as Task 15 fixed it for every dashboard: the tiles, bar, chart and ranking read the live window, and `?range=` keeps feeding the table trends and the detail links.

**The table** is the existing load balancers list, unchanged in its columns and links, wrapped in `DenseTable` with sortable numeric columns.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/analysis-load-balancers-dashboard.test.ts`:

```ts
it('sends the sums, the target-group queries and the percentiles in three calls, percentiles alone', async () => {
  await loadBalancersDashboard(target, { nowMs: t }, deps);
  const stats = cw.commandCalls(GetMetricDataCommand).map((c) => (c.args[0].input.MetricDataQueries ?? []).map((q) => q.MetricStat?.Stat));
  expect(stats).toHaveLength(3);
  const percentileCalls = stats.filter((s) => s.includes('p95'));
  expect(percentileCalls).toHaveLength(1);
  expect(percentileCalls[0].every((x) => x === 'p95')).toBe(true);
});

it('never plans more than 300 metric queries across both plans', async () => {
  // 100 load balancers, 200 target groups
  await loadBalancersDashboard(target, { nowMs: t }, deps);
  const total = cw.commandCalls(GetMetricDataCommand).reduce((n, c) => n + (c.args[0].input.MetricDataQueries?.length ?? 0), 0);
  expect(total).toBeLessThanOrEqual(300);
});

it('blanks the error-rate tile below the minimum request count', async () => {
  // 40 requests, 20 of them 5xx
  const result = await loadBalancersDashboard(target, { nowMs: t }, deps);
  expect(result.ok && result.data.dashboard.kpis.find((k) => k.id === 'errorRate')?.value).toBeNull();
});

it('marks the unhealthy tile incomplete when a target-group health call failed', async () => {
  elb.on(DescribeTargetHealthCommand).rejects(Object.assign(new Error('no'), { name: 'ThrottlingException' }));
  const result = await loadBalancersDashboard(target, { nowMs: t }, deps);
  expect(result.ok && result.data.rows[0].incomplete).toBe(true);
});

it('ranks target groups by target 5xx and links each to its load balancer', async () => {
  const result = await loadBalancersDashboard(target, { nowMs: t }, deps);
  expect(result.ok && result.data.topGroups[0]).toMatchObject({ name: 'api-tg', errors: 120, href: '/c/abc123def456/eu-west-1/load-balancers/list/api-alb' });
});

it('groups unknown load balancer states into one segment', async () => {
  const result = await loadBalancersDashboard(target, { nowMs: t }, deps);   // one state 'weird'
  expect(result.ok && result.data.dashboard.status.find((s) => s.key === 'other')?.count).toBe(1);
});
```

- [ ] **Step 2: Run it to see it fail.**

- [ ] **Step 3: Write the module and rebuild the page.**

- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Dashboards.loadBalancers.title` | `Load balancers` | `Répartiteurs de charge` |
| `Dashboards.loadBalancers.description` | `Traffic and health of the application load balancers of {region}.` | `Trafic et santé des répartiteurs de charge applicatifs de {region}.` |
| `Dashboards.loadBalancers.headline.busiest` | `{loadBalancer} is taking {share} of the requests right now.` | `{loadBalancer} reçoit actuellement {share} des requêtes.` |
| `Dashboards.loadBalancers.headline.errors` | `{count, plural, =0 {No load balancer is} one {# load balancer is} other {# load balancers are}} returning more than {threshold} of requests as 5xx.` | `{count, plural, =0 {Aucun répartiteur ne renvoie} one {# répartiteur renvoie} other {# répartiteurs renvoient}} plus de {threshold} des requêtes en 5xx.` |
| `Dashboards.loadBalancers.headline.unhealthy` | `{count, plural, =0 {Every target is healthy} one {# target is unhealthy} other {# targets are unhealthy}}{group, select, none {.} other { — the worst is {group}.}}` | `{count, plural, =0 {Toutes les cibles sont saines} one {# cible est défaillante} other {# cibles sont défaillantes}}{group, select, none {.} other { — la pire est {group}.}}` |
| `Dashboards.loadBalancers.kpi.requests` | `Requests` | `Requêtes` |
| `Dashboards.loadBalancers.kpi.errorRate` | `5xx rate` | `Taux de 5xx` |
| `Dashboards.loadBalancers.kpi.p95` | `p95 response time` | `Temps de réponse p95` |
| `Dashboards.loadBalancers.kpi.unhealthy` | `Unhealthy targets` | `Cibles défaillantes` |
| `Dashboards.loadBalancers.kpi.unhealthyIncomplete` | `Partial: a health check could not be read.` | `Partiel : un contrôle de santé n'a pas pu être lu.` |
| `Dashboards.loadBalancers.state.active` | `{count} active` | `{count} actifs` |
| `Dashboards.loadBalancers.state.provisioning` | `{count} provisioning` | `{count} en création` |
| `Dashboards.loadBalancers.state.active_impaired` | `{count} impaired` | `{count} dégradés` |
| `Dashboards.loadBalancers.state.failed` | `{count} failed` | `{count} en échec` |
| `Dashboards.loadBalancers.state.other` | `{count} in state {state}` | `{count} à l'état {state}` |
| `Dashboards.loadBalancers.facet.scheme` | `Scheme` | `Exposition` |
| `Dashboards.loadBalancers.facet.schemeUnknown` | `Not reported` | `Non renseigné` |
| `Dashboards.loadBalancers.facet.state` | `State` | `État` |
| `Dashboards.loadBalancers.chartLabel` | `Requests and 5xx errors` | `Requêtes et erreurs 5xx` |
| `Dashboards.loadBalancers.chartRequests` | `Requests` | `Requêtes` |
| `Dashboards.loadBalancers.chartErrors` | `5xx errors` | `Erreurs 5xx` |
| `Dashboards.loadBalancers.topGroups` | `Target groups with the most 5xx` | `Groupes cibles avec le plus de 5xx` |
| `Dashboards.loadBalancers.notCoveredTitle` | `Load balancers not covered` | `Répartiteurs non couverts` |

- [ ] **Step 5: Write the failing end-to-end test**

Add to `tests/e2e/09-dashboards.spec.ts`:

```ts
test('the load balancers dashboard shows traffic, an unavailable p95 and the target group ranking', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/load-balancers/list`);
  await expect(page.getByRole('region', { name: 'Key figures' })).toContainText('Requests');
  await expect(page.getByRole('region', { name: 'Key figures' })).toContainText('p95 response time');
  // moto rejects percentiles (fact 2): only the p95 tile is blank.
  await expect(page.getByRole('img', { name: 'Resources by state' })).toContainText('active');
  await expect(page.getByText('Target groups with the most 5xx')).toBeVisible();
  await expect(page.getByRole('link', { name: 'opswatch-e2e-alb' }))
    .toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/load-balancers/list/opswatch-e2e-alb`);
});

test('the scheme facet filters the load balancers table', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/load-balancers/list`);
  await page.getByRole('navigation', { name: 'Filters' }).getByRole('link', { name: /internal|internet-facing/ }).first().click();
  await expect(page).toHaveURL(/scheme=/);
  await expect(page.getByText(/Showing \d+ of \d+/)).toBeVisible();
});
```

- [ ] **Step 6: Run everything.** `npx vitest run`, then the full e2e command.

- [ ] **Step 7: Verify and commit**

Add `'lib/analysis/load-balancers-dashboard.ts'` to `SERVER_ONLY_MODULES`.
Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`.
Commit: `feat(load-balancers): turn the list into a category dashboard`.

**moto limits:** fact 2 leaves the p95 tile permanently blank in e2e. The seed has one load balancer and one target group with one healthy target, so the unhealthy tile reads 0 and the status bar has a single `active` segment; the impaired, failed and `other` segments are unit-tested only.
**Owner-only verification:** a real 5xx rate, a real p95 and a real unhealthy-hosts count.

---

### Task 17: Phase 2 checkpoint

- [ ] **Step 1: Run every verification command.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and the full e2e suite. Record the unit-test count and the e2e count; the e2e suite now has `08-analysis.spec.ts` and `09-dashboards.spec.ts` on top of Stage 2's seven files.

- [ ] **Step 2: Check the query budget by hand.** For each of the four pages this phase built (Containers dashboard, Containers report, Load balancers dashboard, Load balancers report), add a temporary `console.log` of the number of `MetricDataQueries` sent per render — or better, assert it in the existing unit tests, which already do for three of the four. Confirm no page can exceed 300 and that the Queries page sends at most one Performance Insights call per instance. Remove any temporary logging.

- [ ] **Step 3: Check EN/FR parity** with the node one-liner from Task 7 step 2. Expected: equal counts, two empty arrays.

- [ ] **Step 4: Settle knip.** `npx knip`. Expected: the Phase 1 list has shrunk to `markdown.ts`, `report-shell.tsx` (if no report page imported it yet — it should be imported by Tasks 13 and 14, so it must be gone), and nothing else. Anything still unused must be claimed by a named Phase 3 task or deleted.

- [ ] **Step 5: Walk the navigation at three widths.** With `npm run dev`, at 360 px, 768 px and 1440 px, in both themes and both locales: open each of the six sections, confirm the section root redirects to the dashboard, the section menu lists the sub-pages and marks the active one, both menus collapse and their state survives a reload, the breadcrumb reads section › connection › sub-page, and no page scrolls horizontally at 360 px. Confirm the French pages have no English left in them.

- [ ] **Step 6: Write the checkpoint report and commit.** Record the counts, the budget numbers, the knip list, anything fixed.
Commit: `chore(analysis): phase 2 checkpoint — navigation, queries, first reports and dashboards`.

**moto limits:** the e2e gaps accumulated so far are Performance Insights entirely, p95 values, ECS running tasks and failed or stuck rollouts. List them in the report.
**Owner-only verification:** this is the natural point to show the owner the new navigation and the two dashboards before Phase 3 repeats the pattern four more times.

---

## Phase 3 — The remaining dashboards and reports, the Logs pages, and the audit last

### Task 18: Databases report

Implements spec §3 for Databases with amendment 8's first bullet: **connections against the class maximum is dropped** (the real limit lives in a parameter group we cannot read), and the report shows **peak connections** (`Maximum`, not `Average`) instead.

**Files:**
- Create: `src/lib/analysis/databases-report.ts`, `src/app/[locale]/(app)/c/[connectionId]/[region]/databases/report/page.tsx`, `…/report/cards.tsx`
- Create: `tests/unit/analysis-databases-report.test.ts`
- Modify: `tests/e2e/08-analysis.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `listDatabases`, `rdsMetricQueries`, `RdsInstance`, `RdsMetric`, `RDS_METRIC_UNITS` from `@/lib/monitoring/rds`; `instanceMemoryGiB` from `@/lib/monitoring/instance-memory`; `rdsInsights`, `RdsInstanceSignals`, `RDS_CPU_LEVELS`, `FREEABLE_MEMORY_LEVELS` from `@/lib/monitoring/insights`; `GIB` from `@/lib/monitoring/shared/format`; the Task 12 engine.
- Produces: `export const DATABASES_REPORT_METRICS = ['cpuAvg', 'connectionsMax', 'freeableMemoryAvg', 'dbLoadAvg'] as const;` and `export function databasesReport(target: AwsTarget, options: { range: ReportRange; nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<SectionReport>>`.

**The query plan.** Four `AWS/RDS` queries per instance, all in one call over the double window, dimension `{ DBInstanceIdentifier: id }`:

| id suffix | metric | stat | why |
|---|---|---|---|
| `cpuAvg` | `CPUUtilization` | `Average` | the ranking metric |
| `connectionsMax` | `DatabaseConnections` | `Maximum` | amendment 8: peak, because there is no readable maximum to compare against |
| `freeableMemoryAvg` | `FreeableMemory` | `Average` | turned into a percentage only when `instanceMemoryGiB(instanceClass)` is known |
| `dbLoadAvg` | `DBLoad` | `Average` | published to CloudWatch only when Performance Insights is on; requested **only** for instances where `performanceInsights === true`, so a blind instance costs three queries, not four |

`planQueries(instances, 4)` caps the fleet at 75 instances. `DBLoad` carries **no comparison arrow** is not the rule here — `DBLoad` is a CloudWatch metric and does come from the same double-window call, so it does get a change; amendment 6's "the Performance Insights column carries no comparison arrow" applies to the *Performance Insights* column (`DescribeDimensionKeys`), which this report does not call at all. State that in a comment so nobody removes the arrow.

Instances whose `instanceClass` is missing from the memory table go into the "not covered" list with reason `unknown_class` (amendment 8's last bullet) and their freeable-memory percentage column reads `NO_VALUE`; their CPU and connections are still reported.

**Headlines:** `cpu` (count of instances above `RDS_CPU_LEVELS.warning.threshold` = 80), `connections` (the instance with the highest peak connections and its value), `load` (the instance with the highest `dbLoadAvg`, or `loadUnavailable` when no instance has Performance Insights).

**KPI tiles:** instances covered, highest average CPU (toned), highest peak connections, highest database load.

**The table:** `instance` (`always`, link to the instance page), `cluster` (`md`), `role` (`sm`), `class` (`lg`), `cpuAvg` (`always`, toned, `ChangeArrow`), `connectionsMax` (`sm`, `ChangeArrow`), `freeableMemoryPercent` (`md`, toned), `dbLoadAvg` (`sm`, `ChangeArrow`). Default sort `cpuAvg` descending. Plus `TopNBars` by `cpuAvg`.

- [ ] **Step 1: Write the failing unit test**

```ts
it('asks for four statistics per instance, and only three where Performance Insights is off', async () => {
  // db-pi has PerformanceInsightsEnabled true, db-plain false
  await databasesReport(target, { range: '12h', nowMs: t }, deps);
  const qs = cw.commandCalls(GetMetricDataCommand)[0].args[0].input.MetricDataQueries ?? [];
  expect(qs).toHaveLength(7);
  expect(qs.filter((q) => q.MetricStat?.Metric?.MetricName === 'DBLoad')).toHaveLength(1);
  expect(qs.find((q) => q.MetricStat?.Metric?.MetricName === 'DatabaseConnections')?.MetricStat?.Stat).toBe('Maximum');
});

it('turns freeable memory into a share of the class memory, and skips an unknown class', async () => {
  // db-known is db.t3.medium (4 GiB), db-weird is db.x9.nano
  const result = await databasesReport(target, { range: '12h', nowMs: t }, deps);
  const known = result.ok ? result.data.rows.find((r) => r.id === 'db-known') : undefined;
  expect(known?.metrics.freeableMemoryPercent.current).toBeCloseTo(25, 5);   // 1 GiB free of 4 GiB
  expect(result.ok && result.data.rows.find((r) => r.id === 'db-weird')?.metrics.freeableMemoryPercent.current).toBeNull();
  expect(result.ok && result.data.notCovered).toContainEqual({ resource: 'db-weird', reason: 'unknown_class', code: null, action: null });
});

it('never claims a connection limit it cannot read', async () => {
  const result = await databasesReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && Object.keys(result.data.rows[0].metrics)).not.toContain('connectionsPercent');
  expect(result.ok && result.data.rows[0].metrics.connectionsMax.unit).toBe('count');
});

it('says the database load is unavailable when no instance has Performance Insights', async () => {
  const result = await databasesReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.headlines.some((h) => h.key === 'loadUnavailable')).toBe(true);
});

it('gives the database load column a change arrow, because it comes from CloudWatch', async () => {
  const result = await databasesReport(target, { range: '12h', nowMs: t }, deps);
  expect(result.ok && result.data.rows[0].metrics.dbLoadAvg.change.kind).not.toBe('unavailable');
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write the module, the page and the cards.**
- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Reports.databases.title` | `Databases report` | `Rapport bases de données` |
| `Reports.databases.description` | `What the RDS and Aurora instances of {region} did over the window.` | `Ce qu'ont fait les instances RDS et Aurora de {region} sur la fenêtre.` |
| `Reports.databases.cardTitle` | `Instances by load` | `Instances par charge` |
| `Reports.databases.headline.cpu` | `Over the last {window}, {count, plural, =0 {no instance} one {# instance} other {# instances}} averaged more than {threshold} CPU.` | `Sur les {window} écoulées, {count, plural, =0 {aucune instance n'a} one {# instance a} other {# instances ont}} dépassé {threshold} de CPU en moyenne.` |
| `Reports.databases.headline.connections` | `{instance} reached the most connections: {value} at peak.` | `{instance} a atteint le plus de connexions : {value} au pic.` |
| `Reports.databases.headline.load` | `{instance} carried the most database load: {value} average active sessions.` | `{instance} a porté la plus forte charge : {value} sessions actives en moyenne.` |
| `Reports.databases.headline.loadUnavailable` | `Database load is unavailable: no instance in this region has Performance Insights enabled.` | `La charge de base de données est indisponible : aucune instance de cette région n'a Performance Insights activé.` |
| `Reports.databases.kpi.instances` | `Instances covered` | `Instances couvertes` |
| `Reports.databases.kpi.cpu` | `Highest average CPU` | `CPU moyen le plus élevé` |
| `Reports.databases.kpi.connections` | `Highest peak connections` | `Pic de connexions le plus élevé` |
| `Reports.databases.kpi.load` | `Highest database load` | `Charge de base de données la plus élevée` |
| `Reports.databases.columns.instance` | `Instance` | `Instance` |
| `Reports.databases.columns.cluster` | `Cluster` | `Cluster` |
| `Reports.databases.columns.role` | `Role` | `Rôle` |
| `Reports.databases.columns.class` | `Class` | `Classe` |
| `Reports.databases.columns.cpuAvg` | `CPU, average` | `CPU, moyenne` |
| `Reports.databases.columns.connectionsMax` | `Connections, peak` | `Connexions, pic` |
| `Reports.databases.columns.freeableMemoryPercent` | `Memory free` | `Mémoire libre` |
| `Reports.databases.columns.dbLoadAvg` | `Database load` | `Charge` |
| `Reports.databases.connectionsNote` | `Peak connections, not a percentage: the connection limit lives in a parameter group OpsWatch cannot read.` | `Pic de connexions, pas un pourcentage : la limite de connexions se trouve dans un groupe de paramètres qu'OpsWatch ne peut pas lire.` |
| `Reports.databases.topLabel` | `Instances by average CPU` | `Instances par CPU moyen` |
| `Reports.databases.notCoveredTitle` | `Instances not covered` | `Instances non couvertes` |
| `Reports.databases.empty` | `This region has no RDS or Aurora instance.` | `Cette région n'a aucune instance RDS ou Aurora.` |
| `Reports.databases.tableCaption` | `Database instances ranked by average CPU` | `Instances classées par CPU moyen` |

- [ ] **Step 5: Write the failing end-to-end test**

```ts
test('the databases report ranks instances and states why there is no connection percentage', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/report`);
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-db' })).toBeVisible();
  await expect(page.getByText('Peak connections, not a percentage', { exact: false })).toBeVisible();
  // moto never reports PerformanceInsightsEnabled (fact 7), so DBLoad is never requested.
  await expect(page.getByText('Database load is unavailable', { exact: false })).toBeVisible();
});
```

- [ ] **Step 6: Run everything.** `npx vitest run`, then the e2e command.
- [ ] **Step 7: Verify and commit.** Add `'lib/analysis/databases-report.ts'` to `SERVER_ONLY_MODULES`. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`. Commit: `feat(databases): section report with peak connections and database load`.

**moto limits:** fact 7 means `PerformanceInsightsEnabled` is never true, so the `DBLoad` column and its headline are always the unavailable variant in e2e; the populated case is unit-tested. moto's instance is `db.t3.medium`, which the memory table knows, so `unknown_class` is unit-tested only.
**Owner-only verification:** real `DBLoad` values and the freeable-memory percentage against the instance class they actually run.

---

### Task 19: Databases dashboard

Implements spec §9.2 for Databases: the instances list becomes a dashboard with instance and role counts, average CPU, peak connections and database load as tiles; a database-load-per-instance chart; a top-statements ranking that links to the Queries page; the existing instances table; and the RDS insights.

**Files:**
- Create: `src/lib/analysis/databases-dashboard.ts`
- Modify: `src/app/[locale]/(app)/c/[connectionId]/[region]/databases/instances/page.tsx`, `…/instances/cards.tsx`
- Create: `tests/unit/analysis-databases-dashboard.test.ts`
- Modify: `tests/e2e/09-dashboards.spec.ts`, `tests/e2e/06-monitoring.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: everything Task 18 consumes, plus `fleetQueries` from `@/lib/analysis/queries`, `subsectionPath` from `@/lib/monitoring/shared/paths`, `MetricChart` and `TopNBars`.
- Produces:
  - `export type InstanceRow = { instance: RdsInstance; cpu: number | null; connections: number | null; freeableMemoryPercent: number | null; dbLoad: number | null; href: string };`
  - `export const DATABASE_FACETS = ['engine', 'class', 'role', 'pi'] as const;`
  - `export function databaseFacetAccessors(): FacetAccessors<InstanceRow>`
  - `export function databasesHeadlines(rows: readonly InstanceRow[]): Headline[]`
  - `export function databasesDashboard(target: AwsTarget, options: { nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<{ dashboard: SectionDashboard; rows: InstanceRow[]; loadSeries: { id: string; label: string; timestamps: number[]; values: number[] }[] }>>`
  - `export function topStatementsPanel(target: AwsTarget, options: { nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<FleetQueriesData>>` — a thin wrapper over `fleetQueries(target, { group: 'sql', sort: 'load', range: '3h', nowMs }, deps)`, kept separate so the page can give it **its own Suspense boundary** (spec §5: the heavy Performance Insights part streams on its own).

**The range** behaves as Task 15 fixed it for every dashboard. **Cost.** The metric part is four queries per instance over `recentWindow(INSIGHT_FETCH_MINUTES, nowMs)` (CPU `Average`, `DatabaseConnections` `Maximum`, `FreeableMemory` `Average`, and `DBLoad` `Average` only where Performance Insights is on), `planQueries(instances, 4)` → 75 instances. The top-statements panel spends **one Performance Insights call per instance**, capped at `QUERIES_MAX_INSTANCES` by `fleetQueries` itself; its results are cached 5 minutes (`PI_TTL_MS`), so the dashboard's 120 s auto-refresh re-spends that budget at most once every five minutes. Write that sentence as a comment above `topStatementsPanel`.

**Facets:** `engine` (`instance.engine`), `class` (`instance.instanceClass`), `role` (`writer`/`reader`/`standalone`), `pi` (`'on'` / `'off'`).
**Status bar:** by `instance.status` (`available` → `success`, `backing-up`/`modifying`/`upgrading` → `info`, `storage-full`/`incompatible-parameters` → `warning`, `failed`/`inaccessible-encryption-credentials` → `danger`, anything else → `other`, toned `info`). AWS status strings are not translated; the segment label is `Dashboards.databases.status.<code>` with an `other` fallback taking `{status}`.
**Figures:** one `MetricChart` with one series per instance that has `DBLoad`, up to four series (the chart's colour palette holds four), labelled with the instance id; when no instance has Performance Insights the chart is replaced by `Dashboards.databases.loadUnavailable`.
**Ranking:** the top five rows of `topStatementsPanel` as `TopNBars`, each bar's name the truncated statement and its link `subsectionPath(scope, 'databases', 'queries')`, plus a "see all" link to the Queries page.
**Headlines:** `busiest` (highest CPU instance), `roles` (how many writers and readers), `load` (the heaviest statement's share, from the panel — or omitted when the panel is not covered).

- [ ] **Step 1: Write the failing unit test**

```ts
it('requests DBLoad only where Performance Insights is on and keeps the whole page under the cap', async () => {
  const result = await databasesDashboard(target, { nowMs: t }, deps);
  const qs = cw.commandCalls(GetMetricDataCommand)[0].args[0].input.MetricDataQueries ?? [];
  expect(qs.filter((q) => q.MetricStat?.Metric?.MetricName === 'DBLoad').length).toBe(1);
  expect(qs.length).toBeLessThanOrEqual(300);
  expect(result.ok && result.data.dashboard.kpis.map((k) => k.id)).toEqual(['instances', 'roles', 'cpu', 'connections', 'load']);
});

it('counts writers and readers in one tile', async () => {
  const result = await databasesDashboard(target, { nowMs: t }, deps);
  expect(result.ok && result.data.dashboard.kpis.find((k) => k.id === 'roles')?.value).toBe(2);   // 1 writer + 1 reader
  expect(result.ok && result.data.dashboard.headlines).toContainEqual({ key: 'roles', values: { writers: 1, readers: 1 } });
});

it('groups unknown instance statuses into one segment', async () => {
  const result = await databasesDashboard(target, { nowMs: t }, deps);
  expect(result.ok && result.data.dashboard.status.find((s) => s.key === 'other')?.count).toBe(1);
});

it('offers at most four load series so the chart palette holds', async () => {
  const result = await databasesDashboard(target, { nowMs: t }, deps);   // 6 instances with PI
  expect(result.ok && result.data.loadSeries).toHaveLength(4);
});

it('spends one Performance Insights call per instance and no more', async () => {
  await topStatementsPanel(target, { nowMs: t }, deps);
  expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(2);
});

it('counts the facets over every instance, not the filtered ones', async () => {
  const result = await databasesDashboard(target, { nowMs: t }, deps);
  expect(countFacets(result.ok ? result.data.rows : [], databaseFacetAccessors()).map((g) => g.id))
    .toEqual(['engine', 'class', 'role', 'pi']);
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write the module and rebuild the page.** Keep the existing instance links, the cluster column, the role labels and the sparklines the list already has; the sparkline column stays as the table's compact trend.
- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Dashboards.databases.title` | `Instances` | `Instances` |
| `Dashboards.databases.description` | `Every RDS and Aurora instance of {connection} in {region}.` | `Toutes les instances RDS et Aurora de {connection} dans {region}.` |
| `Dashboards.databases.headline.busiest` | `{instance} is using the most CPU right now, at {cpu}.` | `{instance} consomme actuellement le plus de CPU, à {cpu}.` |
| `Dashboards.databases.headline.roles` | `{writers, plural, one {# writer} other {# writers}} and {readers, plural, one {# reader} other {# readers}}.` | `{writers, plural, one {# instance d'écriture} other {# instances d'écriture}} et {readers, plural, one {# instance de lecture} other {# instances de lecture}}.` |
| `Dashboards.databases.headline.load` | `{statement} carries {share} of the database load that is visible.` | `{statement} porte {share} de la charge visible.` |
| `Dashboards.databases.kpi.instances` | `Instances` | `Instances` |
| `Dashboards.databases.kpi.roles` | `Writers and readers` | `Écriture et lecture` |
| `Dashboards.databases.kpi.cpu` | `Highest CPU` | `CPU le plus élevé` |
| `Dashboards.databases.kpi.connections` | `Peak connections` | `Pic de connexions` |
| `Dashboards.databases.kpi.load` | `Database load` | `Charge de base de données` |
| `Dashboards.databases.status.available` | `{count} available` | `{count} disponibles` |
| `Dashboards.databases.status.backing-up` | `{count} backing up` | `{count} en sauvegarde` |
| `Dashboards.databases.status.modifying` | `{count} modifying` | `{count} en modification` |
| `Dashboards.databases.status.upgrading` | `{count} upgrading` | `{count} en mise à niveau` |
| `Dashboards.databases.status.storage-full` | `{count} out of storage` | `{count} sans espace disque` |
| `Dashboards.databases.status.failed` | `{count} failed` | `{count} en échec` |
| `Dashboards.databases.status.other` | `{count} in state {status}` | `{count} à l'état {status}` |
| `Dashboards.databases.facet.engine` | `Engine` | `Moteur` |
| `Dashboards.databases.facet.class` | `Class` | `Classe` |
| `Dashboards.databases.facet.role` | `Role` | `Rôle` |
| `Dashboards.databases.facet.pi` | `Performance Insights` | `Performance Insights` |
| `Dashboards.databases.facet.piOn` | `Enabled` | `Activé` |
| `Dashboards.databases.facet.piOff` | `Disabled` | `Désactivé` |
| `Dashboards.databases.chartLabel` | `Database load per instance` | `Charge par instance` |
| `Dashboards.databases.loadUnavailable` | `No instance in this region has Performance Insights enabled, so database load cannot be shown.` | `Aucune instance de cette région n'a Performance Insights activé : la charge ne peut pas être affichée.` |
| `Dashboards.databases.topStatements` | `Heaviest statements across the fleet` | `Requêtes les plus lourdes du parc` |
| `Dashboards.databases.seeAllQueries` | `See every statement and where it comes from` | `Voir toutes les requêtes et leur origine` |
| `Dashboards.databases.notCoveredTitle` | `Instances not covered` | `Instances non couvertes` |

- [ ] **Step 5: Write the failing end-to-end test**

```ts
test('the databases dashboard shows roles, the load chart placeholder and a link to the queries page', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/instances`);
  await expect(page.getByRole('region', { name: 'Key figures' })).toContainText('Writers and readers');
  // moto never reports PerformanceInsightsEnabled (fact 7).
  await expect(page.getByText('No instance in this region has Performance Insights enabled', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See every statement and where it comes from' }))
    .toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/queries`);
  await expect(page.getByRole('link', { name: 'opswatch-e2e-db' }))
    .toHaveAttribute('href', new RegExp(`/databases/instances/opswatch-e2e-db`));
});

test('the engine facet filters the instances table', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/instances`);
  await page.getByRole('navigation', { name: 'Filters' }).getByRole('link', { name: /mysql/ }).click();
  await expect(page).toHaveURL(/engine=mysql/);
  await expect(page.getByText('Showing 1 of 1')).toBeVisible();
});
```

- [ ] **Step 6: Run everything.**
- [ ] **Step 7: Verify and commit.** Add `'lib/analysis/databases-dashboard.ts'` to `SERVER_ONLY_MODULES`. Run the five commands. Commit: `feat(databases): turn the instances list into a category dashboard`.

**moto limits:** facts 7 and 8 leave the load chart and the top-statements ranking permanently empty in e2e; both are unit-tested. moto returns the same `DbiResourceId` for every instance, so a multi-instance Performance Insights test in e2e would be meaningless.
**Owner-only verification:** the load chart with real series, and that the top-statements ranking agrees with the Queries page.

---

### Task 20: Alarms report

Implements spec §3 for Alarms with amendment 1 (**no "time spent in ALARM"** — `DescribeAlarms` has no history and `cloudwatch:DescribeAlarmHistory` is not in the IAM catalogue) and amendment 10 (target-tracking alarms excluded by default, with a toggle).

**Files:**
- Create: `src/lib/analysis/alarms-report.ts`, `src/app/[locale]/(app)/c/[connectionId]/[region]/alarms/report/page.tsx`, `…/report/cards.tsx`
- Create: `tests/unit/analysis-alarms-report.test.ts`
- Modify: `tests/e2e/08-analysis.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `listAlarms`, `AlarmSummary`, `AlarmState`, `COMPARISON_SYMBOLS` from `@/lib/monitoring/alarms`; `alarmInsights` from `@/lib/monitoring/insights`; the Task 12 engine (for `Headline` and `SectionReport` only — this report sends **zero** metric queries).
- Produces:
  - `export type AlarmReportRow = { alarm: AlarmSummary; sinceMs: number | null; durationMs: number | null };`
  - `export function rankAlarmsInAlarm(alarms: readonly AlarmSummary[], nowMs: number): AlarmReportRow[]`
  - `export function alarmsReport(target: AwsTarget, options: { showTargetTracking: boolean; nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<SectionReport & { rows: never[]; alarmRows: AlarmReportRow[] }>>` — the generic `rows` stay empty because an alarm has no metric-backed row; the page renders `alarmRows`.

**The ranking, exactly** (amendment 1): alarms currently in `ALARM`, **longest first by `stateUpdatedAt`**, and the wording says exactly that — "currently in ALARM, longest first" — never "time spent in ALARM". `durationMs = nowMs - stateUpdatedAt`, and an alarm whose `stateUpdatedAt` is `null` sorts last with `durationMs: null` and renders `NO_VALUE` (the guarded-nullable-timestamp rule). The report carries **no window selector and no double window**: it has no series. It still names its scope — `Reports.alarms.noHistory` states plainly that OpsWatch reads the current state only, and that adding `cloudwatch:DescribeAlarmHistory` would need a template version bump and a stack update by the owner (amendment 1 records that as a separate decision, not part of this stage).

**Headlines:** `firing` (how many are in ALARM), `longest` (the alarm in ALARM the longest, with its `stateUpdatedAt` rendered through the page's `format.relativeTime` guard), `insufficient` (how many have `INSUFFICIENT_DATA`).
**KPI tiles:** in ALARM (`danger` when > 0), insufficient data (`warning` when > 0), OK, hidden autoscaling alarms (`info`).
**The table:** `alarm` (`always`), `state` (`always`, badge), `since` (`always`, relative time), `namespace` (`md`), `metric` (`md`), `threshold` (`lg`, rendered as `{comparison} {threshold}` with `COMPARISON_SYMBOLS`, never translated), `reason` (`lg`, `stateReason` verbatim from AWS). Default order: the ranking above.
**The toggle:** `?tt=1` shows target-tracking alarms, exactly like the Alarms list page, and the count of hidden ones is always stated (amendment 10).

- [ ] **Step 1: Write the failing unit test**

```ts
describe('rankAlarmsInAlarm', () => {
  const now = Date.parse('2026-09-18T14:00:00Z');
  const a = (name: string, state: AlarmState, updated: number | null, tt = false) => ({ ...alarmFixture, name, state, stateUpdatedAt: updated, targetTracking: tt });

  it('keeps only the alarms in ALARM and puts the oldest first', () => {
    const rows = rankAlarmsInAlarm([
      a('recent', 'ALARM', now - 60_000),
      a('old', 'ALARM', now - 3 * 3600_000),
      a('ok', 'OK', now - 10 * 3600_000),
      a('insufficient', 'INSUFFICIENT_DATA', now - 10 * 3600_000),
    ], now);
    expect(rows.map((r) => r.alarm.name)).toEqual(['old', 'recent']);
    expect(rows[0].durationMs).toBe(3 * 3600_000);
  });

  it('sorts an alarm with no timestamp last and reports no duration for it', () => {
    const rows = rankAlarmsInAlarm([a('unknown', 'ALARM', null), a('old', 'ALARM', now - 3600_000)], now);
    expect(rows.map((r) => [r.alarm.name, r.durationMs])).toEqual([['old', 3600_000], ['unknown', null]]);
  });

  it('is stable for alarms that changed state at the same moment', () => {
    const rows = rankAlarmsInAlarm([a('b', 'ALARM', now - 5), a('a', 'ALARM', now - 5)], now);
    expect(rows.map((r) => r.alarm.name)).toEqual(['a', 'b']);   // then by name
  });
});

describe('alarmsReport', () => {
  it('sends no metric query at all', async () => {
    await alarmsReport(target, { showTargetTracking: false, nowMs: t }, deps);
    expect(cw.commandCalls(GetMetricDataCommand)).toHaveLength(0);
  });
  it('hides target-tracking alarms by default and counts them', async () => {
    const result = await alarmsReport(target, { showTargetTracking: false, nowMs: t }, deps);
    expect(result.ok && result.data.alarmRows.some((r) => r.alarm.targetTracking)).toBe(false);
    expect(result.ok && result.data.kpis.find((k) => k.id === 'hidden')?.value).toBe(1);
  });
  it('shows them when asked', async () => {
    const result = await alarmsReport(target, { showTargetTracking: true, nowMs: t }, deps);
    expect(result.ok && result.data.alarmRows.some((r) => r.alarm.targetTracking)).toBe(true);
    expect(result.ok && result.data.kpis.find((k) => k.id === 'hidden')?.value).toBe(0);
  });
  it('writes the three headlines', async () => {
    const result = await alarmsReport(target, { showTargetTracking: false, nowMs: t }, deps);
    expect(result.ok && result.data.headlines.map((h) => h.key)).toEqual(['firing', 'longest', 'insufficient']);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write the module, the page and the cards.**
- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Reports.alarms.title` | `Alarms report` | `Rapport alarmes` |
| `Reports.alarms.description` | `The CloudWatch alarms of {region}, worst first.` | `Les alarmes CloudWatch de {region}, les pires d'abord.` |
| `Reports.alarms.cardTitle` | `Currently in ALARM, longest first` | `Actuellement en ALARM, les plus anciennes d'abord` |
| `Reports.alarms.noHistory` | `OpsWatch reads the current alarm state only, so this ranks alarms by how long they have been in ALARM, not by time spent in ALARM over a window. Alarm history would need a new permission and a stack update.` | `OpsWatch ne lit que l'état actuel des alarmes : ce classement porte sur la durée depuis le passage en ALARM, et non sur le temps passé en ALARM sur une fenêtre. L'historique demanderait une nouvelle permission et une mise à jour de la pile.` |
| `Reports.alarms.headline.firing` | `{count, plural, =0 {No alarm is} one {# alarm is} other {# alarms are}} in ALARM right now.` | `{count, plural, =0 {Aucune alarme n'est} one {# alarme est} other {# alarmes sont}} en ALARM actuellement.` |
| `Reports.alarms.headline.longest` | `{alarm} has been in ALARM since {since}.` | `{alarm} est en ALARM depuis {since}.` |
| `Reports.alarms.headline.insufficient` | `{count, plural, =0 {No alarm has} one {# alarm has} other {# alarms have}} insufficient data.` | `{count, plural, =0 {Aucune alarme n'a} one {# alarme a} other {# alarmes ont}} des données insuffisantes.` |
| `Reports.alarms.kpi.firing` | `In ALARM` | `En ALARM` |
| `Reports.alarms.kpi.insufficient` | `Insufficient data` | `Données insuffisantes` |
| `Reports.alarms.kpi.ok` | `OK` | `OK` |
| `Reports.alarms.kpi.hidden` | `Hidden autoscaling alarms` | `Alarmes d'autoscaling masquées` |
| `Reports.alarms.columns.alarm` | `Alarm` | `Alarme` |
| `Reports.alarms.columns.state` | `State` | `État` |
| `Reports.alarms.columns.since` | `Since` | `Depuis` |
| `Reports.alarms.columns.namespace` | `Namespace` | `Espace de noms` |
| `Reports.alarms.columns.metric` | `Metric` | `Métrique` |
| `Reports.alarms.columns.threshold` | `Threshold` | `Seuil` |
| `Reports.alarms.columns.reason` | `Reason` | `Raison` |
| `Reports.alarms.showTargetTracking` | `Show autoscaling alarms` | `Afficher les alarmes d'autoscaling` |
| `Reports.alarms.hideTargetTracking` | `Hide autoscaling alarms` | `Masquer les alarmes d'autoscaling` |
| `Reports.alarms.hiddenCount` | `{count, plural, one {# autoscaling alarm is hidden.} other {# autoscaling alarms are hidden.}}` | `{count, plural, one {# alarme d'autoscaling est masquée.} other {# alarmes d'autoscaling sont masquées.}}` |
| `Reports.alarms.empty` | `No alarm is in ALARM in this region.` | `Aucune alarme n'est en ALARM dans cette région.` |
| `Reports.alarms.tableCaption` | `Alarms currently in ALARM` | `Alarmes actuellement en ALARM` |

- [ ] **Step 5: Write the failing end-to-end test**

```ts
test('the alarms report ranks the firing alarms and never claims a history it cannot read', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/alarms/report`);
  await expect(page.getByText('OpsWatch reads the current alarm state only', { exact: false })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-high-cpu' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e' })).toHaveCount(0);
  await expect(page.getByText('1 autoscaling alarm is hidden.')).toBeVisible();
  await page.getByRole('link', { name: 'Show autoscaling alarms' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e' })).toBeVisible();
});
```

- [ ] **Step 6: Run everything.**
- [ ] **Step 7: Verify and commit.** Add `'lib/analysis/alarms-report.ts'` to `SERVER_ONLY_MODULES`. Run the five commands. Commit: `feat(alarms): section report ranked by time in ALARM state`.

**moto limits:** fact 9 — `DescribeAlarms` works and ignores `MaxRecords`, so pagination is unit-tested only. The seed has one ALARM metric alarm, one ALARM target-tracking alarm and one OK alarm, which is exactly what the spec above asserts.
**Owner-only verification:** none beyond reading the ranking on a real account.

---

### Task 21: Alarms dashboard

Implements spec §9.2 for Alarms: the alarms list becomes a dashboard with the four state tiles, the state bar, the longest-firing ranking and the existing filterable table. It costs **zero** metric queries.

**Files:**
- Create: `src/lib/analysis/alarms-dashboard.ts`
- Modify: `src/app/[locale]/(app)/c/[connectionId]/[region]/alarms/list/page.tsx`, `…/list/cards.tsx`
- Create: `tests/unit/analysis-alarms-dashboard.test.ts`
- Modify: `tests/e2e/09-dashboards.spec.ts`, `tests/e2e/06-monitoring.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `listAlarms`, `parseAlarmFilter`, `filterAlarms`, `ALARM_STATE_FILTERS`, `AlarmFilter`, `COMPARISON_SYMBOLS` from `@/lib/monitoring/alarms`; `rankAlarmsInAlarm` from `@/lib/analysis/alarms-report`; `alarmInsights` from `@/lib/monitoring/insights`; the Task 12 engine.
- Produces:
  - `export const ALARM_FACETS = ['state', 'namespace', 'kind'] as const;`
  - `export function alarmFacetAccessors(): FacetAccessors<AlarmSummary>`
  - `export function alarmsHeadlines(alarms: readonly AlarmSummary[], nowMs: number): Headline[]`
  - `export function alarmsDashboard(target: AwsTarget, options: { filter: AlarmFilter; nowMs: number }, deps?: MonitoringDeps): Promise<MonitoringResult<{ dashboard: SectionDashboard; alarms: AlarmSummary[]; longest: AlarmReportRow[] }>>`

**Facets** (spec §1b): `state` (`OK` / `ALARM` / `INSUFFICIENT_DATA`, AWS values, labelled through `Dashboards.alarms.state.<value>`), `namespace` (`alarm.namespace ?? 'none'` — a composite alarm has none), `kind` (`'targetTracking'` / `'regular'`, which is §1b's "whether the alarm is a target-tracking one").
**Status bar:** by state, tones `danger`, `warning`, `success`; clicking sets `?state=<value>`, which is the filter the existing page already reads, so the bar and the existing state filter are the same control.
**Ranking:** `rankAlarmsInAlarm` reused from Task 20, top ten, rendered as a list of alarm name plus relative time rather than `TopNBars` (a duration bar would imply a history the data does not have — amendment 1).
**The table** is the existing alarms table with its state filter, target-tracking toggle and search, all unchanged.
**Headlines:** `firing`, `longest`, `hidden`.
**Coverage:** alarms are one `DescribeAlarms` pagination with no cap, so `coverage` is `coverageOf(n, n)` and `CoverageNote` renders nothing (its `total === 0` guard does not apply, so pass `coverage` with `truncated: false` and let the note read "Covering N of N alarms.").

- [ ] **Step 1: Write the failing unit test**

```ts
it('sends no metric query', async () => {
  await alarmsDashboard(target, { filter: { state: 'all', showTargetTracking: false, search: '' }, nowMs: t }, deps);
  expect(cw.commandCalls(GetMetricDataCommand)).toHaveLength(0);
});

it('counts facets over every alarm, including the ones the filter hides', async () => {
  const result = await alarmsDashboard(target, { filter: { state: 'ALARM', showTargetTracking: false, search: '' }, nowMs: t }, deps);
  const groups = countFacets(result.ok ? result.data.alarms : [], alarmFacetAccessors());
  expect(groups.find((g) => g.id === 'state')?.values.map((v) => v.value).sort()).toEqual(['ALARM', 'INSUFFICIENT_DATA', 'OK']);
  expect(groups.find((g) => g.id === 'kind')?.values).toContainEqual({ value: 'targetTracking', count: 1 });
  expect(groups.find((g) => g.id === 'namespace')?.values).toContainEqual({ value: 'none', count: 1 });   // a composite alarm
});

it('builds the state bar from the three AWS states with counts that add up', async () => {
  const result = await alarmsDashboard(target, { filter: { state: 'all', showTargetTracking: false, search: '' }, nowMs: t }, deps);
  const status = result.ok ? result.data.dashboard.status : [];
  expect(status.map((s) => s.key)).toEqual(['ALARM', 'INSUFFICIENT_DATA', 'OK']);
  expect(status.map((s) => s.hrefQuery)).toEqual(['state=ALARM', 'state=INSUFFICIENT_DATA', 'state=OK']);
  expect(status.reduce((n, s) => n + s.count, 0)).toBe(result.ok ? result.data.alarms.filter((a) => !a.targetTracking).length : -1);
});

it('lists the ten longest-firing alarms', async () => {
  const result = await alarmsDashboard(target, { filter: { state: 'all', showTargetTracking: false, search: '' }, nowMs: t }, deps);
  expect(result.ok && result.data.longest.length).toBeLessThanOrEqual(10);
  expect(result.ok && result.data.longest.every((r) => r.alarm.state === 'ALARM')).toBe(true);
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write the module and rebuild the page.**
- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Dashboards.alarms.title` | `Alarms` | `Alarmes` |
| `Dashboards.alarms.description` | `Every CloudWatch alarm of {connection} in {region}.` | `Toutes les alarmes CloudWatch de {connection} dans {region}.` |
| `Dashboards.alarms.headline.firing` | `{count, plural, =0 {No alarm is} one {# alarm is} other {# alarms are}} in ALARM right now.` | `{count, plural, =0 {Aucune alarme n'est} one {# alarme est} other {# alarmes sont}} en ALARM actuellement.` |
| `Dashboards.alarms.headline.longest` | `{alarm} has been in ALARM the longest, since {since}.` | `{alarm} est en ALARM depuis le plus longtemps, depuis {since}.` |
| `Dashboards.alarms.headline.hidden` | `{count, plural, =0 {No autoscaling alarm is hidden} one {# autoscaling alarm is hidden} other {# autoscaling alarms are hidden}}; they fire as part of normal scaling.` | `{count, plural, =0 {Aucune alarme d'autoscaling n'est masquée} one {# alarme d'autoscaling est masquée} other {# alarmes d'autoscaling sont masquées}} ; elles se déclenchent lors d'une mise à l'échelle normale.` |
| `Dashboards.alarms.kpi.firing` | `In ALARM` | `En ALARM` |
| `Dashboards.alarms.kpi.insufficient` | `Insufficient data` | `Données insuffisantes` |
| `Dashboards.alarms.kpi.ok` | `OK` | `OK` |
| `Dashboards.alarms.kpi.hidden` | `Hidden autoscaling alarms` | `Alarmes d'autoscaling masquées` |
| `Dashboards.alarms.state.ALARM` | `{count} in ALARM` | `{count} en ALARM` |
| `Dashboards.alarms.state.INSUFFICIENT_DATA` | `{count} with insufficient data` | `{count} sans données suffisantes` |
| `Dashboards.alarms.state.OK` | `{count} OK` | `{count} OK` |
| `Dashboards.alarms.facet.state` | `State` | `État` |
| `Dashboards.alarms.facet.namespace` | `Namespace` | `Espace de noms` |
| `Dashboards.alarms.facet.namespaceNone` | `No namespace (composite)` | `Aucun espace de noms (composite)` |
| `Dashboards.alarms.facet.kind` | `Kind` | `Type` |
| `Dashboards.alarms.facet.kindTargetTracking` | `Autoscaling` | `Autoscaling` |
| `Dashboards.alarms.facet.kindRegular` | `Alerting` | `Alerte` |
| `Dashboards.alarms.longestTitle` | `In ALARM the longest` | `En ALARM depuis le plus longtemps` |
| `Dashboards.alarms.longestRow` | `{alarm}, since {since}` | `{alarm}, depuis {since}` |

- [ ] **Step 5: Write the failing end-to-end test**

```ts
test('the alarms dashboard keeps the existing filters and adds tiles, a state bar and the longest ranking', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/alarms/list`);
  await expect(page.getByRole('region', { name: 'Key figures' })).toContainText('In ALARM');
  await expect(page.getByRole('img', { name: 'Resources by state' })).toContainText('in ALARM');
  await expect(page.getByText('In ALARM the longest')).toBeVisible();
  // The Stage 2 behaviour is unchanged.
  await expect(page.getByRole('row').filter({ hasText: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e' })).toHaveCount(0);
  await expect(page.getByText('1 target-tracking alarm is hidden.')).toBeVisible();
});

test('clicking the state bar filters the alarms table', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/alarms/list`);
  await page.getByRole('img', { name: 'Resources by state' }).getByRole('link', { name: /in ALARM/ }).click();
  await expect(page).toHaveURL(/state=ALARM/);
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-db-connections' })).toHaveCount(0);
});
```

- [ ] **Step 6: Run everything.**
- [ ] **Step 7: Verify and commit.** Add `'lib/analysis/alarms-dashboard.ts'` to `SERVER_ONLY_MODULES`. Run the five commands. Commit: `feat(alarms): turn the alarms list into a category dashboard`.

**moto limits:** fact 9 again; three seeded alarms give one of each state plus the target-tracking one, which covers every tile and every bar segment.
**Owner-only verification:** none.

---

### Task 22: Logs → Volume dashboard

Implements spec §9.2's Logs row, which replaces §1's "Volume" sub-page description: groups, volume ingested over the window, the biggest group, groups with no retention; volume over time; top ten groups by volume; the groups table with size, retention and a link that opens the search on that group. It also makes `volume` the Logs default sub-page, and extends the moto seed so the volume numbers exist end to end.

**Metric identity is pinned by amendment 9:** ingested volume is `AWS/Logs` `IncomingBytes` with dimension `LogGroupName`. `storedBytes` from `DescribeLogGroups` is used **only** for the stored size and is labelled as possibly lagging by hours.

**Files:**
- Modify: `src/lib/monitoring/logs.ts` (add `listLogGroups`, `logGroupVolumeQuery`, `MAX_LOG_GROUPS`)
- Create: `src/lib/analysis/logs-dashboard.ts`, `src/app/[locale]/(app)/c/[connectionId]/[region]/logs/volume/page.tsx`, `…/volume/cards.tsx`
- Modify: `src/lib/monitoring/shared/sections.ts` (Logs order becomes `['volume', 'search', 'endpoints']`)
- Modify: `tests/e2e/seed/moto-seed.ts` (seed `IncomingBytes` and a retention policy)
- Create: `tests/unit/analysis-logs-dashboard.test.ts`
- Modify: `tests/unit/monitoring-logs.test.ts`, `tests/unit/monitoring-sections.test.ts`, `tests/unit/monitoring-paths.test.ts`, `tests/e2e/05-monitoring-seed.spec.ts`, `tests/e2e/08-analysis.spec.ts`, `tests/e2e/09-dashboards.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `DescribeLogGroupsCommand` from `@aws-sdk/client-cloudwatch-logs`; `LogGroup`, `searchLogGroups`, `LOG_GROUP_SEARCH_LIMIT` from `@/lib/monitoring/logs`; `getMetricSeries`, `seriesById` from `@/lib/monitoring/metrics`; `doubleWindow`, `windowedMetric`, `parseReportRange`, `REPORT_RANGES` from `@/lib/analysis/window`; `volumeBand` from `@/lib/monitoring/shared/bands`; the Task 12 engine.
- Produces (added to `src/lib/monitoring/logs.ts`):
  - `export const MAX_LOG_GROUPS = 300;`
  - `export function listLogGroups(target: AwsTarget, deps?: MonitoringDeps): Promise<MonitoringResult<{ groups: LogGroup[]; truncated: boolean }>>` — paginates `DescribeLogGroups` with `limit: 50` and `nextToken`, at most `MAX_LOG_GROUP_PAGES = 6` pages, stopping at `MAX_LOG_GROUPS`; `truncated` says a page was left.
  - `export function logGroupVolumeQuery(name: string, id: string): MetricQuery` → `{ id, namespace: 'AWS/Logs', metricName: 'IncomingBytes', dimensions: { LogGroupName: name }, stat: 'Sum' }`
- Produces (`src/lib/analysis/logs-dashboard.ts`):
  - `export type LogGroupRow = { group: LogGroup; ingested: WindowedMetric; sharePercent: number | null; searchHref: string };`
  - `export const LOG_FACETS = ['retention', 'volumeBand'] as const;`
  - `export function logFacetAccessors(): FacetAccessors<LogGroupRow>`
  - `export function logsHeadlines(rows: readonly LogGroupRow[], totalIngested: number | null): Headline[]`
  - `export function logsDashboard(target: AwsTarget, options: { range: ReportRange; nowMs: number; scope: ScopeRef }, deps?: MonitoringDeps): Promise<MonitoringResult<{ dashboard: SectionDashboard; rows: LogGroupRow[]; totalSeries: SeriesData; range: ReportRange }>>`

**The query plan.** `listLogGroups` first, then **one** `IncomingBytes` query per group over the **double** window (amendment 11: one query per group covering both windows), so the change against the previous window costs nothing extra. `planQueries(groups, 1)` caps at 300 groups, which is also `MAX_LOG_GROUPS`; groups past the cap become `notCovered(name, 'cap')`. This dashboard therefore carries a range selector (`REPORT_RANGES`, default `12h`) — unlike the other dashboards, its subject *is* a window — and it keeps auto-refresh off for the same reason a report does: re-running 300 queries every two minutes is not worth it. State that with `Dashboards.logs.noAutoRefresh`.

**KPI tiles:** `groups` (count covered), `ingested` (`Σ` of every group's current half, `bytes`, with its `ChangeArrow`), `biggest` (the largest group's ingested bytes, `bytes`, with its name in the tile label), `noRetention` (how many groups have `retentionDays === null`, toned `warning` when > 0).
**Status bar:** two segments, `retained` and `unretained`, tones `success` and `warning`, `hrefQuery` `retention=set` / `retention=none`.
**Figures:** one `MetricChart` of the summed `IncomingBytes` across covered groups, unit `bytes`, over the **current** half only (the previous half is what the arrows compare against, not what the chart draws) — say so with `Dashboards.logs.chartNote`.
**Ranking:** `TopNBars` of the ten biggest groups by ingested bytes, each linking to its `searchHref`.
**The table:** `group` (`always`, the name, with a link to `subsectionPath(scope, 'logs', 'search') + '?group=' + encodeURIComponent(name)` so the search opens on that group — spec §9.2), `ingested` (`always`, right, `bytes`, `ChangeArrow`), `share` (`md`, right), `stored` (`sm`, right, `bytes`, with the lagging footnote), `retention` (`always`, days or `Dashboards.logs.retentionNone`).
**Headlines:** `total` (total ingested and its change), `biggest` (the biggest group and its share), `retention` (how many groups keep logs forever).

- [ ] **Step 1: Extend the moto seed and prove it**

In `tests/e2e/seed/moto-seed.ts`, add to `SEED`: `incomingBytesPerMinute: 41_943_040` (40 MiB) for `logGroup` and `1_048_576` (1 MiB) for `otherLogGroup`, and `retentionDays: 7` for `otherLogGroup` only. In `seedMoto`, after the log groups are created:
- `PutMetricData` into `AWS/Logs` with `MetricName: 'IncomingBytes'` and `Dimensions: [{ Name: 'LogGroupName', Value: … }]` (one dimension, so no ordering question), one datapoint per minute for the same 30 whole minutes the other metrics use. Totals: 1.2 GiB for `/ecs/opswatch-web`, 30 MiB for `/aws/lambda/opswatch-e2e-worker`. **The 1.2 GiB total is what makes the audit's retention check fire in Task 26**, so do not lower it.
- `PutRetentionPolicyCommand({ logGroupName: SEED.otherLogGroup, retentionInDays: 7 })`.

Add to `tests/e2e/05-monitoring-seed.spec.ts`:

```ts
test('the seeded log volume and retention are readable', async () => {
  const logs = new CloudWatchLogsClient(config);
  const { logGroups } = await logs.send(new DescribeLogGroupsCommand({}));
  const byName = Object.fromEntries((logGroups ?? []).map((g) => [g.logGroupName, g.retentionInDays ?? null]));
  expect(byName[SEED.logGroup]).toBeNull();
  expect(byName[SEED.otherLogGroup]).toBe(7);

  const cw = new CloudWatchClient(config);
  const end = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const out = await cw.send(new GetMetricDataCommand({
    StartTime: new Date(end.getTime() - 3600_000), EndTime: end,
    MetricDataQueries: [{ Id: 'v', ReturnData: true, MetricStat: { Metric: { Namespace: 'AWS/Logs', MetricName: 'IncomingBytes', Dimensions: [{ Name: 'LogGroupName', Value: SEED.logGroup }] }, Period: 60, Stat: 'Sum' } }],
  }));
  const values = out.MetricDataResults?.[0]?.Values ?? [];
  expect(values.reduce((a, b) => a + b, 0)).toBe(SEED.datapoints * SEED.incomingBytesPerMinute);
});
```

**If `PutRetentionPolicy` is not implemented by moto 5.2.3**, `byName[SEED.otherLogGroup]` comes back `null` instead of `7`. In that case: keep the seed call (it is harmless), change this assertion to `expect(byName[SEED.otherLogGroup]).toBeNull()`, drop the "retention set" assertions from the Task 22 e2e spec below, and record "log group retention policies" in the e2e gap list of the Phase 3 checkpoint. Do not work around it any other way.

Run: `docker compose -f docker-compose.test.yml up -d --build --wait && npx playwright test --config tests/e2e/playwright.config.ts 05-monitoring-seed; docker compose -f docker-compose.test.yml down -v`
Expected: the new test passes, or fails only on the retention line, in which case take the branch above.

- [ ] **Step 2: Write the failing unit tests**

Add to `tests/unit/monitoring-logs.test.ts`:

```ts
describe('listLogGroups', () => {
  it('pages through DescribeLogGroups up to 300 groups and says when it stopped', async () => {
    let page = 0;
    logs.on(DescribeLogGroupsCommand).callsFake(() => {
      page += 1;
      return { logGroups: Array.from({ length: 50 }, (_, i) => ({ logGroupName: `/g/${page}/${i}`, storedBytes: 1, retentionInDays: undefined })), nextToken: 'more' };
    });
    const result = await listLogGroups(target, deps);
    expect(logs.commandCalls(DescribeLogGroupsCommand)).toHaveLength(6);
    expect(result.ok && result.data.groups).toHaveLength(300);
    expect(result.ok && result.data.truncated).toBe(true);
  });
  it('stops early and reports no truncation when AWS returns no token', async () => {
    logs.on(DescribeLogGroupsCommand).resolves({ logGroups: [{ logGroupName: '/a', storedBytes: 12, retentionInDays: 7 }] });
    const result = await listLogGroups(target, deps);
    expect(result.ok && result.data).toEqual({ groups: [{ name: '/a', storedBytes: 12, retentionDays: 7 }], truncated: false });
  });
});

describe('logGroupVolumeQuery', () => {
  it('pins the metric identity from amendment 9', () => {
    expect(logGroupVolumeQuery('/ecs/web', 'g0')).toEqual({
      id: 'g0', namespace: 'AWS/Logs', metricName: 'IncomingBytes', dimensions: { LogGroupName: '/ecs/web' }, stat: 'Sum',
    });
  });
});
```

Create `tests/unit/analysis-logs-dashboard.test.ts`:

```ts
it('asks one query per group covering both windows', async () => {
  const result = await logsDashboard(target, { range: '12h', nowMs: t, scope }, deps);
  const call = cw.commandCalls(GetMetricDataCommand)[0].args[0].input;
  expect(cw.commandCalls(GetMetricDataCommand)).toHaveLength(1);
  expect(call.MetricDataQueries).toHaveLength(2);                       // two seeded groups
  expect(call.StartTime).toEqual(new Date('2026-09-17T14:00:00Z'));     // 24 h for a 12 h window
  expect(call.EndTime).toEqual(new Date('2026-09-18T14:00:00Z'));
  expect(result.ok && result.data.rows[0].ingested.change.kind).toBe('up');
});

it('computes each group share of the total ingested bytes', async () => {
  const result = await logsDashboard(target, { range: '12h', nowMs: t, scope }, deps);
  expect(result.ok && result.data.rows.map((r) => r.sharePercent)).toEqual([80, 20]);
});

it('links each group to the search page, escaped', async () => {
  const result = await logsDashboard(target, { range: '12h', nowMs: t, scope }, deps);
  expect(result.ok && result.data.rows[0].searchHref)
    .toBe('/c/abc123def456/eu-west-1/logs/search?group=%2Fecs%2Fopswatch-web');
});

it('facets by retention and by volume band', async () => {
  const result = await logsDashboard(target, { range: '12h', nowMs: t, scope }, deps);
  expect(countFacets(result.ok ? result.data.rows : [], logFacetAccessors())).toEqual([
    { id: 'retention', values: [{ value: 'none', count: 1 }, { value: 'set', count: 1 }] },
    { id: 'volumeBand', values: [{ value: 'large', count: 1 }, { value: 'small', count: 1 }] },
  ]);
});

it('labels stored bytes as possibly lagging and never uses them as the volume', async () => {
  const result = await logsDashboard(target, { range: '12h', nowMs: t, scope }, deps);
  // storedBytes of the big group is deliberately 0 in the fixture: the volume must not follow it.
  expect(result.ok && result.data.rows[0].group.storedBytes).toBe(0);
  expect(result.ok && result.data.rows[0].ingested.current).toBeGreaterThan(0);
});

it('caps at 300 groups', async () => {
  const result = await logsDashboard(target, { range: '12h', nowMs: t, scope }, deps);   // 320 seeded
  expect(result.ok && result.data.dashboard.coverage).toEqual({ covered: 300, total: 320, truncated: true });
});
```

- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Write `listLogGroups`, `logGroupVolumeQuery`, `logs-dashboard.ts`, the page and the cards.**
- [ ] **Step 5: Flip the Logs sub-page order**

Leave `src/lib/monitoring/shared/sections.ts` as it is: `logs` stays `['search', 'volume', 'endpoints']` by controller ruling, because the owner opens Logs to search. Do not change `defaultSubsection('logs')` and update the comment Task 8 left so it states the ruling: Logs is the one section whose landing sub-page is not its dashboard, because the owner opens it to search. Every existing assertion that `/logs` redirects to `search` stays as it is.

- [ ] **Step 6: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Dashboards.logs.title` | `Volume` | `Volume` |
| `Dashboards.logs.description` | `What each log group of {region} ingested, and what it keeps.` | `Ce que chaque groupe de journaux de {region} a ingéré, et ce qu'il conserve.` |
| `Dashboards.logs.headline.total` | `Over the last {window}, {total} was ingested across {count, plural, one {# log group} other {# log groups}}.` | `Sur les {window} écoulées, {total} ont été ingérés sur {count, plural, one {# groupe de journaux} other {# groupes de journaux}}.` |
| `Dashboards.logs.headline.biggest` | `{group} alone accounts for {share} of it.` | `{group} en représente à lui seul {share}.` |
| `Dashboards.logs.headline.retention` | `{count, plural, =0 {Every group has a retention setting} one {# group keeps its logs forever} other {# groups keep their logs forever}}.` | `{count, plural, =0 {Tous les groupes ont une durée de conservation} one {# groupe conserve ses journaux indéfiniment} other {# groupes conservent leurs journaux indéfiniment}}.` |
| `Dashboards.logs.kpi.groups` | `Log groups` | `Groupes de journaux` |
| `Dashboards.logs.kpi.ingested` | `Ingested` | `Ingéré` |
| `Dashboards.logs.kpi.biggest` | `Biggest group: {group}` | `Plus gros groupe : {group}` |
| `Dashboards.logs.kpi.noRetention` | `Without retention` | `Sans conservation` |
| `Dashboards.logs.status.retained` | `{count} with retention` | `{count} avec conservation` |
| `Dashboards.logs.status.unretained` | `{count} without retention` | `{count} sans conservation` |
| `Dashboards.logs.facet.retention` | `Retention` | `Conservation` |
| `Dashboards.logs.facet.retentionSet` | `Set` | `Définie` |
| `Dashboards.logs.facet.retentionNone` | `Never expires` | `Jamais expirée` |
| `Dashboards.logs.facet.volumeBand` | `Volume` | `Volume` |
| `Dashboards.logs.band.tiny` | `Under 1 MiB` | `Moins de 1 Mio` |
| `Dashboards.logs.band.small` | `1 MiB to 1 GiB` | `1 Mio à 1 Gio` |
| `Dashboards.logs.band.large` | `1 GiB to 10 GiB` | `1 Gio à 10 Gio` |
| `Dashboards.logs.band.huge` | `Above 10 GiB` | `Plus de 10 Gio` |
| `Dashboards.logs.band.unknown` | `No data` | `Aucune donnée` |
| `Dashboards.logs.chartLabel` | `Ingested bytes over the window` | `Octets ingérés sur la fenêtre` |
| `Dashboards.logs.chartNote` | `The chart draws the selected window; the arrows compare it with the window of the same length before it.` | `Le graphique affiche la fenêtre choisie ; les flèches la comparent à la fenêtre de même durée qui la précède.` |
| `Dashboards.logs.topGroups` | `Biggest log groups` | `Plus gros groupes de journaux` |
| `Dashboards.logs.columns.group` | `Log group` | `Groupe de journaux` |
| `Dashboards.logs.columns.ingested` | `Ingested` | `Ingéré` |
| `Dashboards.logs.columns.share` | `Share` | `Part` |
| `Dashboards.logs.columns.stored` | `Stored` | `Stocké` |
| `Dashboards.logs.columns.retention` | `Retention` | `Conservation` |
| `Dashboards.logs.retentionDays` | `{days, plural, one {# day} other {# days}}` | `{days, plural, one {# jour} other {# jours}}` |
| `Dashboards.logs.retentionNone` | `Never expires` | `Jamais expirée` |
| `Dashboards.logs.storedNote` | `Stored size comes from DescribeLogGroups and can lag by several hours; the ingested column is the CloudWatch IncomingBytes metric.` | `La taille stockée provient de DescribeLogGroups et peut avoir plusieurs heures de retard ; la colonne « Ingéré » est la métrique CloudWatch IncomingBytes.` |
| `Dashboards.logs.openSearch` | `Search this group` | `Rechercher dans ce groupe` |
| `Dashboards.logs.noAutoRefresh` | `This page does not refresh on its own: it reads one metric per log group.` | `Cette page ne s'actualise pas seule : elle lit une métrique par groupe de journaux.` |
| `Dashboards.logs.notCoveredTitle` | `Log groups not covered` | `Groupes de journaux non couverts` |
| `Dashboards.logs.empty` | `This region has no log group.` | `Cette région n'a aucun groupe de journaux.` |

- [ ] **Step 7: Write the failing end-to-end test**

Add to `tests/e2e/09-dashboards.spec.ts`:

```ts
test('the logs section opens on the volume dashboard', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/logs`);
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/logs/search`);
});

test('the volume dashboard ranks the log groups and links each one to the search', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/logs/volume?range=12h`);
  await expect(page.getByRole('region', { name: 'What stands out' })).toContainText('was ingested across');
  await expect(page.getByText('Biggest log groups')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '/ecs/opswatch-web' });
  await expect(row).toContainText('1.2');            // 30 × 40 MiB, formatted as gibibytes
  await expect(row).toContainText('Never expires');
  await expect(row.getByRole('link', { name: 'Search this group' }))
    .toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/logs/search?group=%2Fecs%2Fopswatch-web`);
  await expect(page.getByText('Stored size comes from DescribeLogGroups', { exact: false })).toBeVisible();
});

test('the retention facet filters the groups table', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/logs/volume`);
  await page.getByRole('navigation', { name: 'Filters' }).getByRole('link', { name: 'Never expires' }).click();
  await expect(page).toHaveURL(/retention=none/);
  await expect(page.getByRole('row').filter({ hasText: '/aws/lambda/opswatch-e2e-worker' })).toHaveCount(0);
});
```

(If step 1's retention branch was taken, drop the `'Never expires'` facet click and the `retentionInDays` assertions from this spec and assert both groups as `Never expires` instead.)

- [ ] **Step 8: Run everything.** `npx vitest run`, then the full e2e command.
- [ ] **Step 9: Verify and commit.** Add `'lib/analysis/logs-dashboard.ts'` to `SERVER_ONLY_MODULES`. Run the five commands. Commit: `feat(logs): volume dashboard with ingested bytes, retention and per-group search`.

**moto limits:** moto's `storedBytes` reflects the three seeded log events, so it is a few hundred bytes while `IncomingBytes` says 1.2 GiB — which is exactly why amendment 9 separates them, and the e2e asserts the ingested column, never the stored one. `PutRetentionPolicy` support is probed in step 1 with a stated fallback.
**Owner-only verification:** that `IncomingBytes` and `storedBytes` agree well enough on their account for the "possibly lagging" note to read sensibly, and that 300 groups is enough for their region.

---

### Task 23: Endpoint field mapping storage

Implements the storage half of spec §3b: "the mapping is remembered per connection in the local database, never the log content".

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0001_<name>.sql` (generated, never hand-written)
- Create: `src/lib/connections/endpoint-mapping.ts`
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/logs/endpoints/actions.ts`
- Modify: `src/lib/monitoring/shared/logs-queries.ts` (presets and field validation)
- Create: `tests/unit/endpoint-mapping.test.ts`
- Modify: `tests/unit/db.test.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `sqliteTable`, `text`, `integer` from `drizzle-orm/sqlite-core`; `connections` from `@/lib/db/schema`; `Db`, `getDb` from `@/lib/db/client`; `requireAdmin` from `@/lib/auth/current`; `resolveLocale` from `@/i18n/routing`; `formString`, `formStrings` from `@/lib/forms/form-data`; `ActionState` from `@/lib/forms/action-state`; `checkSelection` from `@/lib/monitoring/selection`; `findConnection` from `@/lib/connections/repository`; `LOGS_MAX_GROUPS` from `@/lib/monitoring/logs`.
- Produces (`src/lib/db/schema.ts`):
  ```ts
  export const endpointMappings = sqliteTable('endpoint_mappings', {
    connectionId: text('connection_id').primaryKey().references(() => connections.id, { onDelete: 'cascade' }),
    routeField: text('route_field').notNull(),
    durationField: text('duration_field').notNull(),
    logGroups: text('log_groups', { mode: 'json' }).$type<string[]>().notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  });
  export type EndpointMappingRow = typeof endpointMappings.$inferSelect;
  ```
- Produces (`src/lib/connections/endpoint-mapping.ts`, server-only):
  - `export type EndpointMapping = { routeField: string; durationField: string; logGroups: string[] };`
  - `export class EndpointMappingError extends Error { constructor(public code: 'invalid_field' | 'no_groups' | 'too_many_groups') }`
  - `export function findEndpointMapping(db: Db, connectionId: string): EndpointMapping | null`
  - `export function saveEndpointMapping(db: Db, connectionId: string, mapping: EndpointMapping, now?: Date): EndpointMapping` — validates, then upserts by primary key.
- Produces (`src/lib/monitoring/shared/logs-queries.ts`, client-safe):
  - `export const LOG_FIELD_PATTERN = /^[A-Za-z_@][A-Za-z0-9_.@-]{0,127}$/;`
  - `export function isLogFieldName(value: string): boolean`
  - `export const ENDPOINT_PRESETS = { json: { routeField: 'path', durationField: 'duration_ms' }, gigsberg: { routeField: 'route', durationField: 'duration' } } as const;`
  - `export const ENDPOINT_PRESET_KEYS = Object.keys(ENDPOINT_PRESETS) as (keyof typeof ENDPOINT_PRESETS)[];`
- Produces (`…/logs/endpoints/actions.ts`, a server action):
  - `export type EndpointMappingState = ActionState<'invalid_field' | 'no_groups' | 'too_many_groups' | 'not_found', { values: EndpointMapping }>;`
  - `export async function saveEndpointMappingAction(locale: string, connectionId: string, region: string, _prev: EndpointMappingState, formData: FormData): Promise<EndpointMappingState>`

**The action's order, which is the Global Constraint in this shape:** `requireAdmin(resolveLocale(locale))` first (Next.js verifies the Origin of a Server Action itself, which is the mutating-request protection the constraint asks for); then `checkSelection(findConnection(getDb(), connectionId), region)` — a connection that is not found or not usable answers `not_found` and the action does nothing; then read the form, then `saveEndpointMapping`. It never calls AWS and never touches log content. On success it returns `{ status: 'success', values }` and the page re-renders with the new mapping.

**Validation, exactly:** `routeField` and `durationField` must each pass `isLogFieldName` after trimming — that is what keeps a field name from injecting into the Logs Insights query text (Task 24 wraps them in backticks and the pattern forbids a backtick). `logGroups` must hold at least one non-empty name of at most 512 characters and at most `LOGS_MAX_GROUPS` (20) of them, deduplicated in order. Anything else throws `EndpointMappingError` with the matching code.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/endpoint-mapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDb } from '@/lib/db/client';
import { createConnection } from '@/lib/connections/repository';
import { EndpointMappingError, findEndpointMapping, saveEndpointMapping } from '@/lib/connections/endpoint-mapping';
import { ENDPOINT_PRESETS, isLogFieldName } from '@/lib/monitoring/shared/logs-queries';

const setup = () => {
  const db = createDb(':memory:');
  const row = createConnection(db, { name: 'Prod', method: 'ambient', awsAccountId: '123456789012', regions: ['eu-west-1'] });
  return { db, id: row.id };
};

describe('isLogFieldName', () => {
  it('accepts the field names a JSON log uses', () => {
    expect(['path', 'duration_ms', 'route', '@message', 'http.route', 'a-b'].every(isLogFieldName)).toBe(true);
  });
  it('refuses anything that could escape the query text', () => {
    expect(['', '1st', 'a b', 'a`b', "a'b", 'a|b', '/x', 'a'.repeat(129)].some(isLogFieldName)).toBe(false);
  });
});

describe('the presets', () => {
  it('offers JSON logs and this owner API format', () => {
    expect(ENDPOINT_PRESETS).toEqual({ json: { routeField: 'path', durationField: 'duration_ms' }, gigsberg: { routeField: 'route', durationField: 'duration' } });
  });
});

describe('saveEndpointMapping', () => {
  it('stores the mapping per connection and reads it back', () => {
    const { db, id } = setup();
    expect(findEndpointMapping(db, id)).toBeNull();
    saveEndpointMapping(db, id, { routeField: 'route', durationField: 'duration', logGroups: ['/ecs/api', '/ecs/api', '/ecs/web'] });
    expect(findEndpointMapping(db, id)).toEqual({ routeField: 'route', durationField: 'duration', logGroups: ['/ecs/api', '/ecs/web'] });
  });
  it('overwrites the previous mapping of the same connection', () => {
    const { db, id } = setup();
    saveEndpointMapping(db, id, { routeField: 'route', durationField: 'duration', logGroups: ['/a'] });
    saveEndpointMapping(db, id, { routeField: 'path', durationField: 'duration_ms', logGroups: ['/b'] });
    expect(findEndpointMapping(db, id)?.routeField).toBe('path');
  });
  it('refuses a field name that is not a field name, and an empty or oversized group list', () => {
    const { db, id } = setup();
    expect(() => saveEndpointMapping(db, id, { routeField: 'a b', durationField: 'duration', logGroups: ['/a'] })).toThrow(EndpointMappingError);
    expect(() => saveEndpointMapping(db, id, { routeField: 'route', durationField: 'duration', logGroups: [] })).toThrow(EndpointMappingError);
    expect(() => saveEndpointMapping(db, id, { routeField: 'route', durationField: 'duration', logGroups: Array.from({ length: 21 }, (_, i) => `/g${i}`) })).toThrow(EndpointMappingError);
  });
  it('stores no log content, only field names and group names', () => {
    const { db, id } = setup();
    saveEndpointMapping(db, id, { routeField: 'route', durationField: 'duration', logGroups: ['/a'] });
    const raw = db.$client.prepare('select * from endpoint_mappings').all();
    expect(Object.keys(raw[0] as object).sort()).toEqual(['connection_id', 'duration_field', 'log_groups', 'route_field', 'updated_at']);
  });
  it('disappears with its connection', () => {
    const { db, id } = setup();
    saveEndpointMapping(db, id, { routeField: 'route', durationField: 'duration', logGroups: ['/a'] });
    db.$client.prepare('delete from connections where id = ?').run(id);
    expect(findEndpointMapping(db, id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `npx vitest run tests/unit/endpoint-mapping.test.ts` → FAIL, no table and no module.

- [ ] **Step 3: Add the table and generate the migration**

Edit `src/lib/db/schema.ts`, then run `npm run db:generate`.
Expected: a new file under `drizzle/` named `0001_*.sql` containing `CREATE TABLE \`endpoint_mappings\`` with the foreign key and `on delete cascade`, plus an updated `drizzle/meta/_journal.json`. **Never hand-edit the generated SQL.** `createDb` runs `migrate()` on every open, so nothing else is needed for the migration to apply.

- [ ] **Step 4: Write the module, the validation and the action.**

- [ ] **Step 5: Add the messages** (used by Task 24's form; added now so parity holds)

| Key | EN | FR |
|---|---|---|
| `Monitoring.endpoints.mapping.title` | `Field mapping` | `Correspondance des champs` |
| `Monitoring.endpoints.mapping.description` | `Tell OpsWatch which log field holds the route and which holds the duration in milliseconds. Only the field names are stored, never the log content.` | `Indiquez à OpsWatch quel champ de journal contient la route et lequel contient la durée en millisecondes. Seuls les noms de champs sont enregistrés, jamais le contenu des journaux.` |
| `Monitoring.endpoints.mapping.routeField` | `Route field` | `Champ route` |
| `Monitoring.endpoints.mapping.durationField` | `Duration field, in milliseconds` | `Champ durée, en millisecondes` |
| `Monitoring.endpoints.mapping.logGroups` | `Log groups` | `Groupes de journaux` |
| `Monitoring.endpoints.mapping.save` | `Save the mapping` | `Enregistrer la correspondance` |
| `Monitoring.endpoints.mapping.saved` | `Mapping saved.` | `Correspondance enregistrée.` |
| `Monitoring.endpoints.mapping.presets` | `Presets` | `Préréglages` |
| `Monitoring.endpoints.mapping.preset.json` | `JSON logs (path, duration_ms)` | `Journaux JSON (path, duration_ms)` |
| `Monitoring.endpoints.mapping.preset.gigsberg` | `These APIs (route, duration)` | `Ces API (route, duration)` |
| `Monitoring.endpoints.errors.invalid_field` | `A field name may only hold letters, digits, dots, dashes, underscores and @, and must start with a letter, an underscore or @.` | `Un nom de champ ne peut contenir que des lettres, des chiffres, des points, des tirets, des soulignés et @, et doit commencer par une lettre, un souligné ou @.` |
| `Monitoring.endpoints.errors.no_groups` | `Pick at least one log group.` | `Choisissez au moins un groupe de journaux.` |
| `Monitoring.endpoints.errors.too_many_groups` | `You can query up to {count} log groups at a time.` | `Vous pouvez interroger jusqu'à {count} groupes de journaux à la fois.` |
| `Monitoring.endpoints.errors.not_found` | `This connection or region is no longer available.` | `Cette connexion ou cette région n'est plus disponible.` |

- [ ] **Step 6: Run the tests.** `npx vitest run tests/unit/endpoint-mapping.test.ts tests/unit/db.test.ts tests/unit/module-boundaries.test.ts tests/unit/i18n-messages.test.ts`. Add `'lib/connections/endpoint-mapping.ts'` to `SERVER_ONLY_MODULES`. `logs-queries.ts` stays client-safe and must not gain a server-only import — the boundary test proves it.

- [ ] **Step 7: Verify and commit.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`. Commit: `feat(logs): store the endpoint field mapping per connection`.

**moto limits:** none — this task touches only SQLite.
**Owner-only verification:** none, but the preset named `gigsberg` must match the field names their APIs actually log; Task 24's e2e proves the mapping round-trips, not that it matches their format.

---

### Task 24: Logs → Endpoints page

Implements the query half of spec §3b: one Logs Insights query over the window, statistics on the duration field grouped by the route field, count, average, p95 and maximum, sorted by p95, limited to 50 rows, rendered as top-N bars plus a table, with the scanned bytes stated and an honest empty state.

**Files:**
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/logs/endpoints/page.tsx`, `…/endpoints/mapping-form.tsx` (client), `…/endpoints/endpoints-panel.tsx` (client)
- Modify: `src/lib/monitoring/shared/logs-queries.ts` (the query builders)
- Create: `tests/unit/logs-endpoint-queries.test.ts`
- Modify: `src/i18n/client-messages.ts` is unchanged (`Monitoring.client` already covers it), `tests/e2e/08-analysis.spec.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `createLogsApi`, `LogsApi`, `ClientQueryResults` from `@/lib/monitoring/shared/logs-api`; `runLogsQuery`, `PollOutcome` from `@/lib/monitoring/shared/logs-poller`; `LOGS_TIME_RANGES`, `LogsTimeRange`, `LOGS_MAX_ROWS` from `@/lib/monitoring/shared/logs-queries`; `LOGS_MAX_GROUPS` from `@/lib/monitoring/logs`; `findEndpointMapping` from `@/lib/connections/endpoint-mapping`; `saveEndpointMappingAction` from `./actions`; `ENDPOINT_PRESETS`, `isLogFieldName` from `@/lib/monitoring/shared/logs-queries`; `TopNBars`, `DenseTable` from the components; `searchLogGroups` from `@/lib/monitoring/logs` (to offer the group checkboxes in the form).
- Produces (added to `src/lib/monitoring/shared/logs-queries.ts`):
  - `export const ENDPOINT_ROW_LIMIT = 50;`
  - `export function endpointStatsQuery(routeField: string, durationField: string): string`
  - `export function endpointSampleQuery(): string`
  - `export type EndpointRow = { route: string; requests: number; avgMs: number | null; p95Ms: number | null; maxMs: number | null };`
  - `export function parseEndpointRows(results: ClientQueryResults): EndpointRow[]`

**The two queries, written once** (Logs Insights syntax is never translated):

```ts
/** Field names come from the user, so they are validated with isLogFieldName before they ever reach this. */
export function endpointStatsQuery(routeField: string, durationField: string): string {
  if (!isLogFieldName(routeField) || !isLogFieldName(durationField)) throw new Error('invalid field name');
  return [
    `filter ispresent(\`${routeField}\`) and ispresent(\`${durationField}\`)`,
    `stats count(*) as requests, avg(\`${durationField}\`) as avgMs, pct(\`${durationField}\`, 95) as p95Ms, max(\`${durationField}\`) as maxMs by \`${routeField}\` as route`,
    `sort p95Ms desc`,
    `limit ${ENDPOINT_ROW_LIMIT}`,
  ].join(' | ');
}

/** Shown when the mapping matched nothing, so the user can read the field names off real lines (spec §3b). */
export function endpointSampleQuery(): string {
  return 'fields @timestamp, @message | sort @timestamp desc | limit 5';
}
```

`parseEndpointRows` maps the returned rows by field name (`route`, `requests`, `avgMs`, `p95Ms`, `maxMs`), parsing each number with `Number(value)` and turning a non-finite result into `null`; `requests` falls back to `0`. Rows whose `route` is missing or empty are dropped.

**The page:**
1. `initMonitoringRoute(params)` first, then `findEndpointMapping(getDb(), connectionId)` — a database read, no AWS.
2. `SectionLayout` with `section="logs"`, `subsection="endpoints"`, `range` from `LOGS_TIME_RANGES` (default `1h`), `ranges={LOGS_TIME_RANGES}`, `autoRefresh={false}`.
3. The `MappingForm` (client, `useActionState` over `saveEndpointMappingAction` bound to locale, connection and region) with the two field inputs, the two preset buttons that fill them without submitting, and the log-group checkboxes fed by a server-rendered `searchLogGroups` list. It is the `filters` row of the layout.
4. The `EndpointsPanel` (client) runs the query through the existing route handlers with `runLogsQuery`, exactly as the Search page's panel does — **no new API route** — and renders, on completion: the `TopNBars` of the ten slowest routes by p95, then the `DenseTable` of all rows (`route`, `requests`, `avgMs`, `p95Ms`, `maxMs`), then the billing line `Monitoring.client.endpoints.scanned` with the scanned bytes and the reminder that Logs Insights is billed per scanned gigabyte.
5. When the stats query completes with **zero** rows, the panel automatically runs `endpointSampleQuery()` over the same groups and window and shows the five lines it got, under `Monitoring.client.endpoints.noMatch` — that is spec §3b's "the page says so and shows the first lines it saw, so the user can fix the field names rather than guess".
6. Without a saved mapping the panel renders nothing and the form shows `Monitoring.endpoints.mapping.needed`.

The 24-hour cap, the 1000-row cap, the 20-group cap and the 60-second client timeout are all inherited from the existing route handlers and poller; the page adds none of its own.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/logs-endpoint-queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ENDPOINT_ROW_LIMIT, endpointSampleQuery, endpointStatsQuery, parseEndpointRows } from '@/lib/monitoring/shared/logs-queries';

describe('endpointStatsQuery', () => {
  it('builds the statistics query the spec describes', () => {
    expect(endpointStatsQuery('route', 'duration')).toBe(
      'filter ispresent(`route`) and ispresent(`duration`) | ' +
      'stats count(*) as requests, avg(`duration`) as avgMs, pct(`duration`, 95) as p95Ms, max(`duration`) as maxMs by `route` as route | ' +
      'sort p95Ms desc | limit 50',
    );
    expect(ENDPOINT_ROW_LIMIT).toBe(50);
  });
  it('works with the JSON preset field names', () => {
    expect(endpointStatsQuery('path', 'duration_ms')).toContain('by `path` as route');
  });
  it('refuses a field name that could escape the query', () => {
    expect(() => endpointStatsQuery('a`b', 'duration')).toThrow();
    expect(() => endpointStatsQuery('route', 'x | stats count(*)')).toThrow();
  });
});

describe('endpointSampleQuery', () => {
  it('asks for five recent lines and nothing else', () => {
    expect(endpointSampleQuery()).toBe('fields @timestamp, @message | sort @timestamp desc | limit 5');
  });
});

describe('parseEndpointRows', () => {
  const results = (rows: Record<string, string>[]) => ({ status: 'Complete', fields: [], rows, statistics: { recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 } });
  it('reads the five columns and keeps the order AWS returned', () => {
    expect(parseEndpointRows(results([
      { route: '/api/orders', requests: '1200', avgMs: '85.4', p95Ms: '410.2', maxMs: '2300' },
      { route: '/health', requests: '9000', avgMs: '2', p95Ms: '4', maxMs: '18' },
    ]))).toEqual([
      { route: '/api/orders', requests: 1200, avgMs: 85.4, p95Ms: 410.2, maxMs: 2300 },
      { route: '/health', requests: 9000, avgMs: 2, p95Ms: 4, maxMs: 18 },
    ]);
  });
  it('turns an unparsable number into null and a missing count into zero', () => {
    expect(parseEndpointRows(results([{ route: '/x', requests: '', avgMs: 'n/a', p95Ms: '1', maxMs: '2' }])))
      .toEqual([{ route: '/x', requests: 0, avgMs: null, p95Ms: 1, maxMs: 2 }]);
  });
  it('drops a row with no route', () => {
    expect(parseEndpointRows(results([{ requests: '1', avgMs: '1', p95Ms: '1', maxMs: '1' }, { route: '', requests: '1' }]))).toEqual([]);
  });
  it('returns nothing for an empty result', () => {
    expect(parseEndpointRows(results([]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write the query builders, the page, the form and the panel.**
- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Monitoring.endpoints.title` | `Endpoints` | `Points d'entrée` |
| `Monitoring.endpoints.description` | `The slowest routes of your applications, read from their own logs.` | `Les routes les plus lentes de vos applications, lues dans leurs propres journaux.` |
| `Monitoring.endpoints.why` | `CloudWatch reports latency per target group, never per path, so this reads your application logs instead.` | `CloudWatch fournit la latence par groupe cible, jamais par chemin : cette page lit donc vos journaux applicatifs.` |
| `Monitoring.endpoints.mapping.needed` | `Set the field mapping to run this query.` | `Définissez la correspondance des champs pour lancer cette requête.` |
| `Monitoring.client.endpoints.run` | `Find the slowest routes` | `Trouver les routes les plus lentes` |
| `Monitoring.client.endpoints.running` | `Scanning… {seconds} s` | `Analyse… {seconds} s` |
| `Monitoring.client.endpoints.topLabel` | `Slowest routes by p95` | `Routes les plus lentes par p95` |
| `Monitoring.client.endpoints.columns.route` | `Route` | `Route` |
| `Monitoring.client.endpoints.columns.requests` | `Requests` | `Requêtes` |
| `Monitoring.client.endpoints.columns.avgMs` | `Average` | `Moyenne` |
| `Monitoring.client.endpoints.columns.p95Ms` | `p95` | `p95` |
| `Monitoring.client.endpoints.columns.maxMs` | `Maximum` | `Maximum` |
| `Monitoring.client.endpoints.scanned` | `Scanned {bytes} in {groups, plural, one {# log group} other {# log groups}}. CloudWatch Logs Insights is billed per gigabyte scanned.` | `{bytes} analysés dans {groups, plural, one {# groupe de journaux} other {# groupes de journaux}}. CloudWatch Logs Insights est facturé par gigaoctet analysé.` |
| `Monitoring.client.endpoints.noMatch` | `No line carried both fields. Here are the most recent lines, so you can read the right field names off them.` | `Aucune ligne ne contenait les deux champs. Voici les lignes les plus récentes, pour y lire les bons noms de champs.` |
| `Monitoring.client.endpoints.sampleLabel` | `Recent lines` | `Lignes récentes` |
| `Monitoring.client.endpoints.empty` | `The log groups held no line over this window.` | `Les groupes de journaux ne contenaient aucune ligne sur cette fenêtre.` |

- [ ] **Step 5: Write the failing end-to-end test**

```ts
test('the endpoints page explains itself, saves a mapping and reports what it scanned', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/logs/endpoints`);
  await expect(page.getByText('CloudWatch reports latency per target group', { exact: false })).toBeVisible();
  await expect(page.getByText('Set the field mapping to run this query.')).toBeVisible();

  await page.getByRole('button', { name: 'These APIs (route, duration)' }).click();
  await expect(page.getByLabel('Route field')).toHaveValue('route');
  await expect(page.getByLabel('Duration field, in milliseconds')).toHaveValue('duration');
  await page.getByRole('checkbox', { name: '/ecs/opswatch-web' }).check();
  await page.getByRole('button', { name: 'Save the mapping' }).click();
  await expect(page.getByText('Mapping saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Route field')).toHaveValue('route');   // remembered per connection

  await page.getByRole('button', { name: 'Find the slowest routes' }).click();
  // moto ignores filter, parse and stats commands (fact 10): the query completes but aggregates nothing,
  // so the page falls back to showing the recent lines, which is exactly the state spec §3b describes.
  await expect(page.getByText('No line carried both fields.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent lines' })).toContainText('GET /api/orders 500 1520ms');
  await expect(page.getByText(/Scanned .* in 1 log group\./)).toBeVisible();
});

test('the endpoints page refuses a field name that is not one', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/logs/endpoints`);
  await page.getByLabel('Route field').fill('a b');
  await page.getByLabel('Duration field, in milliseconds').fill('duration');
  await page.getByRole('checkbox', { name: '/ecs/opswatch-web' }).check();
  await page.getByRole('button', { name: 'Save the mapping' }).click();
  await expect(page.getByText('A field name may only hold letters', { exact: false })).toBeVisible();
});
```

- [ ] **Step 6: Run everything.**
- [ ] **Step 7: Verify and commit.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`. Commit: `feat(logs): slowest endpoints from the application logs`.

**moto limits:** fact 10 — moto ignores `filter`, `parse` **and `stats`**, returning every event in range instead of an aggregate, so a populated endpoint table is impossible end to end. The spec above asserts the honest fallback state and the scanned-bytes line, and `parseEndpointRows` is unit-tested against real-shaped rows.
**Owner-only verification:** that the `gigsberg` preset's `route` and `duration` match their APIs, that the table populates, and that the scanned volume is acceptable for the windows they use.

---

### Task 25: Overview dashboard

Implements spec §9.2's Overview row: one card per category with its headline numbers and its worst finding, each linking to that category's dashboard, plus the insights list and a link to the audit.

**Files:**
- Create: `src/lib/analysis/overview-dashboard.ts`
- Modify: `src/app/[locale]/(app)/c/[connectionId]/[region]/overview/insights/page.tsx`, `…/insights/cards.tsx`
- Create: `tests/unit/analysis-overview-dashboard.test.ts`
- Modify: `tests/e2e/09-dashboards.spec.ts`, `tests/e2e/06-monitoring.spec.ts`, `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `INSIGHT_FAMILIES`, `InsightFamily`, `FamilySummary`, `loadFamily` from `@/lib/monitoring/overview`; `Insight`, `sortInsights`, `InsightSeverity` from `@/lib/monitoring/insights`; `subsectionPath` from `@/lib/monitoring/shared/paths`; `InsightList` from `@/components/monitoring/insight-list`; `Tone` from `@/lib/ui/tones`.
- Produces (`src/lib/analysis/overview-dashboard.ts`):
  - `export type CategoryCard = { family: InsightFamily; total: number; affected: number; worst: Insight | null; tone: Tone; href: string };`
  - `export const FAMILY_SUBSECTION: Record<InsightFamily, { section: MonitoringSection; subsection: string }>` = `{ ecs: { section: 'containers', subsection: 'services' }, rds: { section: 'databases', subsection: 'instances' }, alb: { section: 'load-balancers', subsection: 'list' }, alarms: { section: 'alarms', subsection: 'list' } }`
  - `export function categoryCard(family: InsightFamily, summary: FamilySummary, scope: ScopeRef): CategoryCard`
  - `export function worstInsight(insights: readonly Insight[]): Insight | null` — `sortInsights(insights)[0] ?? null`, so "worst" means the same ordering the insights list already uses (critical, then warning, then info; then kind; then resource).

**Cost:** unchanged from Stage 2. Each category card is still one `loadFamily(family, target, nowMs)` in its own `<Suspense>`, sharing `recentWindow(INSIGHT_FETCH_MINUTES, nowMs)` and therefore sharing every cache entry with the category dashboards. The Overview adds **no** AWS call; it only renders more of what it already fetched.

**The card:** the category name, `affected` of `total` as its headline number (`Dashboards.overview.card.<family>.summary`), the worst finding rendered through the same `Insights.<messageKey>` machinery the insights list uses (so there is one wording for one finding, in one place), or `Dashboards.overview.card.clear` when there is none, and the whole card is a `<Link>` to `subsectionPath(scope, section, subsection)`. `tone` is `danger` when the worst insight is `critical`, `warning` when it is `warning`, `info` when it is `info`, and `success` when there is none.

**Below the cards:** the existing insights list, unchanged except for Task 12's `windowLabel={t('Insights.window.live')}` prop, and a prominent `<Link>` to `subsectionPath(scope, 'overview', 'audit')` labelled `Dashboards.overview.auditLink` with `Dashboards.overview.auditHint` under it.

- [ ] **Step 1: Write the failing unit test**

```ts
import { categoryCard, FAMILY_SUBSECTION, worstInsight } from '@/lib/analysis/overview-dashboard';

const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };
const insight = (severity: InsightSeverity, kind: string, resource: string) => ({ severity, kind, resource, messageKey: `messages.${kind}`, values: {}, href: '/x' });

describe('worstInsight', () => {
  it('picks the most severe, then the first by kind and resource', () => {
    expect(worstInsight([insight('warning', 'ecs_cpu_high', 'b'), insight('critical', 'ecs_rollout_failed', 'a')])?.severity).toBe('critical');
    expect(worstInsight([insight('warning', 'ecs_memory_high', 'b'), insight('warning', 'ecs_cpu_high', 'z')])?.kind).toBe('ecs_cpu_high');
    expect(worstInsight([])).toBeNull();
  });
});

describe('categoryCard', () => {
  it('links each family to its dashboard, not to a bare section', () => {
    expect(FAMILY_SUBSECTION.alb).toEqual({ section: 'load-balancers', subsection: 'list' });
    expect(categoryCard('alb', { insights: [], total: 3, affected: 0 }, scope).href)
      .toBe('/c/abc123def456/eu-west-1/load-balancers/list');
    expect(categoryCard('ecs', { insights: [], total: 3, affected: 0 }, scope).href)
      .toBe('/c/abc123def456/eu-west-1/containers/services');
  });
  it('tones the card by its worst finding', () => {
    expect(categoryCard('ecs', { insights: [], total: 3, affected: 0 }, scope).tone).toBe('success');
    expect(categoryCard('ecs', { insights: [insight('warning', 'ecs_cpu_high', 'a')], total: 3, affected: 1 }, scope).tone).toBe('warning');
    expect(categoryCard('ecs', { insights: [insight('critical', 'ecs_rollout_failed', 'a')], total: 3, affected: 1 }, scope).tone).toBe('danger');
    expect(categoryCard('ecs', { insights: [insight('info', 'alarm_firing', 'a')], total: 3, affected: 1 }, scope).tone).toBe('info');
  });
  it('carries the worst finding itself, so the card and the list agree word for word', () => {
    const worst = insight('critical', 'ecs_rollout_failed', 'a');
    expect(categoryCard('ecs', { insights: [insight('warning', 'ecs_cpu_high', 'b'), worst], total: 3, affected: 2 }, scope).worst).toEqual(worst);
  });
  it('covers every family', () => {
    expect(Object.keys(FAMILY_SUBSECTION).sort()).toEqual(['alarms', 'alb', 'ecs', 'rds']);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write the module and rebuild the Overview cards.** Keep the four `<Suspense>` boundaries and the existing `SummaryCard` streaming; only the card's contents and its link change.
- [ ] **Step 4: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Dashboards.overview.title` | `Overview` | `Vue d'ensemble` |
| `Dashboards.overview.description` | `Every category of {connection} in {region}, worst first.` | `Toutes les catégories de {connection} dans {region}, les pires d'abord.` |
| `Dashboards.overview.cardsLabel` | `Categories` | `Catégories` |
| `Dashboards.overview.card.ecs.title` | `Containers` | `Conteneurs` |
| `Dashboards.overview.card.ecs.summary` | `{affected} of {total, plural, one {# service} other {# services}} need attention` | `{affected} service(s) sur {total} à surveiller` |
| `Dashboards.overview.card.rds.title` | `Databases` | `Bases de données` |
| `Dashboards.overview.card.rds.summary` | `{affected} of {total, plural, one {# instance} other {# instances}} need attention` | `{affected} instance(s) sur {total} à surveiller` |
| `Dashboards.overview.card.alb.title` | `Load balancers` | `Répartiteurs de charge` |
| `Dashboards.overview.card.alb.summary` | `{affected} of {total, plural, one {# load balancer} other {# load balancers}} return errors` | `{affected} répartiteur(s) sur {total} renvoient des erreurs` |
| `Dashboards.overview.card.alarms.title` | `Alarms` | `Alarmes` |
| `Dashboards.overview.card.alarms.summary` | `{affected} of {total, plural, one {# alarm} other {# alarms}} in ALARM` | `{affected} alarme(s) sur {total} en ALARM` |
| `Dashboards.overview.card.clear` | `Nothing is firing here.` | `Rien ne se déclenche ici.` |
| `Dashboards.overview.card.open` | `Open the dashboard` | `Ouvrir le tableau de bord` |
| `Dashboards.overview.auditLink` | `Run the audit` | `Lancer l'audit` |
| `Dashboards.overview.auditHint` | `A catalogue of checks over the last 24 hours, with the evidence behind each finding.` | `Un catalogue de contrôles sur les 24 dernières heures, avec les preuves de chaque constat.` |

The FR `summary` strings deliberately use "service(s) sur {total}" rather than a nested plural: `{affected}` and `{total}` vary independently, and a French sentence that agrees with both needs a nested `plural` on each, which reads worse than the parenthesised form the owner's own French UI already uses elsewhere. If the owner prefers a nested plural, the keys change and nothing else does.

- [ ] **Step 5: Write the failing end-to-end test**

```ts
test('the overview shows one card per category, each linking to its dashboard, plus the audit link', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/overview/insights`);
  const cards = page.getByRole('region', { name: 'Categories' });
  await expect(cards.getByRole('link', { name: /Containers/ })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/containers/services`);
  await expect(cards.getByRole('link', { name: /Databases/ })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/instances`);
  await expect(cards.getByRole('link', { name: /Load balancers/ })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/load-balancers/list`);
  await expect(cards.getByRole('link', { name: /Alarms/ })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/alarms/list`);
  await expect(cards).toContainText('in ALARM');
  await expect(page.getByRole('link', { name: 'Run the audit' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/overview/audit`);
});
```

- [ ] **Step 6: Run everything.**
- [ ] **Step 7: Verify and commit.** Add `'lib/analysis/overview-dashboard.ts'` to `SERVER_ONLY_MODULES`. Run the five commands. Commit: `feat(overview): category cards with their worst finding and an audit link`.

**moto limits:** the seeded alarm in `ALARM` makes the Alarms card the one that reliably shows a worst finding; the ECS and RDS cards depend on the seeded metric values and are asserted only for their links and their summary shape.
**Owner-only verification:** that the four cards give them the "what is wrong right now" read they asked for.

---

### Task 26: Audit check catalogue

Implements spec §4's catalogue as pure functions over already-fetched data, with amendment 7's arithmetic (share of the window and worst stretch, not "is it breaching right now"), amendment 8's dropped and softened checks, amendment 9's metric identity and amendment 11's 500-query budget.

**Files:**
- Create: `src/lib/analysis/audit.ts`
- Modify: `src/lib/monitoring/instance-memory.ts` (add `instanceVCpus`)
- Create: `tests/unit/analysis-audit.test.ts`
- Modify: `tests/unit/module-boundaries.test.ts`, `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `listClusters`, `listServices`, `serviceUtilizationQueries` from `@/lib/monitoring/ecs`; `listDatabases`, `rdsMetricQueries` from `@/lib/monitoring/rds`; `instanceMemoryGiB`, `instanceVCpus` from `@/lib/monitoring/instance-memory`; `listLoadBalancers`, `listTargetGroups`, `targetHealth`, `loadBalancerQueries`, `targetGroupQueries`, `summarizeTargetGroupHealth`, `MAX_TARGET_GROUPS_WITH_HEALTH` from `@/lib/monitoring/elb`; `listAlarms`, `AlarmSummary` from `@/lib/monitoring/alarms`; `listLogGroups`, `logGroupVolumeQuery` from `@/lib/monitoring/logs`; `topDimensionKeys`, `FLEET_SQL_LIMIT` from `@/lib/monitoring/pi`; `piWindow` from `@/lib/monitoring/pi`; `doubleWindow`, `splitSeries`, `aggregateSeries` from `@/lib/analysis/window`; `capResources`, `coverageOf`, `notCovered`, `notCoveredFromFailure`, `sortNotCovered`, `AUDIT_BUDGET`, `AUDIT_QUERIES_PER`, `AUDIT_METRIC_QUERY_CAP`, `AUDIT_MAX_PI_CALLS` from `@/lib/analysis/coverage`; `findConnection` from `@/lib/connections/repository`; `PermissionTestResult`, `ServiceCheck` from `@/lib/aws/permission-types`; `GIB` from `@/lib/monitoring/shared/format`; `subsectionPath`, `permissionsPath` from `@/lib/monitoring/shared/paths`.
- Produces:
  - `export const AUDIT_RANGE_SECONDS = 86_400;` and `export const AUDIT_PERIOD_SECONDS = 300;` and `export const AUDIT_LOG_PERIOD_SECONDS = 3600;`
  - `export const AUDIT_SHARE_PERCENT = 10;` and `export const AUDIT_STRETCH_MINUTES = 15;`
  - `export const AUDIT_ELB_5XX = { warning: 100, critical: 1000 } as const;` — the live rule's 10 and 100 are tuned to 15 minutes; over 24 hours they would fire on nothing.
  - `export const AUDIT_MIN_REQUESTS = 1000;` — below this a percentage of 5xx means nothing.
  - `export const AUDIT_MIN_LOG_BYTES = 104_857_600;` (100 MiB) — the floor under the ingestion-spike check.
  - `export const LOG_RETENTION_MIN_BYTES = 1_073_741_824;` (1 GiB) — amendment 8's size gate under the retention check.
  - `export const RDS_AUDIT_CPU_THRESHOLD = 80;` and `export const ECS_AUDIT_UTILIZATION_THRESHOLD = 85;` and `export const FREEABLE_MEMORY_PERCENT_THRESHOLD = 5;` and `export const REPLICA_LAG_MS_THRESHOLD = 1000;` — spelled out rather than reused from `insights.ts`, because amendment 7 makes the audit's arithmetic different from the live rules even where the number is the same.
  - `export type AuditSeverity = 'critical' | 'warning' | 'info';`
  - `export type AuditCheckId = …` (the 22 ids of the table below)
  - `export type AuditFinding = { id: AuditCheckId; severity: AuditSeverity; resource: string; values: Record<string, string | number>; evidence: Record<string, string | number>; href: string | null };`
  - `export type AuditSkip = { id: AuditCheckId; reason: 'denied' | 'throttled' | 'error' | 'cap' | 'unavailable'; code: string | null; action: string | null };`
  - `export type AuditResult = { findings: AuditFinding[]; skipped: AuditSkip[]; notCovered: NotCovered[]; coverage: Record<'ecs' | 'rds' | 'alb' | 'logs' | 'alarms', Coverage>; window: { start: Date; end: Date }; metricQueriesUsed: number };`
  - `export type BreachProfile = { sharePercent: number; worstStretchMinutes: number; worstValue: number | null; datapoints: number };`
  - `export function breachProfile(series: SeriesData, threshold: number, direction: 'above' | 'below', periodSeconds: number): BreachProfile`
  - `export function fires(profile: BreachProfile, options?: { sharePercent?: number; stretchMinutes?: number }): boolean`
  - `export function sortFindings(findings: readonly AuditFinding[]): AuditFinding[]`
  - `export function runAudit(target: AwsTarget, options: { nowMs: number; connectionId: string; lastTest: PermissionTestResult | null; scope: ScopeRef }, deps?: MonitoringDeps): Promise<MonitoringResult<AuditResult>>`
- Produces (`instance-memory.ts`):
  - `export function instanceVCpus(instanceClass: string): number | null`

**Amendment 7's arithmetic, written once:**

```ts
/**
 * Over a 24-hour window the audit asks two questions the live rules never ask: how much of the window was
 * spent breaching, and how long the worst uninterrupted stretch was. A service pegged for eighteen hours and
 * calm in the last minutes is still reported, which "is it breaching right now" would miss.
 */
export function breachProfile(series: SeriesData, threshold: number, direction: 'above' | 'below', periodSeconds: number): BreachProfile {
  const datapoints = series.values.length;
  if (datapoints === 0) return { sharePercent: 0, worstStretchMinutes: 0, worstValue: null, datapoints: 0 };
  const breaching = (v: number) => (direction === 'above' ? v > threshold : v < threshold);
  let breachingCount = 0;
  let run = 0;
  let longestRun = 0;
  for (const value of series.values) {
    if (breaching(value)) {
      breachingCount += 1;
      run += 1;
      if (run > longestRun) longestRun = run;
    } else {
      run = 0;
    }
  }
  return {
    sharePercent: (breachingCount / datapoints) * 100,
    worstStretchMinutes: (longestRun * periodSeconds) / 60,
    // "Peak" here is the worst five-minute average, not a true instantaneous peak: asking CloudWatch for
    // Maximum as well would double the audit's query cost. The findings say "at worst" for that reason.
    worstValue: direction === 'above' ? Math.max(...series.values) : Math.min(...series.values),
    datapoints,
  };
}

/** The default gate: a tenth of the window, or one quarter-hour without relief. */
export function fires(profile: BreachProfile, options: { sharePercent?: number; stretchMinutes?: number } = {}): boolean {
  if (profile.datapoints === 0) return false;
  return profile.sharePercent >= (options.sharePercent ?? AUDIT_SHARE_PERCENT)
    || profile.worstStretchMinutes >= (options.stretchMinutes ?? AUDIT_STRETCH_MINUTES);
}
```

At `AUDIT_PERIOD_SECONDS = 300`, `AUDIT_STRETCH_MINUTES = 15` is exactly three consecutive datapoints, and a 24-hour window holds 288 of them.

**The catalogue.** Every check, its trigger, its severity and its evidence. `nowMs` comes from the page; the window is `[nowMs floored to 300 s − 24 h, nowMs floored to 300 s]`.

| id | Group | Fires when | Severity | Evidence |
|---|---|---|---|---|
| `ecs_tasks_below_desired` | Availability | `runningCount < desiredCount` and the primary deployment's `updatedAt` is at least 10 min old | critical | `running`, `desired` |
| `ecs_deployment_failed` | Availability | primary deployment `rolloutState === 'FAILED'` | critical | `reason` (`rolloutStateReason`) |
| `ecs_deployment_stuck` | Availability | `rolloutState === 'IN_PROGRESS'` and `createdAt <= now − 30 min` | warning | `minutes` |
| `tg_no_healthy_host` | Availability | a target group's `DescribeTargetHealth` has 0 healthy and at least 1 target | critical | `targetGroup`, `total` |
| `tg_unhealthy_hosts` | Availability | at least 1 unhealthy and at least 1 healthy | warning | `targetGroup`, `unhealthy`, `healthy` |
| `alb_elb_5xx` | Availability | `Σ HTTPCode_ELB_5XX_Count >= AUDIT_ELB_5XX.warning` (100) | warning, critical at 1000 | `count` |
| `ecs_saturated_cpu` | Saturation | `fires(breachProfile(cpu, 85, 'above'))` | critical when `worstValue > 95` or `sharePercent >= 50`, else warning | `sharePercent`, `worstStretchMinutes`, `worstValue`, `threshold` |
| `ecs_saturated_memory` | Saturation | same on memory | same | same |
| `rds_cpu_high` | Saturation | `fires(breachProfile(cpu, 80, 'above'))` | critical when `worstValue > 95` or `sharePercent >= 50`, else warning | same |
| `rds_freeable_memory_low` | Saturation | `memoryGiB != null` and `fires(breachProfile(freePercent, 5, 'below'))` | warning | `sharePercent`, `worstValue`, `memoryGiB` |
| `aurora_replica_lag` | Saturation | Aurora reader, `fires(breachProfile(lag, 1000, 'above'), { sharePercent: 5, stretchMinutes: 15 })` — amendment 8's "at least three consecutive datapoints or five per cent of the window" | warning | `worstValue`, `sharePercent`, `worstStretchMinutes` |
| `rds_load_above_vcpu` | Saturation | Performance Insights on, `instanceVCpus != null`, and `Σ load of the top 25 statements > vCpus` | warning | `load`, `vcpus`, `statement` (the heaviest statement's text) |
| `target_5xx_rate` | Errors | `Σ requests >= AUDIT_MIN_REQUESTS` (1000) and `Σ target5xx / Σ requests × 100 > 1` | warning, critical above 5 | `rate`, `errors`, `requests` |
| `log_ingestion_spike` | Errors | previous half `> 0`, current half `>= 3 ×` previous, current `>= AUDIT_MIN_LOG_BYTES` (100 MiB) | warning | `current`, `previous`, `factor` |
| `log_group_no_retention` | Hygiene | `retentionDays === null` **and** ingested over the window `>= LOG_RETENTION_MIN_BYTES` (1 GiB) — amendment 8's "informational, gated on stored size", gated on the metric because `storedBytes` lags (amendment 9) | info | `ingested`, `stored` |
| `log_group_large_share` | Hygiene | at least 2 groups covered and this group's ingested share `>= 25 %` | info | `share`, `ingested`, `groups` |
| `alb_no_requests` | Hygiene | `Σ RequestCount === 0` and `loadBalancer.createdAt != null && createdAt <= window.start` | info | none beyond the window |
| `rds_pi_disabled` | Hygiene | `performanceInsights === false` | info | `instance` |
| `ecs_no_container_insights` | Hygiene | `cluster.containerInsights === false` | info | `cluster` |
| `resource_without_alarm` | Hygiene | a resource named by a critical or warning finding has no **metric** alarm on its dimensions (amendment 8) | info | `resource` |
| `alarm_firing` | Availability | a non-target-tracking alarm is in `ALARM` | critical | `alarm`, `since` |
| `permission_missing` | Permissions | a `ServiceCheck` of the audited region has `status === 'denied'` or `'error'` | warning | `service`, `action`, `code` |

`alarm_firing` is not in spec §4's bullet list, but spec §6 requires the end-to-end audit to list "at least the seeded alarm"; it is consistent with amendment 1 because it reads only the current state and `stateUpdatedAt`.

**`resource_without_alarm`, precisely** (amendment 8): for each distinct resource named by a `critical` or `warning` finding, look for a **metric** alarm (`type === 'metric'`, `targetTracking === false`) whose namespace and dimensions match:
- an ECS service: `namespace === 'AWS/ECS'`, `dimensions.ClusterName === cluster`, `dimensions.ServiceName === service`;
- an RDS instance: `namespace === 'AWS/RDS'`, `dimensions.DBInstanceIdentifier === id`;
- a load balancer: `namespace === 'AWS/ApplicationELB'`, `dimensions.LoadBalancer === lb.dimension`;
- a target group: `namespace === 'AWS/ApplicationELB'`, `dimensions.TargetGroup === targetGroupDimension(arn)`.
Composite and metric-math alarms are skipped because they do not expose dimensions, and the finding's message says so.

**The query budget.** One `GetMetricData` call per family, each within its slice of `AUDIT_BUDGET`:
- ECS: `capResources(services, 2, 200)` → at most 100 services × (`CPUUtilization` Average, `MemoryUtilization` Average) = 200.
- RDS: `capResources(instances, 3, 150)` → at most 50 instances × (`CPUUtilization` Average, `FreeableMemory` Average, plus `AuroraReplicaLag` Average for readers) ≤ 150.
- ALB: `capResources(loadBalancers, 3, 90)` → at most 30 × (`RequestCount`, `HTTPCode_ELB_5XX_Count`, `HTTPCode_Target_5XX_Count`, all `Sum`) = 90. Target 5xx per **load balancer**, not per target group, so the rate check costs nothing extra.
- Logs: `capResources(groups, 1, 60)` → at most 60 × `IncomingBytes` `Sum` over a **48-hour** window at `AUDIT_LOG_PERIOD_SECONDS` (amendment 11: one query per group covering both windows), split locally at the 24-hour mark for `log_ingestion_spike`.
`metricQueriesUsed` is the sum and must never exceed `AUDIT_METRIC_QUERY_CAP`. Performance Insights: `capResources(piEligible, 1, AUDIT_MAX_PI_CALLS)` → at most 20 calls, one per instance, through `topDimensionKeys(…, 'sql', FLEET_SQL_LIMIT, …)`.
No percentile is requested anywhere in the audit, so no call needs isolating.

**Failures never fail the audit.** Each family's list call and metric call is handled on its own: a failed call produces one `AuditSkip` naming the check ids it silenced and its AWS code, the other families still run, and `runAudit` returns `{ ok: false }` only if **every** family failed. The page states plainly when a check could not run and why (spec §4).

**`instanceVCpus`:** burstable classes `t3`/`t4g` map `micro: 2, small: 2, medium: 2, large: 2, xlarge: 4, 2xlarge: 8`; every other known family is `SIZE_UNITS[size] * 2` using the existing `SIZE_UNITS` map (`large` → 2, `xlarge` → 4, `2xlarge` → 8, `4xlarge` → 16, `8xlarge` → 32, `12xlarge` → 48, `16xlarge` → 64, `24xlarge` → 96). Unknown classes return `null` and go into the "not covered" list with reason `unknown_class`, exactly as memory does.

- [ ] **Step 1: Write the failing arithmetic test**

Create `tests/unit/analysis-audit.test.ts`, starting with `breachProfile` and `fires` at and around every threshold:

```ts
const series = (values: number[]) => ({ timestamps: values.map((_, i) => i * 300_000), values });

describe('breachProfile', () => {
  it('measures the share of the window and the worst uninterrupted stretch', () => {
    // 10 datapoints of 5 minutes: 4 breaching, the worst run being 3 in a row.
    expect(breachProfile(series([90, 90, 90, 10, 10, 90, 10, 10, 10, 10]), 85, 'above', 300)).toEqual({
      sharePercent: 40, worstStretchMinutes: 15, worstValue: 90, datapoints: 10,
    });
  });
  it('is exclusive at the threshold, like breachActive', () => {
    expect(breachProfile(series([85, 85, 85]), 85, 'above', 300).sharePercent).toBe(0);
    expect(breachProfile(series([85.1]), 85, 'above', 300).sharePercent).toBe(100);
  });
  it('measures a downward breach with the minimum as its worst value', () => {
    expect(breachProfile(series([10, 4, 3, 10]), 5, 'below', 300)).toMatchObject({ sharePercent: 50, worstStretchMinutes: 10, worstValue: 3 });
  });
  it('reports nothing for an empty series', () => {
    expect(breachProfile(series([]), 85, 'above', 300)).toEqual({ sharePercent: 0, worstStretchMinutes: 0, worstValue: null, datapoints: 0 });
  });
});

describe('fires', () => {
  it('fires on a tenth of the window or on a quarter-hour stretch, and not below either', () => {
    expect(fires({ sharePercent: 10, worstStretchMinutes: 5, worstValue: 90, datapoints: 288 })).toBe(true);
    expect(fires({ sharePercent: 9.9, worstStretchMinutes: 10, worstValue: 90, datapoints: 288 })).toBe(false);
    expect(fires({ sharePercent: 1, worstStretchMinutes: 15, worstValue: 90, datapoints: 288 })).toBe(true);
    expect(fires({ sharePercent: 1, worstStretchMinutes: 14.9, worstValue: 90, datapoints: 288 })).toBe(false);
    expect(fires({ sharePercent: 0, worstStretchMinutes: 0, worstValue: null, datapoints: 0 })).toBe(false);
  });
  it('honours the softer gate Aurora replica lag needs', () => {
    expect(fires({ sharePercent: 5, worstStretchMinutes: 5, worstValue: 1200, datapoints: 288 }, { sharePercent: 5 })).toBe(true);
  });
  it('reports a service pegged for eighteen hours and calm in the last minutes', () => {
    const values = Array.from({ length: 288 }, (_, i) => (i < 216 ? 90 : 20));   // 18 h of 24
    expect(fires(breachProfile(series(values), 85, 'above', 300))).toBe(true);
  });
});

describe('instanceVCpus', () => {
  it('knows the burstable and the standard families', () => {
    expect(['db.t3.micro', 'db.t3.medium', 'db.t3.xlarge', 'db.r6g.large', 'db.m5.4xlarge', 'db.r7i.24xlarge'].map(instanceVCpus))
      .toEqual([2, 2, 4, 2, 16, 96]);
  });
  it('returns null for a class it does not know', () => {
    expect(instanceVCpus('db.serverless')).toBeNull();
    expect(instanceVCpus('db.x9.nano')).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing check-catalogue tests**

Continue the same file with one test per check, each at and around its threshold. These are the ones whose arithmetic is not obvious:

```ts
it('reports a database load above the vCPU count and names the top statement', async () => {
  // db.t3.medium = 2 vCPUs; the top 25 statements sum to 3.4 average active sessions.
  const result = await runAudit(target, base, deps);
  expect(finding(result, 'rds_load_above_vcpu')).toMatchObject({
    severity: 'warning', resource: 'db-orders',
    evidence: { load: 3.4, vcpus: 2, statement: 'UPDATE stock SET qty = qty - ? WHERE sku = ?' },
  });
});

it('reports a target 5xx rate above one per cent only above a thousand requests', async () => {
  // 40 000 requests, 800 of them 5xx → 2 %
  expect(finding(await runAudit(target, base, deps), 'target_5xx_rate')).toMatchObject({ severity: 'warning', evidence: { rate: 2, errors: 800, requests: 40_000 } });
  // 400 requests, 200 of them 5xx → 50 %, but far too few requests to mean anything
  expect(finding(await runAudit(target, quiet, deps), 'target_5xx_rate')).toBeUndefined();
});

it('reports a log group whose ingestion tripled, and not one that only doubled', async () => {
  expect(finding(await runAudit(target, tripled, deps), 'log_ingestion_spike')).toMatchObject({ evidence: { factor: 3 } });
  expect(finding(await runAudit(target, doubled, deps), 'log_ingestion_spike')).toBeUndefined();
  // A brand-new group has no previous window to compare against and is not a spike.
  expect(finding(await runAudit(target, brandNew, deps), 'log_ingestion_spike')).toBeUndefined();
});

it('reports a retention-less log group only once it is big, and shows both sizes', async () => {
  expect(finding(await runAudit(target, bigGroup, deps), 'log_group_no_retention')).toMatchObject({ severity: 'info', evidence: { ingested: 2_147_483_648, stored: 512 } });
  expect(finding(await runAudit(target, smallGroup, deps), 'log_group_no_retention')).toBeUndefined();
});

it('reports a load balancer with no requests, unless it is younger than the window', async () => {
  expect(finding(await runAudit(target, idleOld, deps), 'alb_no_requests')).toBeDefined();
  expect(finding(await runAudit(target, idleNew, deps), 'alb_no_requests')).toBeUndefined();
});

it('reports a flagged resource with no metric alarm, and says composite alarms were not read', async () => {
  const result = await runAudit(target, base, deps);
  expect(finding(result, 'resource_without_alarm')?.resource).toBe('web');
  // A composite alarm exists but exposes no dimensions, so it cannot count as cover.
  expect(finding(result, 'resource_without_alarm')?.values.metricOnly).toBe(1);
});

it('does not report a resource that has a matching metric alarm', async () => {
  expect(finding(await runAudit(target, withAlarm, deps), 'resource_without_alarm')).toBeUndefined();
});

it('turns the stored permission test into findings', async () => {
  const result = await runAudit(target, { ...base, lastTest: { overall: 'degraded', accountMatches: true, testedAt: '', checks: [
    { service: 'pi', region: 'eu-west-1', action: 'pi:DescribeDimensionKeys', status: 'denied', errorCode: 'AccessDenied', checkedAt: '' },
    { service: 'ecs', region: 'eu-west-1', action: 'ecs:ListClusters', status: 'ok', checkedAt: '' },
    { service: 'rds', region: 'us-east-1', action: 'rds:DescribeDBInstances', status: 'denied', checkedAt: '' },
  ] } }, deps);
  const permissions = result.ok ? result.data.findings.filter((f) => f.id === 'permission_missing') : [];
  expect(permissions).toHaveLength(1);                       // the other region is not this audit
  expect(permissions[0].evidence).toEqual({ service: 'pi', action: 'pi:DescribeDimensionKeys', code: 'AccessDenied' });
});

it('never sends more than 500 metric queries and says what it covered', async () => {
  const result = await runAudit(target, large, deps);       // 300 services, 100 instances, 80 ALBs, 500 groups
  const sent = cw.commandCalls(GetMetricDataCommand).reduce((n, c) => n + (c.args[0].input.MetricDataQueries?.length ?? 0), 0);
  expect(sent).toBeLessThanOrEqual(500);
  expect(result.ok && result.data.metricQueriesUsed).toBe(sent);
  expect(result.ok && result.data.coverage.ecs).toEqual({ covered: 100, total: 300, truncated: true });
  expect(result.ok && result.data.coverage.logs).toEqual({ covered: 60, total: 500, truncated: true });
});

it('spends at most twenty Performance Insights calls', async () => {
  await runAudit(target, manyPiInstances, deps);            // 40 instances with PI
  expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(20);
});

it('records a skipped check instead of failing when one family cannot be read', async () => {
  ecs.on(ListClustersCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));
  const result = await runAudit(target, base, deps);
  expect(result.ok).toBe(true);
  expect(result.ok && result.data.skipped).toContainEqual(expect.objectContaining({ id: 'ecs_saturated_cpu', reason: 'denied', code: 'AccessDeniedException', action: 'ecs:ListClusters' }));
  expect(result.ok && result.data.findings.some((f) => f.id === 'alarm_firing')).toBe(true);
});

it('fails only when every family fails', async () => {
  // every list call rejects
  expect((await runAudit(target, base, deps)).ok).toBe(false);
});

describe('sortFindings', () => {
  it('puts the worst first, then groups by check, then by resource', () => {
    const f = (id: string, severity: AuditSeverity, resource: string) => ({ id, severity, resource, values: {}, evidence: {}, href: null });
    expect(sortFindings([f('b', 'info', 'z'), f('a', 'critical', 'b'), f('a', 'critical', 'a'), f('c', 'warning', 'x')]).map((x) => [x.id, x.resource]))
      .toEqual([['a', 'a'], ['a', 'b'], ['c', 'x'], ['b', 'z']]);
  });
});
```

- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Write `instanceVCpus` and `audit.ts`.**
- [ ] **Step 5: Add the messages**

New top-level namespace `Audit` (server-side only). Each finding has three keys: a title, a sentence and an action. Listing all of them here would double this task's length, so they are given as a table of the **sentence** and the **action**; the title is `Audit.titles.<id>` and is the check's short name (e.g. `Fewer tasks than desired` / `Moins de tâches que prévu`). The implementer writes all three families of keys for all 22 ids and the `i18n-messages` test enforces parity.

| id | EN sentence | FR sentence |
|---|---|---|
| `ecs_tasks_below_desired` | `{service} has been running {running} of {desired} tasks.` | `{service} exécute {running} tâches sur {desired}.` |
| `ecs_deployment_failed` | `The last deployment of {service} failed: {reason}` | `Le dernier déploiement de {service} a échoué : {reason}` |
| `ecs_deployment_stuck` | `A deployment of {service} has been in progress for {minutes} minutes.` | `Un déploiement de {service} est en cours depuis {minutes} minutes.` |
| `tg_no_healthy_host` | `{targetGroup} has no healthy target at all, out of {total}.` | `{targetGroup} n'a aucune cible saine, sur {total}.` |
| `tg_unhealthy_hosts` | `{targetGroup} has {unhealthy} unhealthy targets and {healthy} healthy ones.` | `{targetGroup} a {unhealthy} cibles défaillantes et {healthy} saines.` |
| `alb_elb_5xx` | `{loadBalancer} itself returned {count} 5xx errors over 24 hours: no target could be chosen.` | `{loadBalancer} a lui-même renvoyé {count} erreurs 5xx en 24 heures : aucune cible n'a pu être choisie.` |
| `ecs_saturated_cpu` | `{service} spent {sharePercent} of the last 24 hours above {threshold} CPU, at worst {worstValue}, with a stretch of {worstStretchMinutes} minutes.` | `{service} a passé {sharePercent} des 24 dernières heures au-dessus de {threshold} de CPU, au pire {worstValue}, avec une période continue de {worstStretchMinutes} minutes.` |
| `ecs_saturated_memory` | `{service} spent {sharePercent} of the last 24 hours above {threshold} memory, at worst {worstValue}, with a stretch of {worstStretchMinutes} minutes.` | `{service} a passé {sharePercent} des 24 dernières heures au-dessus de {threshold} de mémoire, au pire {worstValue}, avec une période continue de {worstStretchMinutes} minutes.` |
| `rds_cpu_high` | `{instance} spent {sharePercent} of the last 24 hours above {threshold} CPU, at worst {worstValue}.` | `{instance} a passé {sharePercent} des 24 dernières heures au-dessus de {threshold} de CPU, au pire {worstValue}.` |
| `rds_freeable_memory_low` | `{instance} spent {sharePercent} of the last 24 hours with less than 5% of its {memoryGiB} GiB free, at worst {worstValue}.` | `{instance} a passé {sharePercent} des 24 dernières heures avec moins de 5 % de ses {memoryGiB} Gio libres, au pire {worstValue}.` |
| `aurora_replica_lag` | `{instance} lagged more than one second for {sharePercent} of the window, at worst {worstValue}.` | `{instance} a accusé plus d'une seconde de retard pendant {sharePercent} de la fenêtre, au pire {worstValue}.` |
| `rds_load_above_vcpu` | `The statements visible on {instance} alone carry {load} average active sessions, more than its {vcpus} vCPUs. The heaviest is: {statement}` | `Les requêtes visibles sur {instance} portent à elles seules {load} sessions actives en moyenne, plus que ses {vcpus} vCPU. La plus lourde est : {statement}` |
| `target_5xx_rate` | `{loadBalancer} returned {rate} of requests as 5xx ({errors} of {requests}).` | `{loadBalancer} a renvoyé {rate} des requêtes en 5xx ({errors} sur {requests}).` |
| `log_ingestion_spike` | `{group} ingested {current}, {factor} times the {previous} of the previous 24 hours.` | `{group} a ingéré {current}, soit {factor} fois les {previous} des 24 heures précédentes.` |
| `log_group_no_retention` | `{group} has no retention setting and ingested {ingested} in 24 hours; it currently stores {stored}.` | `{group} n'a aucune durée de conservation et a ingéré {ingested} en 24 heures ; il stocke actuellement {stored}.` |
| `log_group_large_share` | `{group} is {share} of everything ingested across {groups} log groups.` | `{group} représente {share} de tout ce qui a été ingéré sur {groups} groupes de journaux.` |
| `alb_no_requests` | `{loadBalancer} received no request over 24 hours.` | `{loadBalancer} n'a reçu aucune requête en 24 heures.` |
| `rds_pi_disabled` | `{instance} has Performance Insights disabled, so database analysis is blind there.` | `{instance} a Performance Insights désactivé : l'analyse de base de données y est aveugle.` |
| `ecs_no_container_insights` | `{cluster} has no Container Insights, so historical task counts are unavailable; live counts still come from DescribeServices.` | `{cluster} n'a pas Container Insights : l'historique du nombre de tâches est indisponible ; les valeurs actuelles proviennent toujours de DescribeServices.` |
| `resource_without_alarm` | `{resource} is flagged above but has no CloudWatch metric alarm. Composite and metric-math alarms were not checked: they do not expose their dimensions.` | `{resource} est signalé ci-dessus mais n'a aucune alarme métrique CloudWatch. Les alarmes composites et à expression mathématique n'ont pas été vérifiées : elles n'exposent pas leurs dimensions.` |
| `alarm_firing` | `{alarm} has been in ALARM since {since}.` | `{alarm} est en ALARM depuis {since}.` |
| `permission_missing` | `OpsWatch cannot read {service} in this region ({action}: {code}), so every check that needs it is partial.` | `OpsWatch ne peut pas lire {service} dans cette région ({action} : {code}) : tous les contrôles qui en dépendent sont partiels.` |

Actions (`Audit.actions.<id>`), one line each, are written by the implementer from the same table; they must be concrete instructions ("Raise the desired count or fix the task that keeps stopping", "Set a retention period on this log group"), never "handle this appropriately". Every action is a message key in both languages.

- [ ] **Step 6: Register the boundary and run the tests.** Add `'lib/analysis/audit.ts'` to `SERVER_ONLY_MODULES`. `npx vitest run tests/unit/analysis-audit.test.ts tests/unit/module-boundaries.test.ts tests/unit/i18n-messages.test.ts`.

- [ ] **Step 7: Verify and commit.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`. Commit: `feat(analysis): the audit check catalogue`.

**moto limits:** facts 6, 7 and 8 mean the ECS deployment checks, `rds_pi_disabled`'s opposite and `rds_load_above_vcpu` cannot be produced end to end; every check above is unit-tested against a fixture at and around its threshold, which is spec §6's requirement.
**Owner-only verification:** that `rds_load_above_vcpu` fires on their real instance, that the ECS deployment checks fire on a real failed rollout, and that the findings match the manual investigation they did on their production account — which is the whole point of this stage.

---

### Task 27: Audit page, Markdown copy and download

Implements spec §4's page: findings worst first with their evidence and what to do, a plain statement when a check could not run, a "Copy report" action and a "Download" link returning the same Markdown as a file. Nothing is stored and nothing is sent anywhere.

**Files:**
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/overview/audit/page.tsx`, `…/audit/cards.tsx`
- Create: `src/components/analysis/finding-list.tsx` (server), `src/components/analysis/markdown-actions.tsx` (client)
- Create: `src/lib/analysis/audit-markdown.ts`
- Create: `src/lib/monitoring/api-route.ts`; delete `src/lib/monitoring/logs-route.ts`
- Create: `src/app/api/connections/[id]/regions/[region]/audit/markdown/route.ts`
- Modify: the three logs route handlers (import from `api-route.ts`), `tests/unit/module-boundaries.test.ts`, `tests/unit/logs-routes.test.ts`
- Create: `tests/unit/audit-markdown.test.ts`, `tests/unit/audit-route.test.ts`, `tests/e2e/10-audit.spec.ts`
- Modify: `messages/en.json`, `messages/fr.json`

**Interfaces:**
- Consumes: `runAudit`, `AuditResult`, `AuditFinding`, `AuditSkip`, `sortFindings` from `@/lib/analysis/audit`; `renderMarkdown`, `markdownFilename`, `MarkdownDoc` from `@/lib/analysis/markdown`; `resolveTarget` from `@/lib/monitoring/target`; `findConnection` from `@/lib/connections/repository`; `getCurrentSession` from `@/lib/auth/current`; `isSameOrigin` from `@/lib/http/origin`; `apiError`, `ApiErrorCode` from `@/lib/http/api-error`; `checkSelection` from `@/lib/monitoring/selection`; `resolveLocale`, `AppLocale` from `@/i18n/routing`; `getTranslations`, `getFormatter` from `next-intl/server`; `copyText` from `@/lib/clipboard`; `CopyButton` is **not** reused (it copies a short value and shows an inline label; the audit needs a labelled action beside a download link, so `MarkdownActions` wraps `copyText` itself).
- Produces (`src/lib/monitoring/api-route.ts`, server-only) — the two functions moved verbatim out of `logs-route.ts`, renamed for their wider use:
  - `export type RegionRouteParams = { id: string; region: string };`
  - `export async function authorizeRegionRoute(request: Request, params: RegionRouteParams, options: { mutating: boolean }): Promise<{ ok: true; sessionId: string; scope: MonitoringScope } | { ok: false; response: Response }>`
  - `export function failureResponse(failure: MonitoringFailure): Response`
  The three logs routes change their import only; their behaviour and their tests are unchanged. Remove `'lib/monitoring/logs-route.ts'` from `SERVER_ONLY_MODULES` and add `'lib/monitoring/api-route.ts'`.
- Produces (`src/lib/analysis/audit-markdown.ts`):
  - `export type AuditStrings = { title: string; subtitle: string; severity: Record<AuditSeverity, string>; sentence: (f: AuditFinding) => string; action: (f: AuditFinding) => string; skipped: (s: AuditSkip) => string; headings: { findings: string; skipped: string; coverage: string; none: string }; coverageRow: (family: string, coverage: Coverage) => [string, string] };`
  - `export function auditMarkdown(result: AuditResult, strings: AuditStrings): string` — builds a `MarkdownDoc` and hands it to `renderMarkdown`. **It formats nothing itself**: every sentence arrives already localized, which is how "findings are localized messages with placeholders, never generated prose" is kept true in Markdown as well as in HTML.
- Produces (the route handler): `export const dynamic = 'force-dynamic';` and `export async function GET(request, { params })`.

**The page:** `initMonitoringRoute(params)` first, one `pageNow()`, `SectionLayout` with `section="overview"`, `subsection="audit"`, **no range selector** (the audit is fixed at 24 hours) and `autoRefresh={false}`. One `SuspenseCard` around `AuditCard`, which resolves the target, reads `findConnection(getDb(), connectionId)?.lastTest ?? null`, calls `runAudit`, and renders:
1. a line naming the window and the coverage per family (`Audit.window`, then one `CoverageNote` per family);
2. `MarkdownActions` with the rendered Markdown string and the download href;
3. the `FindingList`, grouped by severity, worst first;
4. the "could not run" `<section>` listing each `AuditSkip` with its reason, its action and its code;
5. `NotCoveredList` for the `unknown_class` and `cap` rows.

**`FindingList`** renders each finding as: a severity icon plus an `sr-only` severity word (colour is never the only signal), the title (`Audit.titles.<id>`), the sentence (`Audit.findings.<id>` with the finding's `values`, numbers pre-formatted through `formatMetricValue` where the value is a percentage, a byte count or a duration — the same `INSIGHT_VALUE_UNITS` pattern `insights.ts` already uses, extended here as `AUDIT_VALUE_UNITS`), the evidence as a small definition list, the action (`Audit.actions.<id>`) in muted text, and a `<Link href={finding.href}>` when there is one.

**The download route,** which is the only new API surface of this stage:

```ts
export async function GET(request: Request, { params }: { params: Promise<{ id: string; region: string }> }) {
  // GET mutates nothing, so there is no Origin check; the session is still checked first.
  const auth = await authorizeRegionRoute(request, await params, { mutating: false });
  if (!auth.ok) return auth.response;
  const locale = resolveLocale(new URL(request.url).searchParams.get('locale') ?? '');
  const target = await resolveTarget(auth.scope);
  if (!target.ok) return failureResponse(target);
  const row = findConnection(getDb(), auth.scope.connectionId);
  const result = await runAudit(target.data, { nowMs: Date.now(), connectionId: auth.scope.connectionId, lastTest: row?.lastTest ?? null, scope: auth.scope });
  if (!result.ok) return failureResponse(result);
  const markdown = auditMarkdown(result.data, await auditStrings(locale, row?.name ?? '', auth.scope.region));
  return new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${markdownFilename('opswatch-audit', auth.scope.region, result.data.window.end.getTime())}"`,
      'cache-control': 'no-store',
    },
  });
}
```

`auditStrings(locale, connectionName, region)` is a small server helper in `cards.tsx`'s sibling module that builds the `AuditStrings` from `getTranslations({ locale })`, so the page and the route produce **the same** Markdown.

- [ ] **Step 1: Write the failing Markdown test**

Create `tests/unit/audit-markdown.test.ts`:

```ts
it('renders findings grouped by severity, the skipped checks and the coverage', () => {
  const out = auditMarkdown(result, strings);
  expect(out).toContain('# OpsWatch audit\n');
  expect(out).toContain('## Critical\n');
  expect(out).toContain('- web has been running 0 of 2 tasks.\n');
  expect(out).toContain('## Could not run\n');
  expect(out).toContain('## Coverage\n');
  expect(out).toContain('| Services | 12 of 12 |\n');
});

it('says so plainly when nothing was found', () => {
  expect(auditMarkdown({ ...result, findings: [] }, strings)).toContain('No finding over the last 24 hours.');
});

it('escapes a statement that holds a pipe', () => {
  const out = auditMarkdown(withStatement("SELECT a | b FROM t"), strings);
  expect(out).not.toMatch(/\| b FROM t \|/);
  expect(out).toContain('\\|');
});

it('never renders a raw placeholder', () => {
  expect(auditMarkdown(result, strings)).not.toMatch(/\{[a-zA-Z]+\}/);
});
```

- [ ] **Step 2: Write the failing route test**

Create `tests/unit/audit-route.test.ts`, following `tests/unit/logs-routes.test.ts`'s shape:

```ts
it('answers 401 without a session, before touching AWS', async () => {
  const response = await GET(new Request('http://localhost/api/…'), { params: Promise.resolve({ id, region: 'eu-west-1' }) });
  expect(response.status).toBe(401);
  expect(sts.calls()).toHaveLength(0);
});

it('answers 404 for a region the connection does not use', async () => {
  expect((await GET(request, { params: Promise.resolve({ id, region: 'eu-west-3' }) })).status).toBe(404);
});

it('returns Markdown as an attachment named after the region and the day', async () => {
  const response = await GET(request, { params: Promise.resolve({ id, region: 'eu-west-1' }) });
  expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="opswatch-audit-eu-west-1-\d{4}-\d{2}-\d{2}\.md"$/);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toContain('# ');
});

it('renders the French document when asked', async () => {
  const response = await GET(new Request('http://localhost/api/…?locale=fr'), { params });
  expect(await response.text()).toContain('Audit OpsWatch');
});

it('falls back to the default locale for an unknown one', async () => {
  const response = await GET(new Request('http://localhost/api/…?locale=zz'), { params });
  expect(await response.text()).toContain('OpsWatch audit');
});

it('does not check the Origin on a GET, and answers normally from another origin', async () => {
  const response = await GET(new Request('http://localhost/api/…', { headers: { origin: 'http://evil.test' } }), { params });
  expect(response.status).toBe(200);
});

it('answers the AWS failure code when every family failed', async () => {
  const response = await GET(request, { params });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: 'aws_denied' });
});
```

- [ ] **Step 3: Run both to see them fail.**
- [ ] **Step 4: Move the route helpers, write the page, the components, the Markdown builder and the route.**
- [ ] **Step 5: Add the messages**

| Key | EN | FR |
|---|---|---|
| `Audit.title` | `Audit` | `Audit` |
| `Audit.description` | `A catalogue of checks over the last 24 hours, with the evidence behind each finding.` | `Un catalogue de contrôles sur les 24 dernières heures, avec les preuves de chaque constat.` |
| `Audit.markdownTitle` | `OpsWatch audit` | `Audit OpsWatch` |
| `Audit.subtitle` | `{connection} · {region} · last 24 hours` | `{connection} · {region} · dernières 24 heures` |
| `Audit.window` | `Checked from {start} to {end}.` | `Contrôlé de {start} à {end}.` |
| `Audit.severity.critical` | `Critical` | `Critique` |
| `Audit.severity.warning` | `Warning` | `Avertissement` |
| `Audit.severity.info` | `Information` | `Information` |
| `Audit.headings.findings` | `Findings` | `Constats` |
| `Audit.headings.skipped` | `Could not run` | `Non exécuté` |
| `Audit.headings.coverage` | `Coverage` | `Couverture` |
| `Audit.headings.none` | `No finding over the last 24 hours.` | `Aucun constat sur les 24 dernières heures.` |
| `Audit.evidenceLabel` | `Evidence` | `Preuves` |
| `Audit.actionLabel` | `What to do` | `Que faire` |
| `Audit.openResource` | `Open` | `Ouvrir` |
| `Audit.skipped.denied` | `{check} could not run: OpsWatch is not allowed to call {action} ({code}).` | `{check} n'a pas pu s'exécuter : OpsWatch n'est pas autorisé à appeler {action} ({code}).` |
| `Audit.skipped.throttled` | `{check} could not run: AWS throttled {action}.` | `{check} n'a pas pu s'exécuter : AWS a limité {action}.` |
| `Audit.skipped.error` | `{check} could not run: {action} returned {code}.` | `{check} n'a pas pu s'exécuter : {action} a renvoyé {code}.` |
| `Audit.skipped.cap` | `{check} was limited by the query budget.` | `{check} a été limité par le budget de requêtes.` |
| `Audit.skipped.unavailable` | `{check} needs data this account does not publish.` | `{check} nécessite des données que ce compte ne publie pas.` |
| `Audit.coverageRow.ecs` | `Services` | `Services` |
| `Audit.coverageRow.rds` | `Database instances` | `Instances de base de données` |
| `Audit.coverageRow.alb` | `Load balancers` | `Répartiteurs de charge` |
| `Audit.coverageRow.logs` | `Log groups` | `Groupes de journaux` |
| `Audit.coverageRow.alarms` | `Alarms` | `Alarmes` |
| `Audit.coverageValue` | `{covered} of {total}` | `{covered} sur {total}` |
| `Audit.queriesUsed` | `{count} CloudWatch metric queries were spent, of a budget of {cap}.` | `{count} requêtes de métriques CloudWatch ont été utilisées, sur un budget de {cap}.` |
| `Audit.nothingSent` | `Nothing is stored and nothing is sent anywhere: this page reads AWS and renders.` | `Rien n'est enregistré et rien n'est envoyé : cette page lit AWS et affiche le résultat.` |
| `Monitoring.client.audit.copy` | `Copy report` | `Copier le rapport` |
| `Monitoring.client.audit.copied` | `Copied` | `Copié` |
| `Monitoring.client.audit.copyFailed` | `Could not copy` | `Copie impossible` |
| `Monitoring.client.audit.download` | `Download as Markdown` | `Télécharger en Markdown` |

- [ ] **Step 6: Write the failing end-to-end test**

Create `tests/e2e/10-audit.spec.ts`:

```ts
test('the audit lists the seeded alarm and the log group without retention, with evidence', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/overview/audit`);
  await expect(page).toHaveTitle('Audit · OpsWatch');
  await expect(page.getByRole('heading', { level: 1, name: 'Audit' })).toBeVisible();
  await expect(page.getByText('opswatch-e2e-high-cpu has been in ALARM since', { exact: false })).toBeVisible();
  // The seed ingests 1.2 GiB into /ecs/opswatch-web and sets no retention on it.
  await expect(page.getByText('/ecs/opswatch-web has no retention setting and ingested', { exact: false })).toBeVisible();
  await expect(page.getByText('Nothing is stored and nothing is sent anywhere', { exact: false })).toBeVisible();
  await expect(page.getByText(/CloudWatch metric queries were spent, of a budget of 500\./)).toBeVisible();
  await expect(page.getByRole('button', { name: /auto-refresh/i })).toHaveCount(0);
});

test('the audit report can be downloaded as a Markdown file', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/overview/audit`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download as Markdown' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^opswatch-audit-us-east-1-\d{4}-\d{2}-\d{2}\.md$/);
  const body = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(body).toString('utf8');
  expect(text).toContain('# OpsWatch audit');
  expect(text).toContain('opswatch-e2e-high-cpu');
  expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
});

test('the French audit downloads a French document', async ({ page }) => {
  await page.goto(`/fr/c/${connectionId}/us-east-1/overview/audit`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Télécharger en Markdown' }).click()]);
  const text = Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8');
  expect(text).toContain('# Audit OpsWatch');
});

test('the audit download refuses an anonymous request', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const response = await anonymous.get(`/api/connections/${connectionId}/regions/us-east-1/audit/markdown`);
  expect(response.status()).toBe(401);
  await anonymous.dispose();
});
```

- [ ] **Step 7: Run everything.** `npx vitest run`, then the full e2e command; `tests/unit/logs-routes.test.ts` must still pass unchanged after the helper move.
- [ ] **Step 8: Verify and commit.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip` (`markdown.ts` is finally imported). Commit: `feat(overview): audit page with Markdown copy and download`.

**moto limits:** the findings the seed reliably produces are `alarm_firing` (one metric alarm in `ALARM`), `log_group_no_retention` (1.2 GiB ingested, no retention — which is why Task 22's seed matters), `log_group_large_share` (that group is ~97 % of the total), `ecs_no_container_insights` or its absence depending on the cluster setting, and `resource_without_alarm`. Facts 6, 7 and 8 keep the ECS deployment checks and every Performance Insights check out of e2e. The clipboard copy is asserted by clicking the button and reading the button's own state, not by reading the system clipboard, which Playwright cannot do without a permission grant; the Markdown itself is proven by the download test.
**Owner-only verification:** spec §7's definition of done — that the audit's findings match the manual investigation they did on their production account, and that the Markdown pastes into their ticket system.

---

### Task 28: Phase 3 checkpoint and documentation

- [ ] **Step 1: Run every verification command.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx knip`, `npm run lint:template` (it must still pass and the template must be **unchanged** — this stage adds no IAM action), and the full e2e suite. Record every count.

- [ ] **Step 2: Prove no IAM action and no template version changed.** Run: `git diff feat/step-1-foundations -- src/lib/aws/actions.ts src/lib/connections/template.ts`. Expected: empty. If it is not, the stage broke its own contract and the change must be reverted or escalated to the owner as a separate decision.

- [ ] **Step 3: Prove the query budgets.** Collect, from the unit tests written in Tasks 13 to 26, the asserted maximum number of metric queries per page: every dashboard and report ≤ 300, the audit ≤ 500, the Queries page ≤ 1 Performance Insights call per instance capped at 50, the audit ≤ 20 Performance Insights calls. Any page without such an assertion gets one now.

- [ ] **Step 4: Check EN/FR parity and that no French page has English left.** Run the node one-liner from Task 7 step 2, then walk every page at `/fr/…` in `npm run dev` and read it.

- [ ] **Step 5: Walk the whole product at 360 px, 768 px and 1440 px, in both themes and both locales.** Every section: dashboard, its other sub-pages, both menus collapsed and expanded, the breadcrumb, the facets, the tables, the charts. No horizontal scroll at 360 px anywhere. Confirm every status colour still has a text or icon label beside it.

- [ ] **Step 6: Collect the e2e gap list.** Every "moto limits" line of Tasks 9 to 27, in one list, with what each one means the owner must check themselves. Expected content: Performance Insights entirely (facts 7 and 8), p95 values (fact 2), ECS running tasks, service events and failed or stuck rollouts (fact 6), alarm pagination (fact 9), Logs Insights `filter`, `parse` and `stats` semantics and `StopQuery` (fact 10), log group retention policies if Task 22 step 1 took its fallback branch, and denied and throttled states (fact 11).

- [ ] **Step 7: Update the documentation.** In `README.md` and `README.fr.md`, update the feature list and the screenshots section to describe the dashboards, the reports, the Queries page, the Volume and Endpoints pages and the audit; state the cost model (300 metric queries per page load, 500 for the audit, one Performance Insights call per instance, Logs Insights billed per scanned gigabyte); and state plainly that no new IAM permission is needed. Do not invent numbers: take them from `src/lib/analysis/coverage.ts`.

- [ ] **Step 8: Write the final report and commit.** The report lists: task count, test counts, the knip result (which must now be empty), the budget numbers, the e2e gap list, everything only the owner can verify, and the two decisions this stage deliberately did not take — adding `cloudwatch:DescribeAlarmHistory` for real alarm history (amendment 1) and any of the Stage 3-original ideas (SQS, Lambda, EC2/EBS) that would need new IAM actions.
Commit: `chore(analysis): phase 3 checkpoint — dashboards, reports, logs pages and audit`.

**moto limits:** collected in step 6.
**Owner-only verification:** collected in step 6 and step 8; this is the list to hand the owner with the branch.

---

## Open risks

1. **The Logs dashboard replaces the Search page as the section's landing page.** Spec §9.2 describes the Logs dashboard as the volume view, which pushes the Logs Insights editor to the second sub-page. If the owner opens Logs mainly to run a query, that is one extra click every time. Reversing it is a one-line change in `sections.ts` plus its two tests.
2. **`resource_without_alarm` can be noisy** on an account that alerts through composite alarms or through something other than CloudWatch. It is `info` severity and says what it did not check, but it may still need a "hide this check" control the spec does not ask for.
3. **The dashboards raise the steady-state AWS read volume.** Six dashboards that auto-refresh every 120 s each spend their metric queries per browser tab; the 60 s cache is per process, so several viewers share it, but a single viewer leaving six tabs open is the new worst case. The Logs volume dashboard is already exempted from auto-refresh for this reason; if the owner sees CloudWatch charges move, the next lever is raising `DESCRIBE_TTL_MS` and `METRICS_TTL_MS`.
4. **`instanceVCpus` and `instanceMemoryGiB` are hand-maintained tables.** Any instance family they do not know lands in a "not covered" list rather than being wrong, which is the right failure, but the tables will drift as AWS ships new families.
5. **The audit's "peak" is the worst five-minute average**, not a true instantaneous maximum, because asking for `Maximum` as well would double its query cost. The findings say "at worst" rather than "peaked at"; if the owner wants true peaks, the budget has to grow.
6. **The parallel change to the Logs group picker** may land differently from what Task 9 assumes. Task 9's move step re-lists the directory before moving and changes nothing inside those files, which should absorb it, but if the picker's props or its selection provider changed shape, Task 9's `SectionLayout` wiring of the Logs search page needs adjusting.
7. **moto cannot exercise Performance Insights at all**, so the single most valuable page of this stage — Databases → Queries — has no end-to-end proof beyond its "not covered" list. Its correctness rests entirely on the unit tests of Task 10 and on the owner's own account.
