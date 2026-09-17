# OpsWatch Stage 2 — Live Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is self-contained: an implementer sees only its own task text plus the header sections of this plan (Goal to "Verified moto 5.2.3 behaviour").

**Goal:** Live, read-only monitoring for a selected AWS connection and region, in English and French, with no stored history: Overview with automatic insights, Containers (ECS), Databases (RDS/Aurora with Performance Insights top SQL), Load balancers (ALB) and Alarms in Phase A; CloudWatch Logs Insights in Phase B.

**Architecture:** Server-only data modules in `src/lib/monitoring/` call AWS SDK v3 through the existing `clientConfig` and `sendWithTimeout`, return typed results (`{ ok: true, data } | { ok: false, reason, code, action }`) and share a per-process TTL + LRU cache and a GetMetricData batcher. Pages live under `src/app/[locale]/(app)/c/[connectionId]/[region]/<section>`; each page authenticates and validates the connection and region synchronously (database only, no AWS call), then renders one async server component per card, each in its own `<Suspense>` with a skeleton, so the shell and fast cards stream first. Dependency-free helpers used by both server and client components live in `src/lib/monitoring/shared/`. Charts are small `recharts` client components fed with serialized series; table sparklines are inline SVG. Insight rules are pure functions over already-fetched data. Phase B adds Logs Insights through region-bound route handlers and a client poller.

**Tech Stack:** Next.js 16.3.5 (App Router), React 19.2.8, TypeScript 5.9.3, next-intl 4.14.5, Tailwind CSS 4, shadcn/ui 4.21 (style radix-nova), lucide-react 1.47, AWS SDK v3 3.1134.0 (`client-cloudwatch`, `client-cloudwatch-logs`, `client-ecs`, `client-elastic-load-balancing-v2`, `client-pi`, `client-rds` already installed), zod 4.6.5, Vitest 5.0.1 + aws-sdk-client-mock 4.1.0, Playwright 1.63.0, moto 5.2.3. New dependencies (read from npm on 2026-09-17): `recharts` **3.10.1** (dependency, exact); `react-is` **19.2.8** (dependency, exact; peer dependency of recharts; latest is 19.3.0 but it must match the installed `react`/`react-dom` 19.2.8); `@aws-sdk/client-ec2` **^3.1134.0** (devDependency, latest 3.1134.0, same line as the other AWS clients; used only by the e2e seeding harness because moto needs a VPC and subnets before it creates an ALB). shadcn `table` component added through the local shadcn CLI.

**Spec:** `.superpowers/sdd/2026-09-17-opswatch-foundations/stage2-monitoring-spec.md` (section 9 amendments override earlier sections).

**Branch:** `feat/stage-2-monitoring`, created from the current head of `feat/step-1-foundations`. Phase B (Tasks 12 and 13) starts only after Phase A (Tasks 1 to 11) has been reviewed clean.

## Global Constraints

- Nullable timestamps (`number | null`, e.g. `createdAt`, `startedAt`, `stateUpdatedAt`) are never passed to next-intl `format.relativeTime`/`dateTime` directly: guard them (`value != null ? format.relativeTime(value) : '—'`), as Task 5 does.

Binding for every task. Step 1 constraints still apply (see `.superpowers/sdd/2026-09-17-opswatch-foundations/global-constraints.md`); the ones that matter here are repeated.

- Node.js 22, npm, project root `/var/www/html/opswatch`, TypeScript strict, alias `@/*` → `src/*`. Vitest config is `vitest.config.mts` (aliases `server-only` to a stub).
- **Server-only data modules:** every file in `src/lib/monitoring/` except `src/lib/monitoring/shared/**` starts with `import 'server-only';` and is listed in `SERVER_ONLY_MODULES` of `tests/unit/module-boundaries.test.ts`. Files in `src/lib/monitoring/shared/` import nothing from AWS, zod, Node, the database or `server-only`, so client components may use them. An `AwsTarget` (it holds credentials) is never passed as a prop to a client component.
- **Every AWS call is server-side.** Credentials come only from `credentialsInputFor(row, env().OPSWATCH_SECRET)` + `credentialResolver.resolve(input, region)` (wrapped by `resolveTarget`, Task 3).
- **Authorization first:** every monitoring page calls `initMonitoringRoute(params)` (Task 3) as its first statement, which calls `initProtectedRoute` → `requireAdmin` before reading any connection. Every redirect page calls `initProtectedRoute` first. Route handlers check `Origin` first when they mutate (POST, DELETE), then the session (`getCurrentSession`), then the connection and region, before any AWS call — the same order as the Step 1 test route. There are no server actions in this stage.
- **Origin check on mutating routes:** `isSameOrigin(request, env().OPSWATCH_PUBLIC_URL)` on POST and DELETE; failure answers 403 `forbidden_origin`.
- **No user-facing string in code:** every label, message, heading, aria-label and empty state is a message in `messages/en.json` and `messages/fr.json`. AWS identifiers (IAM actions, ARNs, resource names, AWS status values such as `ACTIVE`, statistic names such as `p95`, Logs Insights query text) are never translated.
- **en/fr parity:** identical key sets, no empty string (`tests/unit/i18n-messages.test.ts`). Namespaces read by client components are listed in `CLIENT_NAMESPACES` (`src/i18n/client-messages.ts`); all client monitoring strings live under `Monitoring.client`.
- **Timeouts:** 5 s per describe/list call (`AWS_CALL_TIMEOUT_MS` from `src/lib/aws/timeout.ts`), 10 s per GetMetricData request (`METRICS_TIMEOUT_MS = 10_000`), via `sendWithTimeout`. Timeouts surface as code `Timeout`.
- **Cache:** one in-memory TTL + LRU cache per process (`monitoringCache`), at most 500 entries, keyed by connection id + region + call + normalized params; TTL 60 s for metrics and describe calls, 5 minutes for Performance Insights top SQL, never for Logs Insights. Failed results are never cached. Time windows are floored to the minute (5 minutes for PI) so that keys are stable within a TTL.
- **GetMetricData:** at most 500 queries per request; period by range 1h→60 s, 3h→60 s, 12h→300 s, 24h→300 s, 7d→3600 s; percentiles requested with `MetricStat.Stat: 'p95'` (never ExtendedStatistics); percentile queries are always sent in their own request (see moto fact 2); no metric math.
- **Time ranges:** `1h`, `3h` (default), `12h`, `24h`, `7d` in `?range=`; Logs Insights ranges are limited to `1h`, `3h`, `12h`, `24h` (24 h maximum).
- **Auto-refresh:** every 120 s (`AUTO_REFRESH_MS = 120_000`) through `router.refresh()`, only while the tab is visible, with a pause toggle. Overview insights always evaluate the last 15 minutes.
- **Region validation:** the URL region must be one of `connection.regions` (otherwise `notFound()`); a connection whose status is not `ok` or `degraded` redirects to `/accounts/<id>`. These checks run before any `<Suspense>` so a 404 keeps its status code; monitoring routes therefore have no `loading.tsx` (per-card Suspense replaces it, amendment 1).
- **Denied states:** a denied call renders "OpsWatch cannot read this (missing <action>)" with a link to `/accounts/<id>#permissions`; the rest of the page still renders.
- **No secrets in logs:** monitoring failures are logged as one JSON line `{ event: 'monitoring_call', connectionId, region, action, reason, code }` through `logMonitoringFailure`; never log credentials, request parameters, resource names, log query text or query results.
- **Logs Insights (Phase B):** at most 24 h range, 1000 rows (`limit: 1000`), 20 log groups; client polls every 1 s and stops after 60 s or when the user leaves; query bindings `queryId → { connectionId, region, sessionId }` live 10 minutes; unknown or foreign query ids answer 404. `StopQuery` failures are ignored.
- **Tests:** TDD; unit tests use aws-sdk-client-mock and an injected cache/clock (never the process-wide `monitoringCache`); test output must be pristine (no console noise: pass `log: () => {}` or a `vi.fn()` in `MonitoringDeps`). E2E specs run in file order against a fresh `docker-compose.test.yml` stack.
- **Verification commands** (each task runs the relevant ones and all of them before committing): `npm test`, `npm run typecheck`, `npm run lint`; e2e: `docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e; docker compose -f docker-compose.test.yml down -v`. Never run `docker compose config` against `docker-compose.yml` and never print `.env`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` (or the trailer naming the implementing model).
- Do not export symbols that nothing imports (the repository runs knip).

## Verified moto 5.2.3 behaviour

Probed on 2026-09-17 with AWS SDK 3.1134.0 against `motoserver/moto:5.2.3`. Tasks cite these facts by number.

1. **GetMetricData** with `Average`, `Sum`, `Maximum` works and aggregates by period; it returns datapoints newest first even with `ScanBy: 'TimestampAscending'`. Code always sorts ascending.
2. **Any GetMetricData request containing a percentile stat (`p95`) fails with HTTP 500** (the SDK throws a `SyntaxError` while deserializing), failing every query of that request. Hence p95 queries are sent in a separate request, their failure only blanks the p95 value, and e2e asserts the p95 unavailable state. p95 values are unit-tested only.
3. Metric math expressions return empty series; OpsWatch never uses them.
4. **Dimension matching is order-sensitive in moto** (real AWS is not): a query with `[ServiceName, ClusterName]` does not find data put with `[ClusterName, ServiceName]`. `metrics.ts` sends dimensions sorted by name, and the seed puts them sorted by name.
5. `CreateLoadBalancer` needs existing subnets (`SubnetNotFoundException` otherwise); the seed creates a VPC and two subnets first. `RegisterTargets` makes a target `healthy` in `DescribeTargetHealth`. Unknown name in `DescribeLoadBalancers({ Names })` → `LoadBalancerNotFoundException`.
6. **ECS:** clusters (with `containerInsights` setting), task definitions (with awslogs options) and services (with `loadBalancers`) work. There are no container instances, so `ListTasks` is empty, `runningCount` is 0, `pendingCount` equals desired, `events` is empty and the primary deployment stays `rolloutState: IN_PROGRESS` with `createdAt` = creation time. moto cannot produce running tasks, service events or FAILED rollouts. Unknown service → `failures: [{ reason: 'MISSING' }]`; unknown cluster in `ListServices` → `ClusterNotFoundException`.
7. **RDS:** `CreateDBInstance` (mysql) and Aurora clusters work; `PerformanceInsightsEnabled` is never returned (always undefined) and `DbiResourceId` is identical across instances; unknown instance → `DBInstanceNotFoundFault`.
8. **No Performance Insights backend:** `DescribeDimensionKeys` returns an HTML 404 (SDK `SyntaxError`).
9. **CloudWatch alarms:** `PutMetricAlarm`, `SetAlarmState` and `DescribeAlarms` work; `DescribeAlarms` ignores `MaxRecords` (single page, never a `NextToken`).
10. **Logs:** `CreateLogGroup`, `PutLogEvents`, `DescribeLogGroups` (with prefix), `StartQuery` and `GetQueryResults` work; results come back at once with status `Complete`, but `filter`/`parse` commands are ignored (every event in range is returned). `StopQuery` is not implemented (HTML 404 → `SyntaxError`). `GetQueryResults` for an unknown id fails with a `SyntaxError`.
11. `POST /moto-api/reset` clears all state (HTTP 200). moto enforces no IAM, so denied and throttled states are unit-tested only.

**E2E gaps (each task reports the ones it touches; the final report lists all):** Performance Insights top SQL; ECS FAILED and stuck rollouts; service events; running tasks table content; p95 response time values; denied and throttled card states; alarm pagination; Aurora replica lag grouping and ECS cluster grouping of insights (unit fixtures only); Logs Insights filter semantics and StopQuery round-trip.

## File Structure

```
src/lib/aws/errors.ts                       + isDeniedErrorCode (Task 2)
src/lib/aws/permissions.ts                  uses isDeniedErrorCode (Task 2)
src/lib/aws/actions.ts                      cloudwatch billedActions (Task 11)
src/lib/log.ts                              + MonitoringEvent, logMonitoringFailure (Task 2)
src/lib/connections/types.ts                + USABLE_STATUSES, isUsableStatus (Task 3)
src/lib/auth/current.ts                     + getCurrentSession (Task 12)
src/lib/http/api-error.ts                   + Logs Insights error codes (Task 12)
src/lib/monitoring/
  result.ts        typed results, error classification             (Task 2)
  cache.ts         TTL + LRU cache, cacheKey, cached, monitoringCache (Task 2)
  call.ts          AwsTarget, MonitoringDeps, runCall, describeCall, chunk (Task 2)
  metrics.ts       GetMetricData batching and caching              (Task 2)
  selection.ts     checkSelection, firstUsableSelection            (Task 3)
  target.ts        resolveTarget                                   (Task 3)
  route.ts         initMonitoringRoute                             (Task 3)
  alarms.ts                                                        (Task 5)
  ecs.ts                                                           (Task 6)
  elb.ts           target groups/health (Task 6), load balancers (Task 8)
  rds.ts, instance-memory.ts, pi.ts                                (Task 7)
  evaluate.ts, insights.ts                                         (Task 9)
  overview.ts      per-family insight loaders                      (Task 10)
  logs.ts, query-bindings.ts, logs-route.ts                        (Task 12)
  shared/
    time-range.ts, paths.ts, names.ts                              (Tasks 2, 3)
    format.ts, chart-data.ts, sparkline.ts, refresh-timer.ts       (Task 4)
    logs-queries.ts, logs-poller.ts, logs-api.ts                   (Task 13)
src/components/nav-items.ts, sidebar.tsx, connection-switcher.tsx  (Task 4)
src/components/ui/table.tsx                                        (Task 4, shadcn CLI)
src/components/monitoring/
  monitoring-header.tsx, monitoring-card.tsx, card-skeleton.tsx, suspense-card.tsx,
  failure-notice.tsx, region-selector.tsx, time-range-selector.tsx, auto-refresh.tsx,
  metric-chart.tsx, sparkline.tsx                                  (Task 4)
  target-group-panel.tsx                                           (Task 6)
  insight-list.tsx                                                 (Task 10)
src/components/getting-started/pages-section.tsx, service-cards.tsx (Task 11)
src/app/[locale]/(app)/layout.tsx                                  (Task 4: status in shell connections)
src/app/[locale]/(app)/[section]/page.tsx                          (Task 4: redirect to a selection)
src/app/[locale]/(app)/accounts/[id]/page.tsx                      (Task 4: #permissions anchor)
src/app/[locale]/(app)/c/[connectionId]/[region]/
  overview/page.tsx (Task 4), overview/cards.tsx (Task 10)
  alarms/page.tsx, alarms/cards.tsx                                (Task 5)
  containers/page.tsx, containers/cards.tsx,
  containers/[cluster]/[service]/page.tsx, .../cards.tsx           (Task 6)
  databases/page.tsx, databases/cards.tsx,
  databases/[instance]/page.tsx, .../cards.tsx                     (Task 7)
  load-balancers/page.tsx, load-balancers/cards.tsx,
  load-balancers/[name]/page.tsx, .../cards.tsx                    (Task 8)
  logs/page.tsx, logs/log-group-picker.tsx, logs/logs-query-panel.tsx (Task 13)
src/app/api/connections/[id]/regions/[region]/logs/query/route.ts, .../query/[queryId]/route.ts (Task 12)
messages/en.json, messages/fr.json                                 (Tasks 4–13)
tests/e2e/seed/moto-seed.ts, tests/e2e/global-setup.ts             (Task 1)
tests/e2e/05-monitoring-seed.spec.ts                               (Task 1)
tests/e2e/06-monitoring.spec.ts                                    (Tasks 4–10)
tests/e2e/07-logs.spec.ts                                          (Tasks 12–13)
tests/unit/monitoring-*.test.ts, logs-routes.test.ts               (Tasks 2–13)
README.md, README.fr.md                                            (Tasks 11, 13)
```

---

## Phase A

### Task 1: moto seeding harness for the end-to-end suite

Built first because it is the highest-risk part: every later e2e test depends on what moto can and cannot emulate (see "Verified moto 5.2.3 behaviour", facts 1–11).

**Files:**
- Modify: `package.json`, `package-lock.json` (devDependency `@aws-sdk/client-ec2`)
- Create: `tests/e2e/seed/moto-seed.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/05-monitoring-seed.spec.ts`
- Modify: `tests/e2e/playwright.config.ts` (global setup), `tests/e2e/helpers.ts` (moto URL and region constants)

**Interfaces:**
- Consumes: `MOTO_ACCOUNT` from `tests/e2e/helpers.ts`; the `moto` service of `docker-compose.test.yml` published on `localhost:5055`; `@aws-sdk/client-ecs`, `client-elastic-load-balancing-v2`, `client-rds`, `client-cloudwatch`, `client-cloudwatch-logs`.
- Produces (in `tests/e2e/helpers.ts`):
  - `export const MOTO_URL: string` = `process.env.E2E_MOTO_URL ?? 'http://localhost:5055'`
  - `export const MOTO_REGION = 'us-east-1'`
- Produces (in `tests/e2e/seed/moto-seed.ts`):
  - `export const SEED` (constant object, fields below)
  - `export async function waitForMoto(endpoint: string, timeoutMs?: number): Promise<void>`
  - `export async function resetMoto(endpoint: string): Promise<void>`
  - `export async function seedMoto(endpoint: string, now?: Date): Promise<SeedResult>`
  - `export type SeedResult = { vpcId: string; loadBalancerArn: string; targetGroupArn: string; loadBalancerDimension: string; targetGroupDimension: string }`
  - `export function motoClientConfig(endpoint: string)` → `{ region: 'us-east-1', endpoint, credentials: { accessKeyId: 'testing', secretAccessKey: 'testing' } }`

- [ ] **Step 1: Add the EC2 client (devDependency)**

Run: `npm install --save-dev @aws-sdk/client-ec2@^3.1134.0`
Expected: `package.json` devDependencies gains `"@aws-sdk/client-ec2": "^3.1134.0"`; `npm ls @aws-sdk/client-ec2` prints `3.1134.0`.

- [ ] **Step 2: Write the failing harness spec**

Create `tests/e2e/05-monitoring-seed.spec.ts`. It talks to moto directly (no browser) and proves the seed is what later specs rely on:

```ts
import { CloudWatchClient, DescribeAlarmsCommand, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, GetQueryResultsCommand, StartQueryCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DescribeServicesCommand, DescribeTaskDefinitionCommand, ECSClient } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, DescribeTargetHealthCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { expect, test } from '@playwright/test';
import { MOTO_URL } from './helpers';
import { SEED, motoClientConfig } from './seed/moto-seed';

const config = motoClientConfig(MOTO_URL);
const minute = (ms: number) => Math.floor(ms / 60_000) * 60_000;

test('the seeded ECS service uses the target group and an awslogs log group', async () => {
  const ecs = new ECSClient(config);
  const { services } = await ecs.send(new DescribeServicesCommand({ cluster: SEED.cluster, services: [SEED.service] }));
  expect(services?.[0]?.desiredCount).toBe(2);
  expect(services?.[0]?.loadBalancers?.[0]?.targetGroupArn).toContain(`targetgroup/${SEED.targetGroup}/`);
  const { taskDefinition } = await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: SEED.taskFamily }));
  expect(taskDefinition?.containerDefinitions?.[0]?.logConfiguration?.options?.['awslogs-group']).toBe(SEED.logGroup);
  const elb = new ElasticLoadBalancingV2Client(config);
  const health = await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: services?.[0]?.loadBalancers?.[0]?.targetGroupArn }));
  expect(health.TargetHealthDescriptions?.map((d) => [d.Target?.Id, d.TargetHealth?.State])).toEqual([[SEED.targetIp, 'healthy']]);
});

test('the seeded database instance exists', async () => {
  const rds = new RDSClient(config);
  const { DBInstances } = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: SEED.dbInstance }));
  expect(DBInstances?.[0]).toMatchObject({ Engine: 'mysql', DBInstanceClass: 'db.t3.medium' });
});

test('GetMetricData returns the seeded datapoints for dimensions sorted by name', async () => {
  const { LoadBalancers } = await new ElasticLoadBalancingV2Client(config).send(new DescribeLoadBalancersCommand({ Names: [SEED.loadBalancer] }));
  const loadBalancer = LoadBalancers?.[0]?.LoadBalancerArn?.split(':loadbalancer/')[1] ?? '';
  const cw = new CloudWatchClient(config);
  const end = new Date(minute(Date.now()));
  const out = await cw.send(
    new GetMetricDataCommand({
      StartTime: new Date(end.getTime() - 3 * 3600_000),
      EndTime: end,
      MetricDataQueries: [
        {
          Id: 'cpu',
          ReturnData: true,
          MetricStat: {
            Metric: {
              Namespace: 'AWS/ECS',
              MetricName: 'CPUUtilization',
              Dimensions: [{ Name: 'ClusterName', Value: SEED.cluster }, { Name: 'ServiceName', Value: SEED.service }],
            },
            Period: 60,
            Stat: 'Average',
          },
        },
        {
          Id: 'req',
          ReturnData: true,
          MetricStat: {
            Metric: { Namespace: 'AWS/ApplicationELB', MetricName: 'RequestCount', Dimensions: [{ Name: 'LoadBalancer', Value: loadBalancer }] },
            Period: 60,
            Stat: 'Sum',
          },
        },
      ],
    }),
  );
  const cpu = out.MetricDataResults?.find((r) => r.Id === 'cpu');
  expect(cpu?.Values).toHaveLength(SEED.datapoints);
  expect(Math.min(...(cpu?.Values ?? []))).toBeGreaterThanOrEqual(35);
  expect(Math.max(...(cpu?.Values ?? []))).toBeLessThanOrEqual(39);
  const requests = out.MetricDataResults?.find((r) => r.Id === 'req')?.Values ?? [];
  expect(requests.reduce((a, b) => a + b, 0)).toBe(SEED.datapoints * 120);
});

// Known moto 5.2.3 gap (fact 2): the whole request fails, so p95 values are only unit-tested.
test('moto rejects percentile statistics', async () => {
  const cw = new CloudWatchClient(config);
  const end = new Date(minute(Date.now()));
  await expect(
    cw.send(
      new GetMetricDataCommand({
        StartTime: new Date(end.getTime() - 3600_000),
        EndTime: end,
        MetricDataQueries: [
          {
            Id: 'p95',
            ReturnData: true,
            MetricStat: {
              Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'ClusterName', Value: SEED.cluster }, { Name: 'ServiceName', Value: SEED.service }] },
              Period: 60,
              Stat: 'p95',
            },
          },
        ],
      }),
    ),
  ).rejects.toThrow();
});

test('the seeded alarms and log events are readable', async () => {
  const cw = new CloudWatchClient(config);
  const { MetricAlarms } = await cw.send(new DescribeAlarmsCommand({ AlarmTypes: ['MetricAlarm', 'CompositeAlarm'] }));
  const states = Object.fromEntries((MetricAlarms ?? []).map((a) => [a.AlarmName, a.StateValue]));
  expect(states).toEqual({ [SEED.alarm]: 'ALARM', [SEED.targetTrackingAlarm]: 'ALARM', [SEED.okAlarm]: 'OK' });

  const logs = new CloudWatchLogsClient(config);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const { queryId } = await logs.send(
    new StartQueryCommand({ logGroupNames: [SEED.logGroup], startTime: nowSeconds - 3600, endTime: nowSeconds + 60, queryString: 'fields @timestamp, @message | sort @timestamp desc | limit 100' }),
  );
  const results = await logs.send(new GetQueryResultsCommand({ queryId }));
  expect(results.status).toBe('Complete');
  expect(results.results).toHaveLength(SEED.logMessages.length);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `docker compose -f docker-compose.test.yml up -d --build --wait && npx playwright test --config tests/e2e/playwright.config.ts 05-monitoring-seed`
Expected: FAIL at import time: `Cannot find module './seed/moto-seed'`.

- [ ] **Step 4: Write the seed module**

Create `tests/e2e/seed/moto-seed.ts`:

```ts
import { CloudWatchClient, PutMetricAlarmCommand, PutMetricDataCommand, SetAlarmStateCommand, type Dimension } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, CreateLogGroupCommand, CreateLogStreamCommand, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { CreateSubnetCommand, CreateVpcCommand, EC2Client } from '@aws-sdk/client-ec2';
import { CreateClusterCommand, CreateServiceCommand, ECSClient, RegisterTaskDefinitionCommand } from '@aws-sdk/client-ecs';
import {
  CreateListenerCommand,
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { CreateDBInstanceCommand, RDSClient } from '@aws-sdk/client-rds';

export const SEED = {
  region: 'us-east-1',
  cluster: 'opswatch-e2e',
  service: 'web',
  taskFamily: 'opswatch-web',
  logGroup: '/ecs/opswatch-web',
  logStream: 'web/web/e2e',
  logMessages: ['GET /health 200 3ms', 'GET /api/orders 500 1520ms', 'ERROR payment gateway timeout'],
  loadBalancer: 'opswatch-e2e-alb',
  targetGroup: 'opswatch-e2e-web',
  targetIp: '10.0.1.10',
  dbInstance: 'opswatch-e2e-db',
  alarm: 'opswatch-e2e-high-cpu',
  targetTrackingAlarm: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e',
  okAlarm: 'opswatch-e2e-db-connections',
  /** One datapoint per minute for the 30 whole minutes before the seed ran. */
  datapoints: 30,
} as const;

export type SeedResult = {
  vpcId: string;
  loadBalancerArn: string;
  targetGroupArn: string;
  loadBalancerDimension: string;
  targetGroupDimension: string;
};

export function motoClientConfig(endpoint: string) {
  return { region: SEED.region, endpoint, credentials: { accessKeyId: 'testing', secretAccessKey: 'testing' } };
}

export async function waitForMoto(endpoint: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${endpoint}/moto-api/`);
      if (res.ok) return;
    } catch {
      // moto is still starting
    }
    if (Date.now() > deadline) throw new Error(`moto did not answer at ${endpoint} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function resetMoto(endpoint: string): Promise<void> {
  const res = await fetch(`${endpoint}/moto-api/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`moto reset failed with HTTP ${res.status}`);
}

/** moto matches dimensions in order (fact 4): always send them sorted by name, as metrics.ts does. */
function dimensions(values: Record<string, string>): Dimension[] {
  return Object.entries(values)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([Name, Value]) => ({ Name, Value }));
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`moto returned no ${what}`);
  return value;
}

export async function seedMoto(endpoint: string, now: Date = new Date()): Promise<SeedResult> {
  const config = motoClientConfig(endpoint);
  const ec2 = new EC2Client(config);
  const elb = new ElasticLoadBalancingV2Client(config);
  const ecs = new ECSClient(config);
  const rds = new RDSClient(config);
  const cw = new CloudWatchClient(config);
  const logs = new CloudWatchLogsClient(config);

  // Network (fact 5): an ALB needs two subnets in different zones.
  const vpcId = required((await ec2.send(new CreateVpcCommand({ CidrBlock: '10.0.0.0/16' }))).Vpc?.VpcId, 'VPC id');
  const subnets = await Promise.all(
    [['10.0.1.0/24', 'us-east-1a'], ['10.0.2.0/24', 'us-east-1b']].map(async ([CidrBlock, AvailabilityZone]) =>
      required((await ec2.send(new CreateSubnetCommand({ VpcId: vpcId, CidrBlock, AvailabilityZone }))).Subnet?.SubnetId, 'subnet id'),
    ),
  );

  const loadBalancerArn = required(
    (await elb.send(new CreateLoadBalancerCommand({ Name: SEED.loadBalancer, Type: 'application', Subnets: subnets }))).LoadBalancers?.[0]?.LoadBalancerArn,
    'load balancer ARN',
  );
  const targetGroupArn = required(
    (await elb.send(new CreateTargetGroupCommand({ Name: SEED.targetGroup, Protocol: 'HTTP', Port: 80, VpcId: vpcId, TargetType: 'ip' }))).TargetGroups?.[0]?.TargetGroupArn,
    'target group ARN',
  );
  await elb.send(new CreateListenerCommand({ LoadBalancerArn: loadBalancerArn, Protocol: 'HTTP', Port: 80, DefaultActions: [{ Type: 'forward', TargetGroupArn: targetGroupArn }] }));
  await elb.send(new RegisterTargetsCommand({ TargetGroupArn: targetGroupArn, Targets: [{ Id: SEED.targetIp, Port: 80 }] }));
  const loadBalancerDimension = loadBalancerArn.split(':loadbalancer/')[1];
  const targetGroupDimension = targetGroupArn.slice(targetGroupArn.lastIndexOf(':') + 1);

  // ECS (fact 6): tasks never start, so runningCount stays 0 and the deployment stays IN_PROGRESS.
  await ecs.send(new CreateClusterCommand({ clusterName: SEED.cluster, settings: [{ name: 'containerInsights', value: 'enabled' }] }));
  await ecs.send(
    new RegisterTaskDefinitionCommand({
      family: SEED.taskFamily,
      containerDefinitions: [
        {
          name: 'web',
          image: 'nginx',
          memory: 256,
          portMappings: [{ containerPort: 80 }],
          logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': SEED.logGroup, 'awslogs-region': SEED.region, 'awslogs-stream-prefix': 'web' } },
        },
      ],
    }),
  );
  await ecs.send(
    new CreateServiceCommand({
      cluster: SEED.cluster,
      serviceName: SEED.service,
      taskDefinition: SEED.taskFamily,
      desiredCount: 2,
      loadBalancers: [{ targetGroupArn, containerName: 'web', containerPort: 80 }],
    }),
  );

  // RDS (fact 7): Performance Insights is never reported as enabled.
  await rds.send(
    new CreateDBInstanceCommand({
      DBInstanceIdentifier: SEED.dbInstance,
      DBInstanceClass: 'db.t3.medium',
      Engine: 'mysql',
      AllocatedStorage: 20,
      MasterUsername: 'admin',
      MasterUserPassword: 'not-a-real-password-1',
    }),
  );

  // Metrics: whole minutes strictly before the minute of `now`, so every datapoint is inside any window ending at the current minute.
  const base = Math.floor(now.getTime() / 60_000) * 60_000;
  const put = (Namespace: string, MetricName: string, dims: Record<string, string>, value: (i: number) => number, Unit?: 'Percent' | 'Count' | 'Bytes' | 'Seconds' | 'Count/Second') =>
    cw.send(
      new PutMetricDataCommand({
        Namespace,
        MetricData: Array.from({ length: SEED.datapoints }, (_, i) => ({
          MetricName,
          Dimensions: dimensions(dims),
          Timestamp: new Date(base - (i + 1) * 60_000),
          Value: value(i),
          ...(Unit ? { Unit } : {}),
        })),
      }),
    );
  const service = { ClusterName: SEED.cluster, ServiceName: SEED.service };
  const db = { DBInstanceIdentifier: SEED.dbInstance };
  const lb = { LoadBalancer: loadBalancerDimension };
  const tg = { LoadBalancer: loadBalancerDimension, TargetGroup: targetGroupDimension };
  await Promise.all([
    put('AWS/ECS', 'CPUUtilization', service, (i) => 35 + (i % 5), 'Percent'),
    put('AWS/ECS', 'MemoryUtilization', service, (i) => 55 + (i % 3), 'Percent'),
    put('ECS/ContainerInsights', 'RunningTaskCount', service, () => 2, 'Count'),
    put('ECS/ContainerInsights', 'DesiredTaskCount', service, () => 2, 'Count'),
    put('AWS/RDS', 'CPUUtilization', db, (i) => 20 + (i % 4), 'Percent'),
    put('AWS/RDS', 'DatabaseConnections', db, () => 12, 'Count'),
    put('AWS/RDS', 'FreeableMemory', db, () => 3 * 1024 ** 3, 'Bytes'),
    put('AWS/RDS', 'ReadIOPS', db, () => 40, 'Count/Second'),
    put('AWS/RDS', 'WriteIOPS', db, () => 25, 'Count/Second'),
    put('AWS/RDS', 'ReadLatency', db, () => 0.002, 'Seconds'),
    put('AWS/RDS', 'WriteLatency', db, () => 0.004, 'Seconds'),
    put('AWS/ApplicationELB', 'RequestCount', lb, () => 120, 'Count'),
    put('AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count', lb, () => 1, 'Count'),
    put('AWS/ApplicationELB', 'TargetResponseTime', lb, () => 0.12, 'Seconds'),
    put('AWS/ApplicationELB', 'RequestCount', tg, () => 120, 'Count'),
    put('AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count', tg, () => 1, 'Count'),
    put('AWS/ApplicationELB', 'HealthyHostCount', tg, () => 1, 'Count'),
    put('AWS/ApplicationELB', 'UnHealthyHostCount', tg, () => 0, 'Count'),
  ]);

  // Alarms (fact 9).
  const alarm = (AlarmName: string, Namespace: string, MetricName: string, dims: Record<string, string>, Threshold: number) =>
    cw.send(
      new PutMetricAlarmCommand({
        AlarmName,
        Namespace,
        MetricName,
        Dimensions: dimensions(dims),
        Statistic: 'Average',
        Period: 60,
        EvaluationPeriods: 3,
        Threshold,
        ComparisonOperator: 'GreaterThanThreshold',
      }),
    );
  await alarm(SEED.alarm, 'AWS/ECS', 'CPUUtilization', service, 30);
  await alarm(SEED.targetTrackingAlarm, 'AWS/ECS', 'CPUUtilization', service, 70);
  await alarm(SEED.okAlarm, 'AWS/RDS', 'DatabaseConnections', db, 500);
  await cw.send(new SetAlarmStateCommand({ AlarmName: SEED.alarm, StateValue: 'ALARM', StateReason: 'Seeded for end-to-end tests' }));
  await cw.send(new SetAlarmStateCommand({ AlarmName: SEED.targetTrackingAlarm, StateValue: 'ALARM', StateReason: 'Seeded for end-to-end tests' }));
  await cw.send(new SetAlarmStateCommand({ AlarmName: SEED.okAlarm, StateValue: 'OK', StateReason: 'Seeded for end-to-end tests' }));

  // Logs (fact 10): events within the last few minutes, oldest first.
  await logs.send(new CreateLogGroupCommand({ logGroupName: SEED.logGroup }));
  await logs.send(new CreateLogStreamCommand({ logGroupName: SEED.logGroup, logStreamName: SEED.logStream }));
  await logs.send(
    new PutLogEventsCommand({
      logGroupName: SEED.logGroup,
      logStreamName: SEED.logStream,
      logEvents: SEED.logMessages.map((message, i) => ({ message, timestamp: now.getTime() - (SEED.logMessages.length - i) * 60_000 })),
    }),
  );

  return { vpcId, loadBalancerArn, targetGroupArn, loadBalancerDimension, targetGroupDimension };
}
```

- [ ] **Step 5: Wire the global setup**

Add to `tests/e2e/helpers.ts`:

```ts
/** moto as published by docker-compose.test.yml; the OpsWatch container reaches it as http://moto:5000. */
export const MOTO_URL = process.env.E2E_MOTO_URL ?? 'http://localhost:5055';
/** The region of every e2e connection and of the seeded resources. */
export const MOTO_REGION = 'us-east-1';
```

Create `tests/e2e/global-setup.ts`:

```ts
import { MOTO_URL } from './helpers';
import { resetMoto, seedMoto, waitForMoto } from './seed/moto-seed';

/** Runs once before all specs: a clean moto with the resources the monitoring specs expect. */
export default async function globalSetup() {
  await waitForMoto(MOTO_URL);
  await resetMoto(MOTO_URL);
  await seedMoto(MOTO_URL);
}
```

In `tests/e2e/playwright.config.ts` add `globalSetup: './global-setup.ts',` after `testDir: '.',`, and extend the comment above `fullyParallel` with: `The global setup resets moto and seeds the resources of 05–07 (tests/e2e/seed/moto-seed.ts).`

- [ ] **Step 6: Run the harness spec and the whole suite**

Run: `npx playwright test --config tests/e2e/playwright.config.ts 05-monitoring-seed`
Expected: `5 passed`.
Run: `npm run e2e`
Expected: every Step 1 spec still passes (27) plus the 5 new tests: `32 passed`.
Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.
Then: `docker compose -f docker-compose.test.yml down -v`.

If `seedMoto` fails on a call not listed in the verified facts, do not work around it silently: report it (it changes what later tasks can e2e-test).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tests/e2e
git commit -m "test(e2e): seed moto with ECS, RDS, ALB, metrics, alarms and logs for the monitoring specs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Monitoring foundation — typed results, cache, time ranges and GetMetricData batching

**Files:**
- Create: `src/lib/monitoring/result.ts`, `src/lib/monitoring/cache.ts`, `src/lib/monitoring/call.ts`, `src/lib/monitoring/metrics.ts`, `src/lib/monitoring/shared/time-range.ts`
- Modify: `src/lib/aws/errors.ts`, `src/lib/aws/permissions.ts`, `src/lib/log.ts`
- Test: `tests/unit/monitoring-result.test.ts`, `tests/unit/monitoring-cache.test.ts`, `tests/unit/monitoring-time-range.test.ts`, `tests/unit/monitoring-metrics.test.ts`; modify `tests/unit/module-boundaries.test.ts`

**Interfaces:**
- Consumes: `awsErrorCode`, `normalizeAwsErrorCode` (`src/lib/aws/errors.ts`); `clientConfig` (`src/lib/aws/client-config.ts`); `sendWithTimeout`, `AWS_CALL_TIMEOUT_MS` (`src/lib/aws/timeout.ts`); `isOneOf` (`src/lib/type-guards.ts`); `AwsCredentialIdentity` (`@smithy/types`).
- Produces:
  - `src/lib/aws/errors.ts`: `isDeniedErrorCode(code: string): boolean`
  - `src/lib/log.ts`: `type MonitoringEvent = { event: 'monitoring_call'; connectionId: string; region: string; action: string; reason: 'denied' | 'throttled' | 'error'; code: string }`, `logMonitoringFailure(event: MonitoringEvent): void`
  - `result.ts`: `type FailureReason = 'denied' | 'throttled' | 'error'`; `type MonitoringFailure = { ok: false; reason: FailureReason; code: string; action: string }`; `type MonitoringResult<T> = { ok: true; data: T } | MonitoringFailure`; `toFailure(action: string, error: unknown): MonitoringFailure`; `attempt<T>(action: string, run: () => Promise<T>): Promise<MonitoringResult<T>>`; `isFailure(value: unknown): value is MonitoringFailure`
  - `cache.ts`: `METRICS_TTL_MS = 60_000`, `DESCRIBE_TTL_MS = 60_000`, `PI_TTL_MS = 300_000`, `MAX_CACHE_ENTRIES = 500`; `type TtlCache = { get<T>(key: string): Promise<T> | undefined; set<T>(key: string, value: Promise<T>, ttlMs: number): void; readonly size: number; clear(): void }`; `createTtlCache(options?: { maxEntries?: number; now?: () => number }): TtlCache`; `cacheKey(scope: { connectionId: string; region: string }, call: string, params: unknown): string`; `cached<T>(cache: TtlCache, key: string, ttlMs: number, load: () => Promise<MonitoringResult<T>>): Promise<MonitoringResult<T>>`; `monitoringCache: TtlCache`
  - `call.ts`: `type MonitoringScope = { connectionId: string; region: string }`; `type AwsTarget = MonitoringScope & { credentials: AwsCredentialIdentity }`; `type MonitoringDeps = { cache?: TtlCache; timeoutMs?: number; log?: (event: MonitoringEvent) => void }`; `chunk<T>(items: readonly T[], size: number): T[][]`; `describeTimeout(deps: MonitoringDeps): number`; `runCall<T>(scope: MonitoringScope, action: string, run: () => Promise<T>, deps?: MonitoringDeps): Promise<MonitoringResult<T>>`; `describeCall<T>(target: AwsTarget, action: string, params: unknown, run: () => Promise<T>, deps?: MonitoringDeps, ttlMs?: number): Promise<MonitoringResult<T>>`
  - `shared/time-range.ts`: `TIME_RANGES = ['1h','3h','12h','24h','7d'] as const`; `type TimeRange`; `DEFAULT_TIME_RANGE: TimeRange = '3h'`; `RANGE_SECONDS: Record<TimeRange, number>`; `periodForRange(range: TimeRange): number`; `parseTimeRange(value: string | string[] | undefined): TimeRange`; `type TimeWindow = { start: Date; end: Date; periodSeconds: number }`; `timeWindow(range: TimeRange, nowMs: number): TimeWindow`; `recentWindow(minutes: number, nowMs: number, periodSeconds?: number): TimeWindow`
  - `metrics.ts`: `MAX_QUERIES_PER_CALL = 500`; `METRICS_TIMEOUT_MS = 10_000`; `type MetricStatName = 'Average' | 'Sum' | 'Maximum' | 'Minimum' | 'p95'`; `type MetricQuery = { id: string; namespace: string; metricName: string; dimensions: Record<string, string>; stat: MetricStatName; label?: string }`; `type SeriesData = { timestamps: number[]; values: number[] }` (epoch ms, ascending); `type MetricSeries = SeriesData & { id: string; label: string }`; `getMetricSeries(target: AwsTarget, queries: readonly MetricQuery[], window: TimeWindow, deps?: MonitoringDeps): Promise<MonitoringResult<MetricSeries[]>>`; `seriesById(series: readonly MetricSeries[], id: string): SeriesData` (empty series when absent); `latestValue(series: SeriesData): number | null`

- [ ] **Step 1: Write the failing tests**

`tests/unit/monitoring-result.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isDeniedErrorCode } from '@/lib/aws/errors';
import { attempt, isFailure, toFailure } from '@/lib/monitoring/result';

const error = (name: string) => Object.assign(new Error(name), { name });

describe('monitoring results', () => {
  it('classifies denied, throttled and other AWS errors', () => {
    expect(toFailure('ecs:ListClusters', error('AccessDeniedException'))).toEqual({ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'ecs:ListClusters' });
    expect(toFailure('pi:DescribeDimensionKeys', error('NotAuthorizedException')).reason).toBe('denied');
    for (const code of ['Throttling', 'ThrottlingException', 'TooManyRequestsException', 'RequestLimitExceeded', 'LimitExceededException']) {
      expect(toFailure('x', error(code)).reason).toBe('throttled');
    }
    expect(toFailure('x', error('TimeoutError'))).toMatchObject({ reason: 'error', code: 'Timeout' });
    expect(toFailure('x', error('AbortError'))).toMatchObject({ reason: 'error', code: 'Timeout' });
    expect(toFailure('x', 'boom')).toMatchObject({ reason: 'error', code: 'UnknownError' });
  });

  it('wraps a call', async () => {
    expect(await attempt('x', async () => 42)).toEqual({ ok: true, data: 42 });
    expect(await attempt('x', async () => Promise.reject(error('AccessDenied')))).toMatchObject({ ok: false, reason: 'denied' });
    expect(isFailure({ ok: false, reason: 'error', code: 'X', action: 'x' })).toBe(true);
    expect(isFailure({ ok: true, data: null })).toBe(false);
    expect(isFailure(undefined)).toBe(false);
  });

  it('shares the denied pattern with the permission test', () => {
    expect(isDeniedErrorCode('AccessDenied')).toBe(true);
    expect(isDeniedErrorCode('UnauthorizedOperation')).toBe(true);
    expect(isDeniedErrorCode('ThrottlingException')).toBe(false);
  });
});
```

`tests/unit/monitoring-cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { cacheKey, cached, createTtlCache } from '@/lib/monitoring/cache';
import type { MonitoringResult } from '@/lib/monitoring/result';

const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('TTL cache', () => {
  it('reuses a successful result for its TTL, counted from when it resolved', async () => {
    const c = clock();
    const cache = createTtlCache({ now: c.now });
    const load = vi.fn(async (): Promise<MonitoringResult<number>> => ({ ok: true, data: 1 }));
    await cached(cache, 'k', 60_000, load);
    c.advance(59_999);
    await cached(cache, 'k', 60_000, load);
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(1);
    await cached(cache, 'k', 60_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares a pending load between concurrent callers', async () => {
    const cache = createTtlCache();
    const load = vi.fn(async (): Promise<MonitoringResult<string>> => ({ ok: true, data: 'x' }));
    const [a, b] = await Promise.all([cached(cache, 'k', 1000, load), cached(cache, 'k', 1000, load)]);
    expect(a).toEqual(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never keeps failures or rejections', async () => {
    const cache = createTtlCache();
    const failing = vi.fn(async (): Promise<MonitoringResult<number>> => ({ ok: false, reason: 'throttled', code: 'Throttling', action: 'x' }));
    await cached(cache, 'k', 60_000, failing);
    await cached(cache, 'k', 60_000, failing);
    expect(failing).toHaveBeenCalledTimes(2);

    cache.set('r', Promise.reject(new Error('boom')), 60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.get('r')).toBeUndefined();
  });

  it('evicts the least recently used entry beyond maxEntries', async () => {
    const cache = createTtlCache({ maxEntries: 2 });
    const value = (data: number) => Promise.resolve({ ok: true as const, data });
    cache.set('a', value(1), 60_000);
    cache.set('b', value(2), 60_000);
    cache.get('a');
    cache.set('c', value(3), 60_000);
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('builds keys independent of property order, and distinct per connection and region', () => {
    const at = new Date('2026-09-17T10:00:00Z');
    expect(cacheKey(scope, 'GetMetricData', { b: 1, a: [{ y: 2, x: 1 }], start: at, skip: undefined })).toBe(
      cacheKey(scope, 'GetMetricData', { a: [{ x: 1, y: 2 }], start: '2026-09-17T10:00:00.000Z', b: 1 }),
    );
    expect(cacheKey(scope, 'call', {})).not.toBe(cacheKey({ ...scope, connectionId: 'other0000000' }, 'call', {}));
    expect(cacheKey(scope, 'call', {})).not.toBe(cacheKey({ ...scope, region: 'us-east-1' }, 'call', {}));
  });
});
```

`tests/unit/monitoring-time-range.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseTimeRange, periodForRange, recentWindow, timeWindow } from '@/lib/monitoring/shared/time-range';

const now = Date.parse('2026-09-17T10:07:42.500Z');

describe('time ranges', () => {
  it('picks the GetMetricData period from the range', () => {
    expect(['1h', '3h', '12h', '24h', '7d'].map((r) => periodForRange(r as never))).toEqual([60, 60, 300, 300, 3600]);
  });

  it('parses the query string value, defaulting to 3h', () => {
    expect(parseTimeRange('7d')).toBe('7d');
    expect(parseTimeRange(undefined)).toBe('3h');
    expect(parseTimeRange('2h')).toBe('3h');
    expect(parseTimeRange(['12h', '1h'])).toBe('12h');
  });

  it('floors the window end to the minute so cache keys stay stable', () => {
    expect(timeWindow('3h', now)).toEqual({
      start: new Date('2026-09-17T07:07:00.000Z'),
      end: new Date('2026-09-17T10:07:00.000Z'),
      periodSeconds: 60,
    });
    expect(timeWindow('7d', now).periodSeconds).toBe(3600);
    expect(recentWindow(20, now)).toEqual({
      start: new Date('2026-09-17T09:47:00.000Z'),
      end: new Date('2026-09-17T10:07:00.000Z'),
      periodSeconds: 60,
    });
  });
});
```

`tests/unit/monitoring-metrics.test.ts` (mock `CloudWatchClient`; every call passes an isolated cache and `log`):

```ts
import { CloudWatchClient, GetMetricDataCommand, type GetMetricDataCommandInput } from '@aws-sdk/client-cloudwatch';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTtlCache } from '@/lib/monitoring/cache';
import { METRICS_TIMEOUT_MS, getMetricSeries, type MetricQuery } from '@/lib/monitoring/metrics';
import { timeWindow } from '@/lib/monitoring/shared/time-range';

const cw = mockClient(CloudWatchClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' } };
const window = timeWindow('1h', Date.parse('2026-09-17T10:00:30Z'));
const at = (iso: string) => new Date(`2026-09-17T${iso}Z`);

const cpu = (i: number): MetricQuery => ({
  id: `cpu${i}`,
  namespace: 'AWS/ECS',
  metricName: 'CPUUtilization',
  dimensions: { ServiceName: `svc${i}`, ClusterName: 'prod' },
  stat: 'Average',
});

/** Answers every query with one datapoint whose value is the query index. */
function echo() {
  cw.on(GetMetricDataCommand).callsFake((input: GetMetricDataCommandInput) => ({
    MetricDataResults: (input.MetricDataQueries ?? []).map((q, i) => ({ Id: q.Id, Timestamps: [at('09:59:00')], Values: [i] })),
  }));
}

let clockMs = 0;
let deps: { cache: ReturnType<typeof createTtlCache>; log: ReturnType<typeof vi.fn> };

beforeEach(() => {
  cw.reset();
  clockMs = 0;
  deps = { cache: createTtlCache({ now: () => clockMs }), log: vi.fn() };
});

const calls = () => cw.commandCalls(GetMetricDataCommand).map((c) => c.args[0].input);

describe('getMetricSeries', () => {
  it('sends the window, period, statistic and name-sorted dimensions', async () => {
    echo();
    const result = await getMetricSeries(target, [cpu(0), { ...cpu(1), stat: 'Sum', label: 'Total' }], window, deps);
    expect(calls()).toEqual([
      {
        StartTime: at('09:00:00'),
        EndTime: at('10:00:00'),
        ScanBy: 'TimestampAscending',
        MetricDataQueries: [
          { Id: 'q0', ReturnData: true, MetricStat: { Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'ClusterName', Value: 'prod' }, { Name: 'ServiceName', Value: 'svc0' }] }, Period: 60, Stat: 'Average' } },
          { Id: 'q1', ReturnData: true, MetricStat: { Metric: { Namespace: 'AWS/ECS', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'ClusterName', Value: 'prod' }, { Name: 'ServiceName', Value: 'svc1' }] }, Period: 60, Stat: 'Sum' } },
        ],
      },
    ]);
    expect(result).toEqual({
      ok: true,
      data: [
        { id: 'cpu0', label: 'CPUUtilization', timestamps: [at('09:59:00').getTime()], values: [0] },
        { id: 'cpu1', label: 'Total', timestamps: [at('09:59:00').getTime()], values: [1] },
      ],
    });
  });

  it('splits 1001 queries into requests of 500, 500 and 1', async () => {
    echo();
    const result = await getMetricSeries(target, Array.from({ length: 1001 }, (_, i) => cpu(i)), window, deps);
    expect(result.ok).toBe(true);
    expect(calls().map((c) => c.MetricDataQueries?.length).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 500, 500]);
  });

  it('follows NextToken and returns datapoints oldest first', async () => {
    cw.on(GetMetricDataCommand)
      .resolvesOnce({ MetricDataResults: [{ Id: 'q0', Timestamps: [at('09:02:00'), at('09:01:00')], Values: [2, 1] }], NextToken: 'page-2' })
      .resolvesOnce({ MetricDataResults: [{ Id: 'q0', Timestamps: [at('09:00:00')], Values: [0] }] });
    const result = await getMetricSeries(target, [cpu(0)], window, deps);
    expect(calls()[1].NextToken).toBe('page-2');
    expect(result).toMatchObject({ ok: true, data: [{ timestamps: [at('09:00:00'), at('09:01:00'), at('09:02:00')].map((d) => d.getTime()), values: [0, 1, 2] }] });
  });

  it('returns an empty series for a query AWS did not answer', async () => {
    cw.on(GetMetricDataCommand).resolves({ MetricDataResults: [] });
    expect(await getMetricSeries(target, [cpu(0)], window, deps)).toEqual({ ok: true, data: [{ id: 'cpu0', label: 'CPUUtilization', timestamps: [], values: [] }] });
  });

  it('serves each series from the cache for 60 seconds and only fetches the missing ones', async () => {
    echo();
    await getMetricSeries(target, [cpu(0)], window, deps);
    await getMetricSeries(target, [cpu(0), cpu(1)], window, deps);
    expect(calls().map((c) => c.MetricDataQueries?.length)).toEqual([1, 1]);
    expect(calls()[1].MetricDataQueries?.[0].MetricStat?.Metric?.Dimensions?.[1]).toEqual({ Name: 'ServiceName', Value: 'svc1' });
    clockMs += 60_000;
    await getMetricSeries(target, [cpu(0)], window, deps);
    expect(calls()).toHaveLength(3);
  });

  it('asks AWS once for identical queries with different ids', async () => {
    echo();
    const result = await getMetricSeries(target, [cpu(0), { ...cpu(0), id: 'again' }], window, deps);
    expect(calls()[0].MetricDataQueries).toHaveLength(1);
    expect(result.ok && result.data.map((s) => s.id)).toEqual(['cpu0', 'again']);
  });

  it('maps errors to typed failures, logs them without parameters and does not cache them', async () => {
    cw.on(GetMetricDataCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));
    expect(await getMetricSeries(target, [cpu(0)], window, deps)).toEqual({ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'cloudwatch:GetMetricData' });
    expect(deps.log).toHaveBeenCalledWith({ event: 'monitoring_call', connectionId: 'abc123def456', region: 'eu-west-1', action: 'cloudwatch:GetMetricData', reason: 'denied', code: 'AccessDeniedException' });
    await getMetricSeries(target, [cpu(0)], window, deps);
    expect(calls()).toHaveLength(2);
  });

  it('gives up after the timeout', async () => {
    expect(METRICS_TIMEOUT_MS).toBe(10_000);
    cw.on(GetMetricDataCommand).callsFake(() => new Promise(() => {}));
    expect(await getMetricSeries(target, [cpu(0)], window, { ...deps, timeoutMs: 5 })).toMatchObject({ ok: false, reason: 'error', code: 'Timeout' });
  });

  it('returns no request and an empty list for no queries', async () => {
    expect(await getMetricSeries(target, [], window, deps)).toEqual({ ok: true, data: [] });
    expect(calls()).toHaveLength(0);
  });
});
```

Add to `SERVER_ONLY_MODULES` in `tests/unit/module-boundaries.test.ts`: `'lib/monitoring/result.ts'`, `'lib/monitoring/cache.ts'`, `'lib/monitoring/call.ts'`, `'lib/monitoring/metrics.ts'`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/unit/monitoring-result.test.ts tests/unit/monitoring-cache.test.ts tests/unit/monitoring-time-range.test.ts tests/unit/monitoring-metrics.test.ts tests/unit/module-boundaries.test.ts`
Expected: FAIL — cannot resolve `@/lib/monitoring/result` (and the others); module-boundaries fails with ENOENT for the new paths.

- [ ] **Step 3: Implement**

`src/lib/aws/errors.ts` — add, and use it in `classifyError` of `src/lib/aws/permissions.ts` in place of its local `DENIED` regex (delete that constant):

```ts
const DENIED = /^(AccessDenied|UnauthorizedOperation|AuthorizationError|NotAuthorized)/;

/** AWS error names that mean "the identity lacks this permission". */
export function isDeniedErrorCode(code: string): boolean {
  return DENIED.test(code);
}
```

`src/lib/log.ts` — add:

```ts
/** A failed monitoring call. Names and codes only: never parameters, resource names, query text or results. */
export type MonitoringEvent = {
  event: 'monitoring_call';
  connectionId: string;
  region: string;
  action: string;
  reason: 'denied' | 'throttled' | 'error';
  code: string;
};

export function logMonitoringFailure(event: MonitoringEvent): void {
  console.info(JSON.stringify(event));
}
```

`src/lib/monitoring/result.ts`:

```ts
import 'server-only';
import { awsErrorCode, isDeniedErrorCode, normalizeAwsErrorCode } from '../aws/errors';

export type FailureReason = 'denied' | 'throttled' | 'error';
export type MonitoringFailure = { ok: false; reason: FailureReason; code: string; action: string };
export type MonitoringResult<T> = { ok: true; data: T } | MonitoringFailure;

const THROTTLED = new Set([
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'RequestLimitExceeded',
  'LimitExceededException',
  'RequestThrottled',
  'RequestThrottledException',
]);

export function toFailure(action: string, error: unknown): MonitoringFailure {
  const code = normalizeAwsErrorCode(awsErrorCode(error));
  const reason: FailureReason = isDeniedErrorCode(code) ? 'denied' : THROTTLED.has(code) ? 'throttled' : 'error';
  return { ok: false, reason, code, action };
}

export async function attempt<T>(action: string, run: () => Promise<T>): Promise<MonitoringResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return toFailure(action, error);
  }
}

export function isFailure(value: unknown): value is MonitoringFailure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}
```

`src/lib/monitoring/cache.ts`:

```ts
import 'server-only';
import { isFailure, type MonitoringResult } from './result';

export const METRICS_TTL_MS = 60_000;
export const DESCRIBE_TTL_MS = 60_000;
export const PI_TTL_MS = 5 * 60_000;
export const MAX_CACHE_ENTRIES = 500;

type Entry = { value: Promise<unknown>; expiresAt: number };

export type TtlCache = {
  /** A pending or unexpired value, marked as most recently used. */
  get<T>(key: string): Promise<T> | undefined;
  /** Stores a pending value. It expires `ttlMs` after it resolves; a failed result or a rejection removes it. */
  set<T>(key: string, value: Promise<T>, ttlMs: number): void;
  readonly size: number;
  clear(): void;
};

export function createTtlCache({ maxEntries = MAX_CACHE_ENTRIES, now = Date.now }: { maxEntries?: number; now?: () => number } = {}): TtlCache {
  const entries = new Map<string, Entry>();
  return {
    get<T>(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expiresAt <= now()) return undefined;
      entries.set(key, entry);
      return entry.value as Promise<T>;
    },
    set<T>(key: string, value: Promise<T>, ttlMs: number) {
      const entry: Entry = { value, expiresAt: Number.POSITIVE_INFINITY };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value as string);
      }
      value.then(
        (result) => {
          if (entries.get(key) !== entry) return;
          if (isFailure(result)) entries.delete(key);
          else entry.expiresAt = now() + ttlMs;
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

/** Never put credentials in `params`: keys are plain JSON. */
export function cacheKey(scope: { connectionId: string; region: string }, call: string, params: unknown): string {
  return JSON.stringify([scope.connectionId, scope.region, call, normalize(params)]);
}

export function cached<T>(cache: TtlCache, key: string, ttlMs: number, load: () => Promise<MonitoringResult<T>>): Promise<MonitoringResult<T>> {
  const hit = cache.get<MonitoringResult<T>>(key);
  if (hit) return hit;
  const value = load();
  cache.set(key, value, ttlMs);
  return value;
}

/** One cache per server process, shared by every viewer and card. */
export const monitoringCache: TtlCache = createTtlCache();
```

`src/lib/monitoring/call.ts`:

```ts
import 'server-only';
import type { AwsCredentialIdentity } from '@smithy/types';
import { AWS_CALL_TIMEOUT_MS } from '../aws/timeout';
import { logMonitoringFailure, type MonitoringEvent } from '../log';
import { DESCRIBE_TTL_MS, cacheKey, cached, monitoringCache, type TtlCache } from './cache';
import { attempt, type MonitoringResult } from './result';

export type MonitoringScope = { connectionId: string; region: string };
/** Scope plus resolved credentials. Server-side only: never pass it to a client component. */
export type AwsTarget = MonitoringScope & { credentials: AwsCredentialIdentity };
export type MonitoringDeps = { cache?: TtlCache; timeoutMs?: number; log?: (event: MonitoringEvent) => void };

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function describeTimeout(deps: MonitoringDeps): number {
  return deps.timeoutMs ?? AWS_CALL_TIMEOUT_MS;
}

export async function runCall<T>(scope: MonitoringScope, action: string, run: () => Promise<T>, deps: MonitoringDeps = {}): Promise<MonitoringResult<T>> {
  const result = await attempt(action, run);
  if (!result.ok) {
    (deps.log ?? logMonitoringFailure)({ event: 'monitoring_call', connectionId: scope.connectionId, region: scope.region, action, reason: result.reason, code: result.code });
  }
  return result;
}

/** A cached describe/list call: one AWS action, 60 s TTL by default. */
export function describeCall<T>(
  target: AwsTarget,
  action: string,
  params: unknown,
  run: () => Promise<T>,
  deps: MonitoringDeps = {},
  ttlMs: number = DESCRIBE_TTL_MS,
): Promise<MonitoringResult<T>> {
  return cached(deps.cache ?? monitoringCache, cacheKey(target, action, params), ttlMs, () => runCall(target, action, run, deps));
}
```

`src/lib/monitoring/shared/time-range.ts`:

```ts
import { isOneOf } from '@/lib/type-guards';

export const TIME_RANGES = ['1h', '3h', '12h', '24h', '7d'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];
export const DEFAULT_TIME_RANGE: TimeRange = '3h';

export const RANGE_SECONDS: Record<TimeRange, number> = { '1h': 3600, '3h': 10_800, '12h': 43_200, '24h': 86_400, '7d': 604_800 };
const PERIOD_SECONDS: Record<TimeRange, number> = { '1h': 60, '3h': 60, '12h': 300, '24h': 300, '7d': 3600 };

export function periodForRange(range: TimeRange): number {
  return PERIOD_SECONDS[range];
}

export function parseTimeRange(value: string | string[] | undefined): TimeRange {
  const first = Array.isArray(value) ? value[0] : value;
  return isOneOf(TIME_RANGES, first) ? first : DEFAULT_TIME_RANGE;
}

export type TimeWindow = { start: Date; end: Date; periodSeconds: number };

const MINUTE_MS = 60_000;
const floorToMinute = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

/** The window of a page range, ending at the current whole minute. */
export function timeWindow(range: TimeRange, nowMs: number): TimeWindow {
  const end = floorToMinute(nowMs);
  return { start: new Date(end - RANGE_SECONDS[range] * 1000), end: new Date(end), periodSeconds: periodForRange(range) };
}

/** The last `minutes` whole minutes, used by the Overview insights. */
export function recentWindow(minutes: number, nowMs: number, periodSeconds = 60): TimeWindow {
  const end = floorToMinute(nowMs);
  return { start: new Date(end - minutes * MINUTE_MS), end: new Date(end), periodSeconds };
}
```

`src/lib/monitoring/metrics.ts` — key parts (write the file exactly with this logic):

```ts
import 'server-only';
import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { METRICS_TTL_MS, cacheKey, monitoringCache } from './cache';
import { chunk, runCall, type AwsTarget, type MonitoringDeps } from './call';
import type { MonitoringResult } from './result';
import type { TimeWindow } from './shared/time-range';

export const MAX_QUERIES_PER_CALL = 500;
export const METRICS_TIMEOUT_MS = 10_000;
const MAX_PAGES = 20;
const ACTION = 'cloudwatch:GetMetricData';

export type MetricStatName = 'Average' | 'Sum' | 'Maximum' | 'Minimum' | 'p95';
export type MetricQuery = { id: string; namespace: string; metricName: string; dimensions: Record<string, string>; stat: MetricStatName; label?: string };
export type SeriesData = { timestamps: number[]; values: number[] };
export type MetricSeries = SeriesData & { id: string; label: string };

const EMPTY: SeriesData = { timestamps: [], values: [] };

function awsQuery(query: MetricQuery, id: string, periodSeconds: number): MetricDataQuery {
  return {
    Id: id,
    ReturnData: true,
    MetricStat: {
      Metric: {
        Namespace: query.namespace,
        MetricName: query.metricName,
        // Sorted by name: CloudWatch does not care, moto does (fact 4), and cache keys stay stable.
        Dimensions: Object.entries(query.dimensions).sort(([a], [b]) => (a < b ? -1 : 1)).map(([Name, Value]) => ({ Name, Value })),
      },
      Period: periodSeconds,
      Stat: query.stat,
    },
  };
}

function ascending(series: SeriesData): SeriesData {
  const byTime = new Map<number, number>();
  series.timestamps.forEach((t, i) => byTime.set(t, series.values[i]));
  const timestamps = [...byTime.keys()].sort((a, b) => a - b);
  return { timestamps, values: timestamps.map((t) => byTime.get(t) as number) };
}

type Pending = { key: string; query: MetricQuery };

async function fetchBatch(client: CloudWatchClient, batch: Pending[], window: TimeWindow, timeoutMs: number): Promise<Map<string, SeriesData>> {
  const collected = batch.map(() => ({ timestamps: [] as number[], values: [] as number[] }));
  let NextToken: string | undefined;
  let pages = 0;
  do {
    const out = await sendWithTimeout(
      client,
      new GetMetricDataCommand({
        StartTime: window.start,
        EndTime: window.end,
        ScanBy: 'TimestampAscending',
        MetricDataQueries: batch.map((p, i) => awsQuery(p.query, `q${i}`, window.periodSeconds)),
        ...(NextToken ? { NextToken } : {}),
      }),
      timeoutMs,
    );
    for (const r of out.MetricDataResults ?? []) {
      const index = Number(r.Id?.slice(1));
      const target = r.Id?.startsWith('q') ? collected[index] : undefined;
      if (!target) continue;
      target.timestamps.push(...(r.Timestamps ?? []).map((d) => d.getTime()));
      target.values.push(...(r.Values ?? []));
    }
    NextToken = out.NextToken;
    pages += 1;
  } while (NextToken && pages < MAX_PAGES);
  return new Map(batch.map((p, i) => [p.key, ascending(collected[i])]));
}

export async function getMetricSeries(target: AwsTarget, queries: readonly MetricQuery[], window: TimeWindow, deps: MonitoringDeps = {}): Promise<MonitoringResult<MetricSeries[]>> {
  const cache = deps.cache ?? monitoringCache;
  const timeoutMs = deps.timeoutMs ?? METRICS_TIMEOUT_MS;
  const keyOf = (q: MetricQuery) =>
    cacheKey(target, ACTION, { namespace: q.namespace, metricName: q.metricName, dimensions: q.dimensions, stat: q.stat, period: window.periodSeconds, start: window.start, end: window.end });

  const pending = new Map<string, Promise<MonitoringResult<SeriesData>>>();
  const misses: Pending[] = [];
  for (const query of queries) {
    const key = keyOf(query);
    if (pending.has(key) || misses.some((m) => m.key === key)) continue;
    const hit = cache.get<MonitoringResult<SeriesData>>(key);
    if (hit) pending.set(key, hit);
    else misses.push({ key, query });
  }

  if (misses.length > 0) {
    const client = new CloudWatchClient(clientConfig(target.region, target.credentials));
    for (const batch of chunk(misses, MAX_QUERIES_PER_CALL)) {
      const batchResult = runCall(target, ACTION, () => fetchBatch(client, batch, window, timeoutMs), deps);
      for (const { key } of batch) {
        const one = batchResult.then((r): MonitoringResult<SeriesData> => (r.ok ? { ok: true, data: r.data.get(key) ?? EMPTY } : r));
        cache.set(key, one, METRICS_TTL_MS);
        pending.set(key, one);
      }
    }
  }

  const results = await Promise.all(queries.map((q) => pending.get(keyOf(q)) as Promise<MonitoringResult<SeriesData>>));
  const failure = results.find((r) => !r.ok);
  if (failure && !failure.ok) return failure;
  return {
    ok: true,
    data: queries.map((q, i) => {
      const r = results[i];
      return { id: q.id, label: q.label ?? q.metricName, ...(r.ok ? r.data : EMPTY) };
    }),
  };
}

export function seriesById(series: readonly MetricSeries[], id: string): SeriesData {
  const found = series.find((s) => s.id === id);
  return found ? { timestamps: found.timestamps, values: found.values } : EMPTY;
}

export function latestValue(series: SeriesData): number | null {
  return series.values.length > 0 ? series.values[series.values.length - 1] : null;
}
```

Replace the `misses.some` linear scan with a `Set<string>` of missed keys if you prefer; the behaviour must stay identical.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/unit/monitoring-result.test.ts tests/unit/monitoring-cache.test.ts tests/unit/monitoring-time-range.test.ts tests/unit/monitoring-metrics.test.ts tests/unit/module-boundaries.test.ts tests/unit/aws-permissions.test.ts`
Expected: all pass (aws-permissions proves `classifyError` is unchanged).

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean, no console output from the new tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aws/errors.ts src/lib/aws/permissions.ts src/lib/log.ts src/lib/monitoring tests/unit
git commit -m "feat(monitoring): typed AWS results, TTL cache and GetMetricData batching

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: Connection and region loader, credential target and monitoring paths

**Files:**
- Create: `src/lib/monitoring/selection.ts`, `src/lib/monitoring/target.ts`, `src/lib/monitoring/route.ts`, `src/lib/monitoring/shared/paths.ts`, `src/lib/monitoring/shared/names.ts`
- Modify: `src/lib/connections/types.ts`
- Test: `tests/unit/monitoring-selection.test.ts`, `tests/unit/monitoring-target.test.ts`, `tests/unit/monitoring-route.test.ts`, `tests/unit/monitoring-paths.test.ts`; modify `tests/unit/module-boundaries.test.ts`

**Interfaces:**
- Consumes: `ConnectionRow` (`src/lib/db/schema.ts`); `ConnectionStatus` (`src/lib/connections/types.ts`); `findConnection`, `credentialsInputFor`, `ConnectionInputError` (`src/lib/connections/repository.ts`); `DecryptionError` (`src/lib/crypto.ts`); `credentialResolver` (`src/lib/connections/resolver.ts`); `CredentialResolver` (`src/lib/aws/credentials.ts`); `getDb`, `Db` (`src/lib/db/client.ts`); `env` (`src/lib/env.ts`); `initProtectedRoute` (`src/lib/auth/route.ts`); `redirect` (`@/i18n/navigation`); `notFound` (`next/navigation`); `AppLocale` (`src/i18n/routing.ts`); `isOneOf`; `MonitoringScope`, `AwsTarget` (Task 2 `call.ts`); `MonitoringResult`, `toFailure` (Task 2 `result.ts`). Test fixtures: `createTestDb`, `createReadyRoleConnection`, `connectionInput`, `TEST_SECRET`, `OTHER_SECRET`, `NOW` (`tests/helpers`).
- Produces:
  - `src/lib/connections/types.ts`: `USABLE_STATUSES = ['ok', 'degraded'] as const satisfies readonly ConnectionStatus[]`; `isUsableStatus(status: string): boolean`
  - `selection.ts`: `type SelectionCheck = { kind: 'ok'; row: ConnectionRow } | { kind: 'not_found' } | { kind: 'unusable'; connectionId: string }`; `checkSelection(row: ConnectionRow | null, region: string): SelectionCheck`; `firstUsableSelection(rows: readonly ConnectionRow[]): MonitoringScope | null`
  - `target.ts`: `ASSUME_ROLE_ACTION = 'sts:AssumeRole'`; `type TargetDeps = { db?: Db; secret?: string; resolver?: CredentialResolver }`; `resolveTarget(scope: MonitoringScope, deps?: TargetDeps): Promise<MonitoringResult<AwsTarget>>`
  - `route.ts`: `type MonitoringParams = { locale: string; connectionId: string; region: string }`; `type MonitoringConnection = { id: string; name: string; regions: string[]; status: ConnectionStatus }`; `type MonitoringPageContext = { locale: AppLocale; scope: MonitoringScope; connection: MonitoringConnection }`; `initMonitoringRoute(params: Promise<MonitoringParams>): Promise<MonitoringPageContext>`
  - `shared/paths.ts`: `MONITORING_SECTIONS = ['overview', 'containers', 'databases', 'load-balancers', 'alarms', 'logs'] as const`; `type MonitoringSection`; `type ScopeRef = { connectionId: string; region: string }`; `monitoringPath(scope: ScopeRef, section: MonitoringSection, ...segments: string[]): string`; `type ParsedMonitoringPath = ScopeRef & { section: MonitoringSection | null; segments: string[] }`; `parseMonitoringPath(pathname: string): ParsedMonitoringPath | null`; `withRegion(pathname: string, region: string): string`; `switchConnectionPath(pathname: string, target: ScopeRef): string`; `permissionsPath(connectionId: string): string`
  - `shared/names.ts`: `isEcsName(value: string): boolean`, `isDbInstanceId(value: string): boolean`, `isLoadBalancerName(value: string): boolean`

- [ ] **Step 1: Write the failing tests**

`tests/unit/monitoring-selection.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createConnection, saveTestResult } from '@/lib/connections/repository';
import type { OverallStatus } from '@/lib/aws/permission-types';
import type { Db } from '@/lib/db/client';
import { checkSelection, firstUsableSelection } from '@/lib/monitoring/selection';
import { createTestDb } from '../helpers/db';
import { NOW, connectionInput, createReadyRoleConnection } from '../helpers/fixtures';

let db: Db;
beforeEach(() => {
  db = createTestDb();
});

const tested = (overall: OverallStatus, regions = ['eu-west-1']) => {
  const row = createReadyRoleConnection(db, { regions });
  return saveTestResult(db, row.id, { overall, accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
};

describe('checkSelection', () => {
  it('accepts a configured region of an ok or degraded connection', () => {
    expect(checkSelection(tested('ok'), 'eu-west-1')).toMatchObject({ kind: 'ok' });
    expect(checkSelection(tested('degraded'), 'eu-west-1')).toMatchObject({ kind: 'ok' });
  });

  it('treats an unknown connection or a region the connection does not use as not found', () => {
    expect(checkSelection(null, 'eu-west-1')).toEqual({ kind: 'not_found' });
    expect(checkSelection(tested('ok'), 'us-east-1')).toEqual({ kind: 'not_found' });
    expect(checkSelection(tested('failed'), 'us-east-1')).toEqual({ kind: 'not_found' });
  });

  it('reports connections that have not passed their test as unusable', () => {
    const failed = tested('failed');
    expect(checkSelection(failed, 'eu-west-1')).toEqual({ kind: 'unusable', connectionId: failed.id });
    const pending = createReadyRoleConnection(db);
    expect(checkSelection(pending, 'eu-west-1')).toEqual({ kind: 'unusable', connectionId: pending.id });
  });
});

describe('firstUsableSelection', () => {
  it('picks the first usable connection in list order and its first region', () => {
    const draft = createConnection(db, connectionInput({ method: 'keys' }), NOW);
    const ok = tested('ok', ['eu-west-3', 'eu-west-1']);
    expect(firstUsableSelection([draft, ok])).toEqual({ connectionId: ok.id, region: 'eu-west-3' });
    expect(firstUsableSelection([draft])).toBeNull();
  });
});
```

`tests/unit/monitoring-target.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialResolver } from '@/lib/aws/credentials';
import { createConnection, setAccessKeys } from '@/lib/connections/repository';
import type { Db } from '@/lib/db/client';
import { resolveTarget } from '@/lib/monitoring/target';
import { createTestDb } from '../helpers/db';
import { NOW, OTHER_SECRET, TEST_SECRET, connectionInput, createReadyRoleConnection } from '../helpers/fixtures';

const credentials = { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' };
let db: Db;
let resolver: CredentialResolver;

beforeEach(() => {
  db = createTestDb();
  resolver = { resolve: vi.fn(async () => credentials), forget: vi.fn() };
});

describe('resolveTarget', () => {
  it('resolves the credentials of the connection for the region', async () => {
    const row = createReadyRoleConnection(db);
    const result = await resolveTarget({ connectionId: row.id, region: 'eu-west-1' }, { db, secret: TEST_SECRET, resolver });
    expect(result).toEqual({ ok: true, data: { connectionId: row.id, region: 'eu-west-1', credentials } });
    expect(resolver.resolve).toHaveBeenCalledWith({ method: 'role', connectionId: row.id, roleArn: row.roleArn, externalId: row.externalId }, 'eu-west-1');
  });

  it('reports a missing connection, unfinished setup and a changed secret as errors', async () => {
    const scope = (connectionId: string) => ({ connectionId, region: 'eu-west-1' });
    expect(await resolveTarget(scope('000000000000'), { db, secret: TEST_SECRET, resolver })).toEqual({ ok: false, reason: 'error', code: 'ConnectionNotFound', action: 'sts:AssumeRole' });

    const draft = createConnection(db, connectionInput({ method: 'keys' }), NOW);
    expect(await resolveTarget(scope(draft.id), { db, secret: TEST_SECRET, resolver })).toMatchObject({ ok: false, reason: 'error', code: 'NotReady' });

    setAccessKeys(db, draft.id, { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }, OTHER_SECRET, NOW);
    expect(await resolveTarget(scope(draft.id), { db, secret: TEST_SECRET, resolver })).toMatchObject({ ok: false, reason: 'error', code: 'SecretChanged' });
  });

  it('maps an AssumeRole refusal to a denied failure', async () => {
    const row = createReadyRoleConnection(db);
    vi.mocked(resolver.resolve).mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    expect(await resolveTarget({ connectionId: row.id, region: 'eu-west-1' }, { db, secret: TEST_SECRET, resolver })).toEqual({ ok: false, reason: 'denied', code: 'AccessDenied', action: 'sts:AssumeRole' });
  });
});
```

`tests/unit/monitoring-route.test.ts` (same mocking style as `tests/unit/connection-actions.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTestResult } from '@/lib/connections/repository';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';
import { NOW, createReadyRoleConnection } from '../helpers/fixtures';

class RedirectSignal extends Error {
  constructor(public readonly target: unknown) {
    super('NEXT_REDIRECT');
  }
}
class NotFoundSignal extends Error {}

const state = vi.hoisted(() => ({ db: undefined as unknown as Db, signedIn: true, getDb: vi.fn() }));

vi.mock('@/lib/auth/route', () => ({
  initProtectedRoute: async (params: Promise<{ locale: string }>) => {
    const { locale } = await params;
    if (!state.signedIn) throw new RedirectSignal({ href: '/login', locale });
    return { locale, adminId: 1 };
  },
}));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.getDb(),
}));
vi.mock('@/i18n/navigation', () => ({
  redirect: (target: unknown) => {
    throw new RedirectSignal(target);
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundSignal();
  },
}));

const { initMonitoringRoute } = await import('@/lib/monitoring/route');

beforeEach(() => {
  state.db = createTestDb();
  state.signedIn = true;
  state.getDb.mockReset();
  state.getDb.mockImplementation(() => state.db);
});

const params = (connectionId: string, region = 'eu-west-1') => Promise.resolve({ locale: 'en', connectionId, region });

describe('initMonitoringRoute', () => {
  it('checks the session before reading any connection', async () => {
    state.signedIn = false;
    await expect(initMonitoringRoute(params('abc123def456'))).rejects.toBeInstanceOf(RedirectSignal);
    expect(state.getDb).not.toHaveBeenCalled();
  });

  it('answers not found for an unknown connection or an unconfigured region', async () => {
    const row = saveTestResult(state.db, createReadyRoleConnection(state.db).id, { overall: 'ok', accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
    await expect(initMonitoringRoute(params('000000000000'))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(initMonitoringRoute(params(row.id, 'us-east-1'))).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it('sends an unusable connection to its connection page', async () => {
    const row = createReadyRoleConnection(state.db);
    await expect(initMonitoringRoute(params(row.id))).rejects.toMatchObject({ target: { href: `/accounts/${row.id}`, locale: 'en' } });
  });

  it('returns the locale, scope and connection summary', async () => {
    const row = saveTestResult(state.db, createReadyRoleConnection(state.db).id, { overall: 'degraded', accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
    expect(await initMonitoringRoute(params(row.id))).toEqual({
      locale: 'en',
      scope: { connectionId: row.id, region: 'eu-west-1' },
      connection: { id: row.id, name: 'production', regions: ['eu-west-1'], status: 'degraded' },
    });
  });
});
```

`tests/unit/monitoring-paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isDbInstanceId, isEcsName, isLoadBalancerName } from '@/lib/monitoring/shared/names';
import { monitoringPath, parseMonitoringPath, permissionsPath, switchConnectionPath, withRegion } from '@/lib/monitoring/shared/paths';

const scope = { connectionId: 'abc123def456', region: 'eu-west-1' };

describe('monitoring paths', () => {
  it('builds section and resource paths', () => {
    expect(monitoringPath(scope, 'overview')).toBe('/c/abc123def456/eu-west-1/overview');
    expect(monitoringPath(scope, 'containers', 'prod', 'web')).toBe('/c/abc123def456/eu-west-1/containers/prod/web');
    expect(permissionsPath('abc123def456')).toBe('/accounts/abc123def456#permissions');
  });

  it('parses a pathname without its locale', () => {
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/load-balancers/my-alb')).toEqual({ ...scope, section: 'load-balancers', segments: ['my-alb'] });
    expect(parseMonitoringPath('/c/abc123def456/eu-west-1/nope')).toEqual({ ...scope, section: null, segments: [] });
    expect(parseMonitoringPath('/accounts/abc123def456')).toBeNull();
    expect(parseMonitoringPath('/c/abc123def456')).toBeNull();
  });

  it('switches region or connection and keeps only the section', () => {
    expect(withRegion('/c/abc123def456/eu-west-1/containers/prod/web', 'us-east-1')).toBe('/c/abc123def456/us-east-1/containers');
    expect(withRegion('/accounts', 'us-east-1')).toBe('/accounts');
    expect(switchConnectionPath('/c/abc123def456/eu-west-1/alarms', { connectionId: 'def456abc123', region: 'us-east-1' })).toBe('/c/def456abc123/us-east-1/alarms');
    expect(switchConnectionPath('/accounts', { connectionId: 'def456abc123', region: 'us-east-1' })).toBe('/c/def456abc123/us-east-1/overview');
  });
});

describe('resource names in URLs', () => {
  it('accepts only AWS naming patterns', () => {
    expect(isEcsName('ecs-gigs-prod')).toBe(true);
    expect(isEcsName('seller_api')).toBe(true);
    expect(isEcsName('a/b')).toBe(false);
    expect(isEcsName('')).toBe(false);
    expect(isDbInstanceId('opswatch-e2e-db')).toBe(true);
    expect(isDbInstanceId('1db')).toBe(false);
    expect(isLoadBalancerName('opswatch-e2e-alb')).toBe(true);
    expect(isLoadBalancerName('-alb')).toBe(false);
    expect(isLoadBalancerName('a'.repeat(33))).toBe(false);
  });
});
```

Add `'lib/monitoring/selection.ts'`, `'lib/monitoring/target.ts'`, `'lib/monitoring/route.ts'` to `SERVER_ONLY_MODULES`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/unit/monitoring-selection.test.ts tests/unit/monitoring-target.test.ts tests/unit/monitoring-route.test.ts tests/unit/monitoring-paths.test.ts tests/unit/module-boundaries.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement**

`src/lib/connections/types.ts` — add:

```ts
/** Statuses whose connection can be monitored: its last permission test passed at least partly. */
export const USABLE_STATUSES = ['ok', 'degraded'] as const satisfies readonly ConnectionStatus[];

export function isUsableStatus(status: string): boolean {
  return (USABLE_STATUSES as readonly string[]).includes(status);
}
```

`src/lib/monitoring/selection.ts`:

```ts
import 'server-only';
import { isUsableStatus } from '../connections/types';
import type { ConnectionRow } from '../db/schema';
import type { MonitoringScope } from './call';

export type SelectionCheck = { kind: 'ok'; row: ConnectionRow } | { kind: 'not_found' } | { kind: 'unusable'; connectionId: string };

/** The region is checked first: a region the connection does not use is a 404 whatever the status. */
export function checkSelection(row: ConnectionRow | null, region: string): SelectionCheck {
  if (!row || !row.regions.includes(region)) return { kind: 'not_found' };
  if (!isUsableStatus(row.status)) return { kind: 'unusable', connectionId: row.id };
  return { kind: 'ok', row };
}

export function firstUsableSelection(rows: readonly ConnectionRow[]): MonitoringScope | null {
  const row = rows.find((r) => isUsableStatus(r.status));
  return row ? { connectionId: row.id, region: row.regions[0] } : null;
}
```

`src/lib/monitoring/target.ts`:

```ts
import 'server-only';
import type { CredentialResolver } from '../aws/credentials';
import { ConnectionInputError, credentialsInputFor, findConnection } from '../connections/repository';
import { credentialResolver } from '../connections/resolver';
import { DecryptionError } from '../crypto';
import { getDb, type Db } from '../db/client';
import { env } from '../env';
import type { AwsTarget, MonitoringScope } from './call';
import { toFailure, type MonitoringResult } from './result';

export const ASSUME_ROLE_ACTION = 'sts:AssumeRole';

export type TargetDeps = { db?: Db; secret?: string; resolver?: CredentialResolver };

/** Called inside each card (never before the page shell): AssumeRole can take up to 5 s. The resolver caches role credentials. */
export async function resolveTarget(scope: MonitoringScope, deps: TargetDeps = {}): Promise<MonitoringResult<AwsTarget>> {
  const db = deps.db ?? getDb();
  const row = findConnection(db, scope.connectionId);
  if (!row) return { ok: false, reason: 'error', code: 'ConnectionNotFound', action: ASSUME_ROLE_ACTION };
  try {
    const input = credentialsInputFor(row, deps.secret ?? env().OPSWATCH_SECRET);
    const credentials = await (deps.resolver ?? credentialResolver).resolve(input, scope.region);
    return { ok: true, data: { connectionId: scope.connectionId, region: scope.region, credentials } };
  } catch (error) {
    if (error instanceof ConnectionInputError) return { ok: false, reason: 'error', code: 'NotReady', action: ASSUME_ROLE_ACTION };
    if (error instanceof DecryptionError) return { ok: false, reason: 'error', code: 'SecretChanged', action: ASSUME_ROLE_ACTION };
    return toFailure(ASSUME_ROLE_ACTION, error);
  }
}
```

`src/lib/monitoring/route.ts`:

```ts
import 'server-only';
import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { initProtectedRoute } from '../auth/route';
import { findConnection } from '../connections/repository';
import type { ConnectionStatus } from '../connections/types';
import { getDb } from '../db/client';
import type { MonitoringScope } from './call';
import { checkSelection } from './selection';

export type MonitoringParams = { locale: string; connectionId: string; region: string };
export type MonitoringConnection = { id: string; name: string; regions: string[]; status: ConnectionStatus };
export type MonitoringPageContext = { locale: AppLocale; scope: MonitoringScope; connection: MonitoringConnection };

/**
 * First statement of every monitoring page. Session first, then a database-only check of the connection and
 * region, all before any Suspense boundary so an unknown selection still answers 404.
 */
export async function initMonitoringRoute(params: Promise<MonitoringParams>): Promise<MonitoringPageContext> {
  const { locale } = await initProtectedRoute(params);
  const { connectionId, region } = await params;
  const check = checkSelection(findConnection(getDb(), connectionId), region);
  if (check.kind === 'not_found') notFound();
  if (check.kind === 'unusable') return redirect({ href: `/accounts/${check.connectionId}`, locale });
  const { id, name, regions, status } = check.row;
  return { locale, scope: { connectionId: id, region }, connection: { id, name, regions, status } };
}
```

`src/lib/monitoring/shared/paths.ts`:

```ts
import { isOneOf } from '@/lib/type-guards';

export const MONITORING_SECTIONS = ['overview', 'containers', 'databases', 'load-balancers', 'alarms', 'logs'] as const;
export type MonitoringSection = (typeof MONITORING_SECTIONS)[number];
export type ScopeRef = { connectionId: string; region: string };
export type ParsedMonitoringPath = ScopeRef & { section: MonitoringSection | null; segments: string[] };

/** A path without locale prefix, for next-intl's Link and redirect. */
export function monitoringPath(scope: ScopeRef, section: MonitoringSection, ...segments: string[]): string {
  return ['', 'c', scope.connectionId, scope.region, section, ...segments].map(encodeURIComponent).join('/');
}

/** Parses next-intl's usePathname() value (no locale prefix). */
export function parseMonitoringPath(pathname: string): ParsedMonitoringPath | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'c' || parts.length < 3) return null;
  const section = isOneOf(MONITORING_SECTIONS, parts[3]) ? parts[3] : null;
  return { connectionId: parts[1], region: parts[2], section, segments: section ? parts.slice(4) : [] };
}

/** Resources differ per region, so only the section is kept. */
export function withRegion(pathname: string, region: string): string {
  const parsed = parseMonitoringPath(pathname);
  return parsed ? monitoringPath({ connectionId: parsed.connectionId, region }, parsed.section ?? 'overview') : pathname;
}

export function switchConnectionPath(pathname: string, target: ScopeRef): string {
  return monitoringPath(target, parseMonitoringPath(pathname)?.section ?? 'overview');
}

export function permissionsPath(connectionId: string): string {
  return `/accounts/${connectionId}#permissions`;
}
```

`src/lib/monitoring/shared/names.ts`:

```ts
// URL segments are checked against AWS naming rules before any lookup, so they never need decoding tricks.
export const isEcsName = (value: string) => /^[A-Za-z0-9_-]{1,255}$/.test(value);
export const isDbInstanceId = (value: string) => /^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(value);
export const isLoadBalancerName = (value: string) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,30}[A-Za-z0-9])?$/.test(value);
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/unit/monitoring-selection.test.ts tests/unit/monitoring-target.test.ts tests/unit/monitoring-route.test.ts tests/unit/monitoring-paths.test.ts tests/unit/module-boundaries.test.ts`
Expected: all pass.

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: clean. (Some Task 3 exports are only used from Task 4 on; knip is not part of CI, but do not add exports beyond the list above.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/connections/types.ts src/lib/monitoring tests/unit
git commit -m "feat(monitoring): connection and region loader, credential target and monitoring paths

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Navigation, URL structure and shared monitoring UI

**Files:**
- Modify: `package.json`, `package-lock.json` (`recharts`, `react-is`)
- Create (shadcn CLI): `src/components/ui/table.tsx`
- Create: `src/lib/monitoring/shared/format.ts`, `src/lib/monitoring/shared/chart-data.ts`, `src/lib/monitoring/shared/sparkline.ts`, `src/lib/monitoring/shared/refresh-timer.ts`
- Create: `src/components/monitoring/monitoring-header.tsx`, `monitoring-card.tsx`, `card-skeleton.tsx`, `suspense-card.tsx`, `failure-notice.tsx`, `region-selector.tsx`, `time-range-selector.tsx`, `auto-refresh.tsx`, `metric-chart.tsx`, `sparkline.tsx`
- Create: `src/app/[locale]/(app)/[section]/page.tsx`, `src/app/[locale]/(app)/c/[connectionId]/[region]/overview/page.tsx`
- Modify: `src/components/nav-items.ts`, `src/components/sidebar.tsx`, `src/components/connection-switcher.tsx`, `src/app/[locale]/(app)/layout.tsx`, `src/app/[locale]/(app)/accounts/[id]/page.tsx`, `src/app/globals.css`, `src/i18n/client-messages.ts`, `messages/en.json`, `messages/fr.json`
- Test: `tests/unit/monitoring-format.test.ts`, `tests/unit/monitoring-refresh-timer.test.ts`, `tests/unit/nav-items.test.ts`, `tests/unit/monitoring-redirect.test.ts`
- E2E: modify `tests/e2e/helpers.ts`, `tests/e2e/03-connections.spec.ts`; create `tests/e2e/06-monitoring.spec.ts`

**Interfaces:**
- Consumes: Task 2 `TimeRange`, `TIME_RANGES`, `parseTimeRange`, `MonitoringFailure`; Task 3 `initMonitoringRoute`, `MonitoringParams`, `MonitoringPageContext`, `firstUsableSelection`, `MONITORING_SECTIONS`, `MonitoringSection`, `monitoringPath`, `parseMonitoringPath`, `withRegion`, `switchConnectionPath`, `permissionsPath`, `USABLE_STATUSES`/`isUsableStatus`; existing `PageHeader`, `Card*`, `Button`, `DropdownMenu*`, `Link`/`usePathname`/`useRouter`/`redirect` (`@/i18n/navigation`), `initProtectedRoute`, `listConnections`, `getDb`, `localizedTitle`, `TONE_BORDER`, `TONE_TEXT`, `cn`, `isOneOf`; `rscHeaders`, `login`, `MOTO_REGION`, `MOTO_ACCOUNT` (e2e helpers).
- Produces:
  - `shared/format.ts`: `type MetricUnit = 'percent' | 'count' | 'rate' | 'bytes' | 'seconds' | 'milliseconds'`; `NO_VALUE = '—'`; `formatMetricValue(value: number | null | undefined, unit: MetricUnit, locale: string): string`; `formatAxisTime(timestamp: number, range: TimeRange, locale: string, timeZone?: string): string`
  - `shared/chart-data.ts`: `type ChartRow = { t: number; [key: `s${number}`]: number | null }`; `mergeSeriesRows(series: readonly { timestamps: number[]; values: number[] }[]): ChartRow[]`
  - `shared/sparkline.ts`: `SPARKLINE_WIDTH = 80`, `SPARKLINE_HEIGHT = 24`; `sparklinePoints(values: readonly number[], width?: number, height?: number, max?: number): string`
  - `shared/refresh-timer.ts`: `AUTO_REFRESH_MS = 120_000`; `type RefreshTimer = { setPaused(paused: boolean): void; setVisible(visible: boolean): void; dispose(): void }`; `createRefreshTimer(options: { onTick: () => void; visible: boolean; paused: boolean; intervalMs?: number }): RefreshTimer`
  - `nav-items.ts`: `type NavKey = 'overview' | 'containers' | 'databases' | 'loadBalancers' | 'alarms' | 'logs' | 'gettingStarted' | 'accounts'`; `type NavItem = { key: NavKey; icon: LucideIcon } & ({ kind: 'monitoring'; section: MonitoringSection } | { kind: 'static'; href: string })`; `NAV_ITEMS: readonly NavItem[]`; `navHref(item: NavItem, pathname: string): string`; `isNavActive(item: NavItem, pathname: string): boolean`
  - `connection-switcher.tsx`: `type ShellConnection = Pick<ConnectionRow, 'id' | 'name' | 'regions' | 'status'>`
  - Components (props exactly):
    - `MonitoringHeader({ context, title, description, range, autoRefresh = true }: { context: MonitoringPageContext; title: string; description: string; range?: TimeRange; autoRefresh?: boolean })` — server
    - `MonitoringCard({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string })` — server-compatible
    - `CardSkeleton({ title, variant, rows = 3 }: { title: string; variant: 'table' | 'chart' | 'stat'; rows?: number })` — async server
    - `SuspenseCard({ title, variant, rows, children }: { title: string; variant: 'table' | 'chart' | 'stat'; rows?: number; children: ReactNode })` — server
    - `FailureNotice({ failure, connectionId }: { failure: MonitoringFailure; connectionId: string })` — async server
    - `RegionSelector({ regions, current, range }: { regions: string[]; current: string; range?: TimeRange })` — client
    - `TimeRangeSelector({ current, ranges = TIME_RANGES }: { current: TimeRange; ranges?: readonly TimeRange[] })` — client
    - `AutoRefresh()` — client
    - `MetricChart({ title, unit, range, series }: { title: string; unit: MetricUnit; range: TimeRange; series: ChartSeries[] })` with `type ChartSeries = { id: string; label: string; timestamps: number[]; values: number[] }` — client
    - `Sparkline({ values, label, max }: { values: number[]; label: string; max?: number })` — server-compatible (no directive)
  - e2e helpers: `createConnection(page, method, name, region?)` (moved from `03-connections.spec.ts`), `MONITORING_CONNECTION = 'Moto monitoring'`, `ensureMonitoringConnection(page: Page): Promise<string>`, `monitoringUrl(connectionId: string, section: string, suffix?: string): string`

Decisions recorded for this task:
- No `loading.tsx` under `c/[connectionId]/[region]`: a route-level Suspense would stream before `initMonitoringRoute` and turn its 404 into a 200 (Next.js 16 `loading.js` docs, "Status Codes"). Each card has its own `SuspenseCard`.
- The Overview evaluates the last 15 minutes, so its header has no time range selector (`range` omitted); every other data page passes `range`.
- Sidebar order: Overview, Containers, Databases, Load balancers, Alarms, Logs, then Getting started and Accounts. Monitoring links keep the current connection and region; outside a monitoring URL they point to `/<section>`, which redirects to the first usable selection.

- [ ] **Step 1: Install recharts and add the table component**

Run: `npm install --save-exact recharts@3.10.1 react-is@19.2.8`
Expected: `"recharts": "3.10.1"` and `"react-is": "19.2.8"` in dependencies; `npm ls recharts react-is` shows those versions with no peer warnings.
Run: `npx shadcn add table`
Expected: creates `src/components/ui/table.tsx` (the `cn` import must be `import { cn } from "cn"` or `@/lib/utils` like the other ui files; keep whatever the CLI writes if typecheck passes).

- [ ] **Step 2: Write the failing unit tests**

`tests/unit/monitoring-format.test.ts` (expected strings measured with Node 22 ICU; French uses U+00A0 before `%` and `k`, and U+202F elsewhere):

```ts
import { describe, expect, it } from 'vitest';
import { mergeSeriesRows } from '@/lib/monitoring/shared/chart-data';
import { formatAxisTime, formatMetricValue } from '@/lib/monitoring/shared/format';
import { sparklinePoints } from '@/lib/monitoring/shared/sparkline';

describe('formatMetricValue', () => {
  it('formats each unit in English and French', () => {
    expect(formatMetricValue(12.5, 'percent', 'en')).toBe('12.5%');
    expect(formatMetricValue(12.5, 'percent', 'fr')).toBe('12,5 %');
    expect(formatMetricValue(842, 'count', 'en')).toBe('842');
    expect(formatMetricValue(12_345, 'count', 'en')).toBe('12.3K');
    expect(formatMetricValue(12_345, 'count', 'fr')).toBe('12,3 k');
    expect(formatMetricValue(40.25, 'rate', 'en')).toBe('40.3');
    expect(formatMetricValue(3 * 1024 ** 3, 'bytes', 'en')).toBe('3 GB');
    expect(formatMetricValue(3 * 1024 ** 3, 'bytes', 'fr')).toBe('3 Go');
    expect(formatMetricValue(512 * 1024 ** 2, 'bytes', 'en')).toBe('512 MB');
    expect(formatMetricValue(0.12, 'seconds', 'en')).toBe('120 ms');
    expect(formatMetricValue(1.5, 'seconds', 'fr')).toBe('1,5 s');
    expect(formatMetricValue(120, 'milliseconds', 'fr')).toBe('120 ms');
    expect(formatMetricValue(1500, 'milliseconds', 'en')).toBe('1.5 sec');
    expect(formatMetricValue(null, 'percent', 'en')).toBe('—');
    expect(formatMetricValue(Number.NaN, 'count', 'en')).toBe('—');
  });

  it('formats chart axis times per range', () => {
    const t = Date.parse('2026-09-17T14:05:00Z');
    expect(formatAxisTime(t, '3h', 'en', 'UTC')).toBe('02:05 PM');
    expect(formatAxisTime(t, '3h', 'fr', 'UTC')).toBe('14:05');
    expect(formatAxisTime(t, '7d', 'fr', 'UTC')).toBe('jeu. 14:05');
  });
});

describe('chart rows and sparklines', () => {
  it('merges series on their timestamps', () => {
    expect(mergeSeriesRows([{ timestamps: [1, 2], values: [10, 20] }, { timestamps: [2, 3], values: [5, 6] }])).toEqual([
      { t: 1, s0: 10, s1: null },
      { t: 2, s0: 20, s1: 5 },
      { t: 3, s0: null, s1: 6 },
    ]);
    expect(mergeSeriesRows([])).toEqual([]);
  });

  it('draws sparkline points from zero to the max', () => {
    expect(sparklinePoints([0, 50, 100], 80, 24)).toBe('0,24 40,12 80,0');
    expect(sparklinePoints([0, 50, 100], 80, 24, 200)).toBe('0,24 40,18 80,12');
    expect(sparklinePoints([5], 80, 24)).toBe('0,0 80,0');
    expect(sparklinePoints([0, 0], 80, 24)).toBe('0,24 80,24');
    expect(sparklinePoints([], 80, 24)).toBe('');
  });
});
```

`tests/unit/monitoring-refresh-timer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_REFRESH_MS, createRefreshTimer } from '@/lib/monitoring/shared/refresh-timer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('refresh timer', () => {
  it('ticks every 120 seconds while visible and not paused', () => {
    expect(AUTO_REFRESH_MS).toBe(120_000);
    const onTick = vi.fn();
    createRefreshTimer({ onTick, visible: true, paused: false });
    vi.advanceTimersByTime(119_999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('stops while the tab is hidden and restarts a full interval when visible again', () => {
    const onTick = vi.fn();
    const timer = createRefreshTimer({ onTick, visible: true, paused: false });
    vi.advanceTimersByTime(60_000);
    timer.setVisible(false);
    vi.advanceTimersByTime(300_000);
    expect(onTick).not.toHaveBeenCalled();
    timer.setVisible(true);
    vi.advanceTimersByTime(119_999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('pauses, resumes and stops for good when disposed', () => {
    const onTick = vi.fn();
    const timer = createRefreshTimer({ onTick, visible: true, paused: true });
    vi.advanceTimersByTime(240_000);
    expect(onTick).not.toHaveBeenCalled();
    timer.setPaused(false);
    vi.advanceTimersByTime(120_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    timer.dispose();
    timer.setPaused(false);
    vi.advanceTimersByTime(600_000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });
});
```

`tests/unit/nav-items.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isNavActive, navHref } from '@/components/nav-items';

const item = (key: string) => NAV_ITEMS.find((i) => i.key === key)!;

describe('navigation items', () => {
  it('lists the monitoring sections first, all enabled', () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'containers', 'databases', 'loadBalancers', 'alarms', 'logs', 'gettingStarted', 'accounts']);
  });

  it('keeps the selected connection and region in monitoring links', () => {
    expect(navHref(item('containers'), '/c/abc123def456/eu-west-1/alarms')).toBe('/c/abc123def456/eu-west-1/containers');
    expect(navHref(item('loadBalancers'), '/accounts')).toBe('/load-balancers');
    expect(navHref(item('accounts'), '/c/abc123def456/eu-west-1/alarms')).toBe('/accounts');
  });

  it('marks the current section active', () => {
    expect(isNavActive(item('containers'), '/c/abc123def456/eu-west-1/containers/prod/web')).toBe(true);
    expect(isNavActive(item('overview'), '/c/abc123def456/eu-west-1/containers')).toBe(false);
    expect(isNavActive(item('accounts'), '/accounts/abc123def456')).toBe(true);
    expect(isNavActive(item('alarms'), '/alarms')).toBe(true);
  });
});
```

`tests/unit/monitoring-redirect.test.ts` (mock style of `tests/unit/connection-actions.test.ts`: `RedirectSignal`, `NotFoundSignal`, `vi.mock('@/lib/auth/route')` returning `{ locale: 'en', adminId: 1 }`, `vi.mock('@/lib/db/client')` with `getDb: () => state.db`, `vi.mock('@/i18n/navigation')` redirect throwing, `vi.mock('next/navigation')` notFound throwing; then `const { default: MonitoringRedirect } = await import('@/app/[locale]/(app)/[section]/page');`):
  1. `section: 'nope'` → rejects `NotFoundSignal`.
  2. no usable connection (only a `createReadyRoleConnection`, status pending) → rejects with `target` `{ href: '/accounts', locale: 'en' }`.
  3. a usable connection (`saveTestResult` overall `ok`, regions `['eu-west-3', 'eu-west-1']`), `section: 'alarms'` → `target` `{ href: '/c/<id>/eu-west-3/alarms', locale: 'en' }`.
  4. signed out (the auth mock throws `RedirectSignal({ href: '/login', locale: 'en' })`) → rejects with that target before the section is validated (use `section: 'nope'` to prove order).

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/unit/monitoring-format.test.ts tests/unit/monitoring-refresh-timer.test.ts tests/unit/nav-items.test.ts tests/unit/monitoring-redirect.test.ts`
Expected: FAIL — modules missing, `navHref` not exported.

- [ ] **Step 4: Implement the shared helpers**

`src/lib/monitoring/shared/format.ts`:

```ts
import type { TimeRange } from './time-range';

export type MetricUnit = 'percent' | 'count' | 'rate' | 'bytes' | 'seconds' | 'milliseconds';
export const NO_VALUE = '—';

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

function unit(locale: string, name: string, value: number, digits: number): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit: name, maximumFractionDigits: digits }).format(value);
}

/** AWS units: CPU in percent (0–100), FreeableMemory in bytes (shown 1024-based), latencies in seconds, replica lag in ms. */
export function formatMetricValue(value: number | null | undefined, metricUnit: MetricUnit, locale: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  switch (metricUnit) {
    case 'percent':
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
    case 'count':
      return Math.abs(value) >= 10_000
        ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
        : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
    case 'rate':
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
    case 'bytes': {
      let index = 0;
      let scaled = value;
      while (Math.abs(scaled) >= 1024 && index < BYTE_UNITS.length - 1) {
        scaled /= 1024;
        index += 1;
      }
      return unit(locale, BYTE_UNITS[index], scaled, 1);
    }
    case 'seconds':
      return Math.abs(value) < 1 ? unit(locale, 'millisecond', value * 1000, 0) : unit(locale, 'second', value, 2);
    case 'milliseconds':
      return Math.abs(value) >= 1000 ? unit(locale, 'second', value / 1000, 2) : unit(locale, 'millisecond', value, 0);
  }
}

export function formatAxisTime(timestamp: number, range: TimeRange, locale: string, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions =
    range === '7d' ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, { ...options, ...(timeZone ? { timeZone } : {}) }).format(timestamp);
}
```

`src/lib/monitoring/shared/chart-data.ts`:

```ts
export type ChartRow = { t: number; [key: `s${number}`]: number | null };

/** One row per timestamp; series are keyed s0, s1… so resource names never collide with `t`. */
export function mergeSeriesRows(series: readonly { timestamps: number[]; values: number[] }[]): ChartRow[] {
  const rows = new Map<number, ChartRow>();
  series.forEach((s, index) => {
    s.timestamps.forEach((t, i) => {
      let row = rows.get(t);
      if (!row) {
        row = { t };
        series.forEach((_, j) => (row![`s${j}`] = null));
        rows.set(t, row);
      }
      row[`s${index}`] = s.values[i];
    });
  });
  return [...rows.values()].sort((a, b) => a.t - b.t);
}
```

`src/lib/monitoring/shared/sparkline.ts`:

```ts
export const SPARKLINE_WIDTH = 80;
export const SPARKLINE_HEIGHT = 24;

const round = (n: number) => Math.round(n * 100) / 100;

export function sparklinePoints(values: readonly number[], width = SPARKLINE_WIDTH, height = SPARKLINE_HEIGHT, max?: number): string {
  if (values.length === 0) return '';
  const bottom = Math.min(0, ...values);
  const top = max ?? Math.max(...values);
  const span = top - bottom || 1;
  const y = (v: number) => round(height - ((v - bottom) / span) * height);
  if (values.length === 1) return `0,${y(values[0])} ${width},${y(values[0])}`;
  const step = width / (values.length - 1);
  return values.map((v, i) => `${round(i * step)},${y(v)}`).join(' ');
}
```

`src/lib/monitoring/shared/refresh-timer.ts`:

```ts
export const AUTO_REFRESH_MS = 120_000;

export type RefreshTimer = { setPaused(paused: boolean): void; setVisible(visible: boolean): void; dispose(): void };

/** Runs `onTick` every interval only while visible, not paused and not disposed. Pure: no DOM access. */
export function createRefreshTimer(options: { onTick: () => void; visible: boolean; paused: boolean; intervalMs?: number }): RefreshTimer {
  const intervalMs = options.intervalMs ?? AUTO_REFRESH_MS;
  let visible = options.visible;
  let paused = options.paused;
  let disposed = false;
  let handle: ReturnType<typeof setInterval> | undefined;

  const sync = () => {
    const shouldRun = visible && !paused && !disposed;
    if (shouldRun && handle === undefined) handle = setInterval(options.onTick, intervalMs);
    if (!shouldRun && handle !== undefined) {
      clearInterval(handle);
      handle = undefined;
    }
  };
  sync();
  return {
    setPaused(value) {
      paused = value;
      sync();
    },
    setVisible(value) {
      visible = value;
      sync();
    },
    dispose() {
      disposed = true;
      sync();
    },
  };
}
```

`src/components/nav-items.ts`:

```ts
import { BellRing, BookOpen, Boxes, Cloud, Database, LayoutDashboard, Network, ScrollText, type LucideIcon } from 'lucide-react';
import { monitoringPath, parseMonitoringPath, type MonitoringSection } from '@/lib/monitoring/shared/paths';

export type NavKey = 'overview' | 'containers' | 'databases' | 'loadBalancers' | 'alarms' | 'logs' | 'gettingStarted' | 'accounts';
export type NavItem = { key: NavKey; icon: LucideIcon } & ({ kind: 'monitoring'; section: MonitoringSection } | { kind: 'static'; href: string });

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', kind: 'monitoring', section: 'overview', icon: LayoutDashboard },
  { key: 'containers', kind: 'monitoring', section: 'containers', icon: Boxes },
  { key: 'databases', kind: 'monitoring', section: 'databases', icon: Database },
  { key: 'loadBalancers', kind: 'monitoring', section: 'load-balancers', icon: Network },
  { key: 'alarms', kind: 'monitoring', section: 'alarms', icon: BellRing },
  { key: 'logs', kind: 'monitoring', section: 'logs', icon: ScrollText },
  { key: 'gettingStarted', kind: 'static', href: '/getting-started', icon: BookOpen },
  { key: 'accounts', kind: 'static', href: '/accounts', icon: Cloud },
];

export function navHref(item: NavItem, pathname: string): string {
  if (item.kind === 'static') return item.href;
  const current = parseMonitoringPath(pathname);
  return current ? monitoringPath(current, item.section) : `/${item.section}`;
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.kind === 'static') return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return parseMonitoringPath(pathname)?.section === item.section || pathname === `/${item.section}`;
}
```

`src/components/sidebar.tsx` — `NavList` maps `NAV_ITEMS` to `<Link href={navHref(item, pathname)} className={classes} aria-current={active ? 'page' : undefined} onClick={onNavigate}>` for every item; delete the disabled branch and the `comingSoon` badge; `active = isNavActive(item, pathname)`; classes always include `hover:bg-accent hover:text-accent-foreground`. Keep one flat list (no separator).

- [ ] **Step 5: Implement the shell changes**

`src/app/[locale]/(app)/layout.tsx`: map `({ id, name, regions, status }) => ({ id, name, regions, status })`.

`src/components/connection-switcher.tsx`:
- `export type ShellConnection = Pick<ConnectionRow, 'id' | 'name' | 'regions' | 'status'>;`
- `const pathname = usePathname();` (from `@/i18n/navigation`), `const selection = parseMonitoringPath(pathname);`, `current = connections.find((c) => c.id === (selection?.connectionId ?? params.id)) ?? connections[0]`.
- Trigger: the region shown is `selection?.region ?? current.regions[0]`.
- Each item: when `isUsableStatus(c.status)`, `href = switchConnectionPath(pathname, { connectionId: c.id, region: c.regions[0] })` and the secondary line stays `{t('region')}: {c.regions.join(', ')}`; otherwise `href = /accounts/${c.id}` and the secondary line is `t('notMonitorable')`. The "Manage accounts" item is unchanged.

`src/app/[locale]/(app)/accounts/[id]/page.tsx`: give the permission test `Card` `id="permissions"` and `className="scroll-mt-20"` (target of every denied notice).

`src/app/globals.css`: in `:root` add `--series-1: oklch(0.55 0.16 255); --series-2: oklch(0.66 0.17 50); --series-3: oklch(0.6 0.13 165); --series-4: oklch(0.58 0.2 25);` and in `.dark` add `--series-1: oklch(0.72 0.13 255); --series-2: oklch(0.78 0.14 60); --series-3: oklch(0.75 0.12 165); --series-4: oklch(0.72 0.16 25);`.

`src/i18n/client-messages.ts`: add `'Monitoring.client'` to `CLIENT_NAMESPACES`.

`src/app/[locale]/(app)/[section]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { firstUsableSelection } from '@/lib/monitoring/selection';
import { MONITORING_SECTIONS, monitoringPath } from '@/lib/monitoring/shared/paths';
import { isOneOf } from '@/lib/type-guards';

type Props = { params: Promise<{ locale: string; section: string }> };

/** /<locale>/<section> without a selection: the first usable connection and its first region, or Accounts. */
export default async function MonitoringRedirect({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const { section } = await params;
  if (!isOneOf(MONITORING_SECTIONS, section)) notFound();
  const selection = firstUsableSelection(listConnections(getDb()));
  return redirect({ href: selection ? monitoringPath(selection, section) : '/accounts', locale });
}
```

- [ ] **Step 6: Implement the monitoring components**

Describe-level specifications (write full JSX; every string from messages):

- `monitoring-card.tsx`: `<Card className={className}>` → `<CardHeader className="flex-row flex-wrap items-start justify-between gap-3">` with `<div><CardTitle><h2>{title}</h2></CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>{actions}` → `<CardContent>{children}</CardContent>`.
- `card-skeleton.tsx` (async, `getTranslations('Common')`): `<Card role="status">` with a real `<h2>` title, `<span className="sr-only">{t('loading')}</span>`, and `aria-hidden` pulse blocks (`animate-pulse rounded-md bg-muted`): `table` → `rows` bars `h-4 w-full`; `chart` → one `h-48 w-full` block; `stat` → one `h-8 w-24` block plus one `h-4 w-40` bar.
- `suspense-card.tsx`: `<Suspense fallback={<CardSkeleton title={title} variant={variant} rows={rows} />}>{children}</Suspense>`.
- `failure-notice.tsx` (async, `getTranslations('Monitoring.common.failure')`): `<div role="status" className={cn('rounded-md border p-3 text-sm', TONE_BORDER.warning)}>`; `denied` → `t('denied', { action: failure.action })` then a `Link` to `permissionsPath(connectionId)` labelled `t('openChecklist')`; `throttled` → `t('throttled')`; `error` → `t('error', { code: failure.code })`.
- `monitoring-header.tsx` (async server): `PageHeader` with `title`, `description`, and `actions` = `<div className="flex flex-wrap items-center gap-2"><RegionSelector regions={context.connection.regions} current={context.scope.region} range={range} />{range && <TimeRangeSelector current={range} />}{autoRefresh && <AutoRefresh />}</div>`.
- `region-selector.tsx` (`'use client'`, `useTranslations('Monitoring.client')`, `usePathname` from `@/i18n/navigation`): a `DropdownMenu` whose trigger `Button variant="outline" size="sm"` shows a `MapPin` icon and `t('region.current', { region: current })`, `aria-label={t('region.label')}`; items are `Link`s to `withRegion(pathname, r) + (range ? `?range=${range}` : '')`, the current one with `aria-current="true"` and a check mark.
- `time-range-selector.tsx` (`'use client'`, `useSearchParams` from `next/navigation`, `usePathname` from `@/i18n/navigation`): `<nav aria-label={t('range.label')}>` with an inline `<ul className="flex rounded-md border">` of `Link`s; each link's query is a copy of the current search params with `range` set; current link `aria-current="page"` and `bg-accent font-medium`; text `t(`range.options.${r}`)`.
- `auto-refresh.tsx` (`'use client'`, `useRouter` from `@/i18n/navigation`): state `paused`; a `useEffect` creates `createRefreshTimer({ onTick: () => router.refresh(), visible: document.visibilityState === 'visible', paused: false })`, listens to `visibilitychange` (calls `setVisible`), disposes on unmount; a second effect calls `timer.setPaused(paused)`. Renders `<Button variant="outline" size="sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>` with `Pause`/`Play` icon and `paused ? t('refresh.resume') : t('refresh.pause')`, then `<span className="text-xs text-muted-foreground" aria-live="polite">{paused ? t('refresh.paused') : t('refresh.every', { minutes: AUTO_REFRESH_MS / 60_000 })}</span>`.
- `metric-chart.tsx` (`'use client'`, `useTranslations('Monitoring.client')`, `useLocale`):

```tsx
const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

export function MetricChart({ title, unit, range, series }: { title: string; unit: MetricUnit; range: TimeRange; series: ChartSeries[] }) {
  const t = useTranslations('Monitoring.client');
  const locale = useLocale();
  const captionId = useId();
  const rows = useMemo(() => mergeSeriesRows(series), [series]);
  return (
    <figure aria-labelledby={captionId} className="min-w-0 space-y-2">
      <figcaption id={captionId} className="text-sm font-medium">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t('chart.noData')}</p>
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => formatAxisTime(v, range, locale)} tick={{ fontSize: 11 }} minTickGap={32} />
              <YAxis width={64} tickFormatter={(v: number) => formatMetricValue(v, unit, locale)} tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={(v) => formatAxisTime(Number(v), range, locale)} formatter={(v) => formatMetricValue(Number(v), unit, locale)} />
              {series.map((s, i) => (
                <Line key={s.id} dataKey={`s${i}`} name={s.label} type="monotone" dot={false} strokeWidth={1.75} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {series.length > 1 && (
        <ul aria-label={t('chart.legend')} className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {series.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
```

- `sparkline.tsx` (no directive): empty `values` → `<span className="text-muted-foreground">{NO_VALUE}</span>`; else `<svg role="img" aria-label={label} width={SPARKLINE_WIDTH} height={SPARKLINE_HEIGHT} viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`} className="overflow-visible" style={{ color: 'var(--series-1)' }}><polyline points={sparklinePoints(values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT, max)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>`.

`src/app/[locale]/(app)/c/[connectionId]/[region]/overview/page.tsx` (Task 10 adds the cards):

```tsx
import { getTranslations } from 'next-intl/server';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';

type Props = { params: Promise<MonitoringParams> };

export const generateMetadata = localizedTitle('Monitoring.overview.title');

export default async function OverviewPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const t = await getTranslations('Monitoring.overview');
  return (
    <div className="space-y-6">
      <MonitoringHeader context={context} title={t('title')} description={t('description', { connection: context.connection.name, region: context.scope.region })} />
    </div>
  );
}
```

- [ ] **Step 7: Messages**

Remove `Common.nav.comingSoon` from both files. Add (en | fr):

| Key | en | fr |
|---|---|---|
| `Common.nav.overview` | Overview | Vue d'ensemble |
| `Common.nav.loadBalancers` | Load balancers | Répartiteurs de charge |
| `Common.nav.alarms` | Alarms | Alarmes |
| `Shell.notMonitorable` | Pass the permission test to monitor this account | Réussissez le test des permissions pour surveiller ce compte |
| `Monitoring.client.region.label` | Region | Région |
| `Monitoring.client.region.current` | Region: {region} | Région : {region} |
| `Monitoring.client.range.label` | Time range | Période |
| `Monitoring.client.range.options.1h` | 1 h | 1 h |
| `Monitoring.client.range.options.3h` | 3 h | 3 h |
| `Monitoring.client.range.options.12h` | 12 h | 12 h |
| `Monitoring.client.range.options.24h` | 24 h | 24 h |
| `Monitoring.client.range.options.7d` | 7 d | 7 j |
| `Monitoring.client.refresh.pause` | Pause auto-refresh | Suspendre l'actualisation automatique |
| `Monitoring.client.refresh.resume` | Resume auto-refresh | Reprendre l'actualisation automatique |
| `Monitoring.client.refresh.every` | Refreshes every {minutes} min | Actualisé toutes les {minutes} min |
| `Monitoring.client.refresh.paused` | Auto-refresh paused | Actualisation automatique suspendue |
| `Monitoring.client.chart.noData` | No data for this period | Aucune donnée sur cette période |
| `Monitoring.client.chart.legend` | Series | Séries |
| `Monitoring.common.failure.denied` | OpsWatch cannot read this (missing {action}). | OpsWatch ne peut pas lire ces données (permission {action} manquante). |
| `Monitoring.common.failure.openChecklist` | Open the permission test | Ouvrir le test des permissions |
| `Monitoring.common.failure.throttled` | AWS is limiting requests right now. The data loads again on the next refresh. | AWS limite les requêtes en ce moment. Les données se rechargeront à la prochaine actualisation. |
| `Monitoring.common.failure.error` | AWS returned an error ({code}). | AWS a renvoyé une erreur ({code}). |
| `Monitoring.common.sparkline` | {metric} over the selected period, latest {value} | {metric} sur la période choisie, dernière valeur {value} |
| `Monitoring.overview.title` | Overview | Vue d'ensemble |
| `Monitoring.overview.description` | Health summary and automatic insights for {connection} in {region}. | Synthèse de santé et analyses automatiques pour {connection} dans {region}. |

- [ ] **Step 8: Run the unit tests**

Run: `npx vitest run tests/unit/monitoring-format.test.ts tests/unit/monitoring-refresh-timer.test.ts tests/unit/nav-items.test.ts tests/unit/monitoring-redirect.test.ts tests/unit/client-messages.test.ts tests/unit/i18n-messages.test.ts tests/unit/module-boundaries.test.ts`
Expected: all pass (client-messages proves `Monitoring.client` is picked; module-boundaries proves recharts is the only new package in client code).

- [ ] **Step 9: Write the e2e navigation tests**

`tests/e2e/helpers.ts`: move `createConnection(page, method, name)` from `03-connections.spec.ts` into helpers (export it, add an optional `region = MOTO_REGION` parameter used for the region checkbox) and import it in `03-connections.spec.ts`. Add:

```ts
export const MONITORING_CONNECTION = 'Moto monitoring';

/** The ambient connection the monitoring specs use, created and tested once per stack. */
export async function ensureMonitoringConnection(page: Page): Promise<string> {
  await page.goto('/en/accounts');
  const existing = page.getByRole('link', { name: new RegExp(MONITORING_CONNECTION) });
  if ((await existing.count()) > 0) {
    return ((await existing.first().getAttribute('href')) ?? '').split('/').pop() as string;
  }
  const id = await createConnection(page, 'ambient', MONITORING_CONNECTION);
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  return id;
}

export const monitoringUrl = (connectionId: string, section: string, suffix = '') => `/en/c/${connectionId}/${MOTO_REGION}/${section}${suffix}`;
```

Create `tests/e2e/06-monitoring.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { MONITORING_CONNECTION, ensureMonitoringConnection, login, monitoringUrl, rscHeaders } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('a monitoring section without a selection opens the first usable connection', async ({ page }) => {
  await page.goto('/en/overview');
  await expect(page).toHaveURL(/\/en\/c\/[0-9a-f]{12}\/us-east-1\/overview$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page).toHaveTitle('Overview · OpsWatch');
});

test('sidebar links keep the connection and region, and auto-refresh can be paused', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview'));
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Containers' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/containers`);
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Refreshes every 2 min')).toBeVisible();
  await page.getByRole('button', { name: 'Pause auto-refresh' }).click();
  await expect(page.getByRole('button', { name: 'Resume auto-refresh' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Auto-refresh paused')).toBeVisible();
});

test('a region the connection does not use is not found', async ({ page }) => {
  const response = await page.goto(`/en/c/${connectionId}/eu-west-3/overview`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

test('an RSC request without a session leaks nothing from a monitoring page', async ({ page, playwright, baseURL }) => {
  const path = monitoringUrl(connectionId, 'overview');
  const headers = rscHeaders(['(app)', 'accounts']);
  expect(await (await page.request.get(path, { headers })).text()).toContain(MONITORING_CONNECTION);
  const anonymous = await playwright.request.newContext({ baseURL });
  expect(await (await anonymous.get(path, { headers })).text()).not.toContain(MONITORING_CONNECTION);
  await anonymous.dispose();
});
```

The control assertion (signed-in RSC body contains the connection name) works because the page header description interpolates the connection name.

- [ ] **Step 10: Run the full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: clean; the build lists `/[locale]/c/[connectionId]/[region]/overview` and `/[locale]/[section]`.
Run: `docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e; docker compose -f docker-compose.test.yml down -v`
Expected: all previous tests plus 4 new ones pass (`36 passed`).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json src messages tests
git commit -m "feat(monitoring): navigation, selection URLs, region and time range selectors, auto-refresh and chart components

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 5: Alarms

**Files:**
- Create: `src/lib/monitoring/alarms.ts`, `src/app/[locale]/(app)/c/[connectionId]/[region]/alarms/page.tsx`, `src/app/[locale]/(app)/c/[connectionId]/[region]/alarms/cards.tsx`
- Modify: `messages/en.json`, `messages/fr.json`, `tests/unit/module-boundaries.test.ts`, `tests/e2e/06-monitoring.spec.ts`
- Test: `tests/unit/monitoring-alarms.test.ts`

**Interfaces:**
- Consumes: Task 2 `describeCall`, `describeTimeout`, `AwsTarget`, `MonitoringDeps`, `MonitoringResult`; Task 3 `initMonitoringRoute`, `MonitoringParams`, `resolveTarget`, `MonitoringScope`, `monitoringPath`; Task 4 `MonitoringHeader`, `MonitoringCard`, `SuspenseCard`, `FailureNotice`; `clientConfig`, `sendWithTimeout`; `Table*` (`src/components/ui/table.tsx`); `Badge`; `TONE_SOFT`; `getFormatter` (next-intl, `relativeTime`); `localizedTitle`; e2e `ensureMonitoringConnection`, `monitoringUrl`; seed `SEED.alarm`, `SEED.targetTrackingAlarm`, `SEED.okAlarm` (values inlined in the spec as strings).
- Produces (`alarms.ts`):
  - `type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA'`
  - `type AlarmSummary = { name: string; type: 'metric' | 'composite'; state: AlarmState; stateReason: string; stateUpdatedAt: number | null; namespace: string | null; metricName: string | null; dimensions: Record<string, string>; threshold: number | null; comparison: string | null; targetTracking: boolean }`
  - `TARGET_TRACKING_PREFIX = 'TargetTracking-'`; `isTargetTrackingAlarm(name: string): boolean`
  - `listAlarms(target: AwsTarget, deps?: MonitoringDeps): Promise<MonitoringResult<AlarmSummary[]>>`
  - `ALARM_STATE_FILTERS = ['all', 'ALARM', 'OK', 'INSUFFICIENT_DATA'] as const`; `type AlarmFilter = { state: (typeof ALARM_STATE_FILTERS)[number]; showTargetTracking: boolean; search: string }`
  - `parseAlarmFilter(params: { state?: string | string[]; tt?: string | string[]; q?: string | string[] }): AlarmFilter`
  - `filterAlarms(alarms: readonly AlarmSummary[], filter: AlarmFilter): AlarmSummary[]`
  - `COMPARISON_SYMBOLS: Record<string, string>` (`GreaterThanThreshold` `>`, `GreaterThanOrEqualToThreshold` `≥`, `LessThanThreshold` `<`, `LessThanOrEqualToThreshold` `≤`)

moto: `DescribeAlarms` ignores `MaxRecords` and never pages (fact 9) — pagination is unit-tested only; moto enforces no IAM (fact 11) — the denied state is unit-tested only.

- [ ] **Step 1: Write the failing test**

`tests/unit/monitoring-alarms.test.ts`:

```ts
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterAlarms, listAlarms, parseAlarmFilter } from '@/lib/monitoring/alarms';
import { createTtlCache } from '@/lib/monitoring/cache';

const cw = mockClient(CloudWatchClient);
const target = { connectionId: 'abc123def456', region: 'eu-west-1', credentials: { accessKeyId: 'ASIA', secretAccessKey: 's' } };
const updated = new Date('2026-09-17T09:00:00Z');
let deps: { cache: ReturnType<typeof createTtlCache>; log: ReturnType<typeof vi.fn> };

beforeEach(() => {
  cw.reset();
  deps = { cache: createTtlCache(), log: vi.fn() };
});

function twoPages() {
  cw.on(DescribeAlarmsCommand)
    .resolvesOnce({
      MetricAlarms: [
        {
          AlarmName: 'api-5xx',
          StateValue: 'OK',
          StateReason: 'Threshold not crossed',
          StateUpdatedTimestamp: updated,
          Namespace: 'AWS/ApplicationELB',
          MetricName: 'HTTPCode_ELB_5XX_Count',
          Dimensions: [{ Name: 'LoadBalancer', Value: 'app/api/1' }],
          Threshold: 10,
          ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        },
      ],
      NextToken: 'page-2',
    })
    .resolvesOnce({
      CompositeAlarms: [{ AlarmName: 'site-down', StateValue: 'ALARM', StateReason: 'Children in alarm' }],
      MetricAlarms: [{ AlarmName: 'TargetTracking-service/prod/web-AlarmLow-1', StateValue: 'ALARM', StateReason: 'low' }],
    });
}

describe('listAlarms', () => {
  it('pages through metric and composite alarms, alarms first', async () => {
    twoPages();
    const result = await listAlarms(target, deps);
    expect(cw.commandCalls(DescribeAlarmsCommand).map((c) => c.args[0].input)).toEqual([
      { AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], MaxRecords: 100 },
      { AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], MaxRecords: 100, NextToken: 'page-2' },
    ]);
    expect(result.ok && result.data.map((a) => [a.name, a.type, a.state, a.targetTracking])).toEqual([
      ['site-down', 'composite', 'ALARM', false],
      ['TargetTracking-service/prod/web-AlarmLow-1', 'metric', 'ALARM', true],
      ['api-5xx', 'metric', 'OK', false],
    ]);
    expect(result.ok && result.data[2]).toEqual({
      name: 'api-5xx',
      type: 'metric',
      state: 'OK',
      stateReason: 'Threshold not crossed',
      stateUpdatedAt: updated.getTime(),
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_ELB_5XX_Count',
      dimensions: { LoadBalancer: 'app/api/1' },
      threshold: 10,
      comparison: 'GreaterThanOrEqualToThreshold',
      targetTracking: false,
    });
  });

  it('caches the list for 60 seconds and reports a denied call', async () => {
    twoPages();
    await listAlarms(target, deps);
    await listAlarms(target, deps);
    expect(cw.commandCalls(DescribeAlarmsCommand)).toHaveLength(2);

    cw.reset();
    cw.on(DescribeAlarmsCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    expect(await listAlarms({ ...target, region: 'us-east-1' }, deps)).toEqual({ ok: false, reason: 'denied', code: 'AccessDenied', action: 'cloudwatch:DescribeAlarms' });
  });
});

describe('alarm filters', () => {
  it('parses the query string', () => {
    expect(parseAlarmFilter({ state: 'bogus', tt: 'yes', q: '  web ' })).toEqual({ state: 'all', showTargetTracking: false, search: 'web' });
    expect(parseAlarmFilter({ state: 'ALARM', tt: '1' })).toEqual({ state: 'ALARM', showTargetTracking: true, search: '' });
    expect(parseAlarmFilter({ q: 'x'.repeat(150) }).search).toHaveLength(100);
  });

  it('hides target-tracking alarms unless asked, and filters by state and name', async () => {
    twoPages();
    const result = await listAlarms(target, deps);
    const alarms = result.ok ? result.data : [];
    const names = (filter: Parameters<typeof filterAlarms>[1]) => filterAlarms(alarms, filter).map((a) => a.name);
    expect(names({ state: 'all', showTargetTracking: false, search: '' })).toEqual(['site-down', 'api-5xx']);
    expect(names({ state: 'all', showTargetTracking: true, search: '' })).toHaveLength(3);
    expect(names({ state: 'ALARM', showTargetTracking: false, search: '' })).toEqual(['site-down']);
    expect(names({ state: 'all', showTargetTracking: false, search: 'API' })).toEqual(['api-5xx']);
  });
});
```

Add `'lib/monitoring/alarms.ts'` to `SERVER_ONLY_MODULES`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/monitoring-alarms.test.ts`
Expected: FAIL — `@/lib/monitoring/alarms` not found.

- [ ] **Step 3: Implement `alarms.ts`**

```ts
import 'server-only';
import { CloudWatchClient, DescribeAlarmsCommand, type CompositeAlarm, type MetricAlarm } from '@aws-sdk/client-cloudwatch';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { isOneOf } from '../type-guards';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MonitoringResult } from './result';

export type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
export type AlarmSummary = {
  name: string;
  type: 'metric' | 'composite';
  state: AlarmState;
  stateReason: string;
  stateUpdatedAt: number | null;
  namespace: string | null;
  metricName: string | null;
  dimensions: Record<string, string>;
  threshold: number | null;
  comparison: string | null;
  targetTracking: boolean;
};

export const TARGET_TRACKING_PREFIX = 'TargetTracking-';
export const isTargetTrackingAlarm = (name: string) => name.startsWith(TARGET_TRACKING_PREFIX);

const STATES = ['OK', 'ALARM', 'INSUFFICIENT_DATA'] as const;
const STATE_ORDER: Record<AlarmState, number> = { ALARM: 0, INSUFFICIENT_DATA: 1, OK: 2 };
const MAX_PAGES = 50;
const SEARCH_MAX = 100;

const state = (value: string | undefined): AlarmState => (isOneOf(STATES, value) ? value : 'INSUFFICIENT_DATA');

function fromMetric(a: MetricAlarm): AlarmSummary {
  const name = a.AlarmName ?? '';
  return {
    name,
    type: 'metric',
    state: state(a.StateValue),
    stateReason: a.StateReason ?? '',
    stateUpdatedAt: a.StateUpdatedTimestamp?.getTime() ?? null,
    namespace: a.Namespace ?? null,
    metricName: a.MetricName ?? null,
    dimensions: Object.fromEntries((a.Dimensions ?? []).map((d) => [d.Name ?? '', d.Value ?? ''])),
    threshold: a.Threshold ?? null,
    comparison: a.ComparisonOperator ?? null,
    targetTracking: isTargetTrackingAlarm(name),
  };
}

function fromComposite(a: CompositeAlarm): AlarmSummary {
  const name = a.AlarmName ?? '';
  return {
    name,
    type: 'composite',
    state: state(a.StateValue),
    stateReason: a.StateReason ?? '',
    stateUpdatedAt: a.StateUpdatedTimestamp?.getTime() ?? null,
    namespace: null,
    metricName: null,
    dimensions: {},
    threshold: null,
    comparison: null,
    targetTracking: isTargetTrackingAlarm(name),
  };
}

export function listAlarms(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<AlarmSummary[]>> {
  return describeCall(target, 'cloudwatch:DescribeAlarms', {}, async () => {
    const client = new CloudWatchClient(clientConfig(target.region, target.credentials));
    const alarms: AlarmSummary[] = [];
    let NextToken: string | undefined;
    let pages = 0;
    do {
      const out = await sendWithTimeout(
        client,
        new DescribeAlarmsCommand({ AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], MaxRecords: 100, ...(NextToken ? { NextToken } : {}) }),
        describeTimeout(deps),
      );
      alarms.push(...(out.MetricAlarms ?? []).map(fromMetric), ...(out.CompositeAlarms ?? []).map(fromComposite));
      NextToken = out.NextToken;
      pages += 1;
    } while (NextToken && pages < MAX_PAGES);
    return alarms.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name, 'en'));
  }, deps);
}
```

Then `ALARM_STATE_FILTERS`, `AlarmFilter`, `parseAlarmFilter` (first array element; `state` via `isOneOf(ALARM_STATE_FILTERS, …)` else `'all'`; `showTargetTracking = tt === '1'`; `search = (q ?? '').trim().slice(0, 100)`), `filterAlarms` (drop `targetTracking` unless `showTargetTracking`; keep `state === filter.state` unless `'all'`; keep names whose lower case includes the lower-case search) and `COMPARISON_SYMBOLS`.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/monitoring-alarms.test.ts tests/unit/module-boundaries.test.ts`
Expected: pass.

- [ ] **Step 5: Page and card**

`alarms/page.tsx`:
- `export const generateMetadata = localizedTitle('Monitoring.alarms.title');`
- `Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ state?: string | string[]; tt?: string | string[]; q?: string | string[] }> }`
- Body: `const context = await initMonitoringRoute(params);` first; `const filter = parseAlarmFilter(await searchParams);`; `MonitoringHeader` without `range` (alarms are current state), description `t('description', { connection, region })`; then a filter form; then `<SuspenseCard key={JSON.stringify(filter)} title={t('cardTitle')} variant="table" rows={6}><AlarmsCard scope={context.scope} filter={filter} /></SuspenseCard>`.
- Filter form (server, plain GET, no JavaScript): `<form className="flex flex-wrap items-end gap-3">` with a `<label>`led native `<select name="state">` (options `ALARM_STATE_FILTERS` labelled `t('filters.states.<value>')`, `defaultValue={filter.state}`, styled `h-9 rounded-md border bg-background px-2 text-sm`), a native `<input type="checkbox" name="tt" value="1" defaultChecked={filter.showTargetTracking}>` (a native input, not the Radix `Checkbox`, so the GET form submits it) with its label `t('filters.showTargetTracking')`, `Input name="q"` labelled `t('filters.search')` (`maxLength={100}`), and a submit `Button` `t('filters.apply')`.

`alarms/cards.tsx` — `export async function AlarmsCard({ scope, filter }: { scope: MonitoringScope; filter: AlarmFilter })`:
1. `const target = await resolveTarget(scope);` failure → `<MonitoringCard title={t('cardTitle')}><FailureNotice failure={target} connectionId={scope.connectionId} /></MonitoringCard>`.
2. `const alarms = await listAlarms(target.data);` same failure handling.
3. `rows = filterAlarms(alarms.data, filter)`; `hidden = filter.showTargetTracking ? 0 : alarms.data.filter((a) => a.targetTracking && (filter.state === 'all' || a.state === filter.state)).length`.
4. Empty rows → `<p className="text-sm text-muted-foreground">{t('empty')}</p>`; otherwise a `Table` with header cells `t('columns.state')`, `name`, `metric`, `threshold`, `updated`, `reason`; each row: state `Badge` (`ALARM` → `TONE_SOFT.danger`, `INSUFFICIENT_DATA` → `bg-muted text-muted-foreground`, `OK` → `TONE_SOFT.success`) labelled `t('filters.states.<state>')`; name in `font-mono text-xs break-all`; metric cell `namespace · metricName`, or `t('composite')` for composite alarms, or `t('metricMath')` for metric alarms without a metric name; threshold `COMPARISON_SYMBOLS[comparison] ?? comparison` followed by the threshold, `—` when null; updated `format.relativeTime(stateUpdatedAt)` or `—`; reason truncated to one line with `title={stateReason}`.
5. When `hidden > 0`: a footer `<p>` with `t('hiddenTargetTracking', { count: hidden })` and a `Link` `t('showHidden')` to the same page with `?tt=1&state=<state>&q=<search>` (built with `URLSearchParams`, omit empty `q`, path `monitoringPath(scope, 'alarms')`).

- [ ] **Step 6: Messages**

| Key | en | fr |
|---|---|---|
| `Monitoring.alarms.title` | Alarms | Alarmes |
| `Monitoring.alarms.description` | CloudWatch alarms of {connection} in {region}. | Alarmes CloudWatch de {connection} dans {region}. |
| `Monitoring.alarms.cardTitle` | CloudWatch alarms | Alarmes CloudWatch |
| `Monitoring.alarms.filters.state` | State | État |
| `Monitoring.alarms.filters.states.all` | All states | Tous les états |
| `Monitoring.alarms.filters.states.ALARM` | In alarm | En alarme |
| `Monitoring.alarms.filters.states.OK` | OK | OK |
| `Monitoring.alarms.filters.states.INSUFFICIENT_DATA` | Insufficient data | Données insuffisantes |
| `Monitoring.alarms.filters.showTargetTracking` | Show target-tracking alarms | Afficher les alarmes de suivi de cible |
| `Monitoring.alarms.filters.search` | Search by name | Rechercher par nom |
| `Monitoring.alarms.filters.apply` | Apply | Appliquer |
| `Monitoring.alarms.columns.state` | State | État |
| `Monitoring.alarms.columns.name` | Name | Nom |
| `Monitoring.alarms.columns.metric` | Metric | Métrique |
| `Monitoring.alarms.columns.threshold` | Threshold | Seuil |
| `Monitoring.alarms.columns.updated` | Changed | Modifiée |
| `Monitoring.alarms.columns.reason` | Reason | Raison |
| `Monitoring.alarms.composite` | Composite alarm | Alarme composite |
| `Monitoring.alarms.metricMath` | Metric math | Calcul de métriques |
| `Monitoring.alarms.empty` | No alarm matches these filters. | Aucune alarme ne correspond à ces filtres. |
| `Monitoring.alarms.hiddenTargetTracking` | {count, plural, one {# target-tracking alarm is hidden.} other {# target-tracking alarms are hidden.}} | {count, plural, one {# alarme de suivi de cible est masquée.} other {# alarmes de suivi de cible sont masquées.}} |
| `Monitoring.alarms.showHidden` | Show them | Les afficher |

- [ ] **Step 7: E2E tests**

Append to `tests/e2e/06-monitoring.spec.ts`:

```ts
test('the alarms page hides target-tracking alarms until asked', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'alarms'));
  await expect(page).toHaveTitle('Alarms · OpsWatch');
  const high = page.getByRole('row').filter({ hasText: 'opswatch-e2e-high-cpu' });
  await expect(high).toContainText('In alarm');
  await expect(page.getByRole('row').filter({ hasText: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e' })).toHaveCount(0);
  await expect(page.getByText('1 target-tracking alarm is hidden.')).toBeVisible();
  await page.getByRole('link', { name: 'Show them' }).click();
  await expect(page).toHaveURL(/tt=1/);
  await expect(page.getByRole('row').filter({ hasText: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e' })).toBeVisible();
});

test('the state filter keeps only alarms in alarm', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'alarms'));
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-db-connections' })).toContainText('OK');
  await page.getByLabel('State').selectOption('ALARM');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/state=ALARM/);
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-high-cpu' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-db-connections' })).toHaveCount(0);
});
```

`getByLabel('State')` must resolve to the select only: the table header cell "State" is not a label, so this is unambiguous.

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npm run lint`, then the e2e stack (`docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e; docker compose -f docker-compose.test.yml down -v`).
Expected: all pass (`38 passed` e2e). E2E gaps touched: alarm pagination, denied state.

- [ ] **Step 9: Commit**

```bash
git add src messages tests
git commit -m "feat(monitoring): alarms page with state, name and target-tracking filters

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Containers — ECS services list and service detail

**Files:**
- Create: `src/lib/monitoring/ecs.ts`, `src/lib/monitoring/elb.ts` (target group part), `src/components/monitoring/target-group-panel.tsx`
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/containers/page.tsx`, `containers/cards.tsx`, `containers/[cluster]/[service]/page.tsx`, `containers/[cluster]/[service]/cards.tsx`
- Modify: `messages/en.json`, `messages/fr.json`, `tests/unit/module-boundaries.test.ts`, `tests/e2e/06-monitoring.spec.ts`
- Test: `tests/unit/monitoring-ecs.test.ts`, `tests/unit/monitoring-elb.test.ts`

**Interfaces:**
- Consumes: Task 2 `describeCall`, `describeTimeout`, `chunk`, `AwsTarget`, `MonitoringDeps`, `MonitoringResult`, `getMetricSeries`, `seriesById`, `latestValue`, `MetricQuery`, `SeriesData`, `timeWindow`, `parseTimeRange`, `TimeRange`; Task 3 `initMonitoringRoute`, `MonitoringParams`, `resolveTarget`, `MonitoringScope`, `monitoringPath`, `isEcsName`; Task 4 `MonitoringHeader`, `MonitoringCard`, `SuspenseCard`, `FailureNotice`, `MetricChart`, `Sparkline`, `formatMetricValue`; `Table*`, `Badge`, `Input`, `Button`, `TONE_SOFT`, `getFormatter`, `getLocale`, `localizedTitle`, `notFound`.
- Produces (`ecs.ts`):
  - `type EcsCluster = { name: string; arn: string; status: string; containerInsights: boolean; activeServices: number; runningTasks: number; pendingTasks: number }`
  - `type EcsDeployment = { id: string; status: string; rolloutState: string | null; rolloutStateReason: string | null; taskDefinition: string; desiredCount: number; runningCount: number; pendingCount: number; failedTasks: number; createdAt: number | null; updatedAt: number | null }`
  - `type EcsServiceEvent = { id: string; createdAt: number | null; message: string }`
  - `type EcsService = { name: string; arn: string; cluster: string; status: string; desiredCount: number; runningCount: number; pendingCount: number; launchType: string | null; taskDefinitionArn: string; taskDefinition: string; deployments: EcsDeployment[]; primaryDeployment: EcsDeployment | null; events: EcsServiceEvent[]; loadBalancers: { targetGroupArn: string; containerName: string | null; containerPort: number | null }[] }`
  - `type EcsTask = { id: string; arn: string; taskDefinition: string; lastStatus: string; desiredStatus: string; healthStatus: string | null; startedAt: number | null; availabilityZone: string | null; launchType: string | null }`
  - `type AwslogsTarget = { container: string; logGroup: string; region: string | null; streamPrefix: string | null }`
  - `MAX_SERVICES = 100`, `DESCRIBE_SERVICES_BATCH = 10`, `MAX_EVENTS = 20`, `MAX_TASKS = 100`
  - `taskDefinitionLabel(arn: string): string` (`…:task-definition/web:42` → `web:42`)
  - `listClusters(target, deps?): Promise<MonitoringResult<EcsCluster[]>>`
  - `listServices(target, cluster: string, search: string, deps?): Promise<MonitoringResult<{ services: EcsService[]; matched: number; truncated: boolean }>>`
  - `describeService(target, cluster: string, service: string, deps?): Promise<MonitoringResult<EcsService | null>>`
  - `listServiceTasks(target, cluster: string, service: string, deps?): Promise<MonitoringResult<EcsTask[]>>`
  - `taskDefinitionLogs(target, taskDefinitionArn: string, deps?): Promise<MonitoringResult<AwslogsTarget[]>>`
  - `serviceUtilizationQueries(cluster: string, service: string, idPrefix: string): MetricQuery[]` (ids `${idPrefix}cpu`, `${idPrefix}mem`)
  - `serviceTaskCountQueries(cluster: string, service: string, idPrefix: string): MetricQuery[]` (ids `${idPrefix}running`, `${idPrefix}desired`)
- Produces (`elb.ts`, extended in Task 8):
  - `type TargetGroup = { name: string; arn: string; protocol: string | null; port: number | null; targetType: string | null; healthCheckPath: string | null; loadBalancerArns: string[] }`
  - `type TargetHealthEntry = { id: string; port: number | null; state: string; reason: string | null; description: string | null }`
  - `DESCRIBE_TARGET_GROUPS_BATCH = 20`
  - `loadBalancerDimension(arn: string): string`, `targetGroupDimension(arn: string): string`
  - `describeTargetGroups(target, arns: readonly string[], deps?): Promise<MonitoringResult<TargetGroup[]>>`
  - `targetHealth(target, targetGroupArn: string, deps?): Promise<MonitoringResult<TargetHealthEntry[]>>`
  - `targetGroupQueries(group: TargetGroup, idPrefix: string): MetricQuery[]` (ids `${p}req` RequestCount Sum, `${p}t5xx` HTTPCode_Target_5XX_Count Sum, `${p}healthy` HealthyHostCount Average, `${p}unhealthy` UnHealthyHostCount Maximum; dimensions `{ LoadBalancer, TargetGroup }`; `[]` when `loadBalancerArns` is empty)
  - `targetGroupLatencyQuery(group: TargetGroup, idPrefix: string): MetricQuery | null` (id `${p}p95`, TargetResponseTime `p95`)
- Produces (component): `TargetGroupPanel({ scope, group, range }: { scope: MonitoringScope; group: TargetGroup; range: TimeRange })` — async server component reused by Task 8.

moto limits relied on (facts 2, 4, 6): no running tasks (tasks card shows its empty state), no service events (events card empty state), deployment always IN_PROGRESS, p95 request fails (the p95 chart shows its unavailable notice). FAILED rollouts, events and tasks are covered by unit fixtures only.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/monitoring-ecs.test.ts` (mock `ECSClient`; `deps = { cache: createTtlCache(), log: vi.fn() }` fresh per test; `target` as in Task 5; `arn = (kind, name) => `arn:aws:ecs:eu-west-1:111122223333:${kind}/${name}``):

1. **listClusters paginates and reads Container Insights.** `ListClustersCommand` resolves `{ clusterArns: [arn('cluster','staging')], nextToken: 'n' }` then `{ clusterArns: [arn('cluster','prod')] }`; `DescribeClustersCommand` resolves `{ clusters: [{ clusterName: 'staging', clusterArn: …, status: 'ACTIVE', settings: [{ name: 'containerInsights', value: 'disabled' }], activeServicesCount: 2, runningTasksCount: 3, pendingTasksCount: 0 }, { clusterName: 'prod', …, settings: [{ name: 'containerInsights', value: 'enhanced' }], activeServicesCount: 12, runningTasksCount: 30, pendingTasksCount: 1 }] }`. Expect the Describe input `{ clusters: [stagingArn, prodArn], include: ['SETTINGS'] }` and data `[{ name: 'prod', …, containerInsights: true, activeServices: 12, runningTasks: 30, pendingTasks: 1 }, { name: 'staging', …, containerInsights: false, … }]` (sorted by name).
2. **listServices searches names before describing, in batches of 10.** `ListServicesCommand` resolves two pages with 15 + 10 ARNs `svc-00`…`svc-24` (second call input has `nextToken`, both `maxResults: 100`); `DescribeServicesCommand` `callsFake` returning one service per requested name (`{ serviceName, serviceArn, clusterArn, status: 'ACTIVE', desiredCount: 2, runningCount: 2, pendingCount: 0, taskDefinition: 'arn:aws:ecs:eu-west-1:111122223333:task-definition/web:7', deployments: [], events: [], loadBalancers: [] }`). With search `''`: DescribeServices called 3 times with 10, 10, 5 names in name order; data `matched: 25, truncated: false`, `services.map(s => s.name)` = sorted names, `taskDefinition: 'web:7'`. With search `'SVC-1'` (fresh cache): one DescribeServices call with `svc-10`…`svc-19`, `matched: 10`.
3. **listServices caps at 100 services.** 230 ARNs over three pages → DescribeServices calls total 100 names (10 calls), `matched: 230`, `truncated: true`.
4. **describeService maps deployments, events and load balancers.** One service with `deployments: [{ id: 'ecs-svc/2', status: 'PRIMARY', rolloutState: 'FAILED', rolloutStateReason: 'ECS deployment circuit breaker: tasks failed to start.', taskDefinition: '…/web:42', desiredCount: 2, runningCount: 0, pendingCount: 0, failedTasks: 4, createdAt: new Date('2026-09-17T09:00:00Z'), updatedAt: new Date('2026-09-17T09:20:00Z') }, { id: 'ecs-svc/1', status: 'ACTIVE', rolloutState: 'COMPLETED', taskDefinition: '…/web:41', desiredCount: 2, runningCount: 2, … }]`, 25 events newest first (`id: 'e24'`…`'e0'`), `loadBalancers: [{ targetGroupArn: 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/web/73e2d6bc24d8a067', containerName: 'web', containerPort: 8080 }]`. Expect `primaryDeployment` `{ id: 'ecs-svc/2', rolloutState: 'FAILED', rolloutStateReason: 'ECS deployment circuit breaker: tasks failed to start.', taskDefinition: 'web:42', failedTasks: 4, createdAt: Date.parse('2026-09-17T09:00:00Z'), … }`, `events` length 20 starting with `e24`, `loadBalancers` as given.
5. **describeService returns null for a missing service or cluster.** `{ services: [], failures: [{ arn: '…', reason: 'MISSING' }] }` → `{ ok: true, data: null }`; rejects `ClusterNotFoundException` → `{ ok: true, data: null }`; rejects `AccessDeniedException` → `{ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'ecs:DescribeServices' }`.
6. **listServiceTasks lists running tasks, newest first.** `ListTasksCommand` input must equal `{ cluster: 'prod', serviceName: 'web', desiredStatus: 'RUNNING', maxResults: 100 }`; resolves two ARNs; `DescribeTasksCommand` input `{ cluster: 'prod', tasks: [a1, a2] }` resolves tasks with `taskArn: 'arn:aws:ecs:eu-west-1:111122223333:task/prod/0f9a…'`, `taskDefinitionArn: '…/web:42'`, `lastStatus: 'RUNNING'`, `desiredStatus: 'RUNNING'`, `healthStatus: 'HEALTHY'`, `startedAt` 09:00 and 09:30, `availabilityZone: 'eu-west-1a'`, `launchType: 'FARGATE'`. Expect ids = last ARN segment, `taskDefinition: 'web:42'`, order 09:30 first. No task ARNs → no DescribeTasks call, `data: []`.
7. **taskDefinitionLogs keeps awslogs containers only.** `DescribeTaskDefinitionCommand` input `{ taskDefinition: '…/web:42' }`; containers `web` (awslogs, group `/ecs/web`, region `eu-west-1`, prefix `web`) and `log_router` (`logDriver: 'awsfirelens'`) → `[{ container: 'web', logGroup: '/ecs/web', region: 'eu-west-1', streamPrefix: 'web' }]`.
8. **query builders.** `serviceUtilizationQueries('prod', 'web', 's0')` equals `[{ id: 's0cpu', namespace: 'AWS/ECS', metricName: 'CPUUtilization', dimensions: { ClusterName: 'prod', ServiceName: 'web' }, stat: 'Average' }, { id: 's0mem', namespace: 'AWS/ECS', metricName: 'MemoryUtilization', dimensions: { ClusterName: 'prod', ServiceName: 'web' }, stat: 'Average' }]`; `serviceTaskCountQueries('prod', 'web', 's0')` equals the same shape with namespace `ECS/ContainerInsights`, metrics `RunningTaskCount` (`s0running`) and `DesiredTaskCount` (`s0desired`), stat `Average`. `taskDefinitionLabel('arn:aws:ecs:eu-west-1:111122223333:task-definition/web:42')` → `'web:42'`.

`tests/unit/monitoring-elb.test.ts` (mock `ElasticLoadBalancingV2Client`):

1. `loadBalancerDimension('arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/api/50dc6c495c0c9188')` → `'app/api/50dc6c495c0c9188'`; `targetGroupDimension('arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/web/73e2d6bc24d8a067')` → `'targetgroup/web/73e2d6bc24d8a067'`.
2. `describeTargetGroups` with 25 ARNs → two `DescribeTargetGroupsCommand` calls with `TargetGroupArns` of 20 and 5; maps `{ TargetGroupName: 'web', TargetGroupArn, Protocol: 'HTTP', Port: 80, TargetType: 'ip', HealthCheckPath: '/health', LoadBalancerArns: [lbArn] }` to `{ name: 'web', arn, protocol: 'HTTP', port: 80, targetType: 'ip', healthCheckPath: '/health', loadBalancerArns: [lbArn] }`; empty ARN list → no call, `data: []`; `TargetGroupNotFoundException` → `data: []`.
3. `targetHealth` input `{ TargetGroupArn }`; maps `{ Target: { Id: '10.0.1.10', Port: 80 }, TargetHealth: { State: 'unhealthy', Reason: 'Target.ResponseCodeMismatch', Description: 'Health checks failed with these codes: [502]' } }` to `{ id: '10.0.1.10', port: 80, state: 'unhealthy', reason: 'Target.ResponseCodeMismatch', description: 'Health checks failed with these codes: [502]' }`.
4. `targetGroupQueries(group, 'g0')` equals four queries with `dimensions: { LoadBalancer: 'app/api/50dc6c495c0c9188', TargetGroup: 'targetgroup/web/73e2d6bc24d8a067' }`: `g0req` RequestCount Sum, `g0t5xx` HTTPCode_Target_5XX_Count Sum, `g0healthy` HealthyHostCount Average, `g0unhealthy` UnHealthyHostCount Maximum, all namespace `AWS/ApplicationELB`; with `loadBalancerArns: []` → `[]`; `targetGroupLatencyQuery(group, 'g0')` → `{ id: 'g0p95', namespace: 'AWS/ApplicationELB', metricName: 'TargetResponseTime', dimensions: {…}, stat: 'p95' }`, and `null` without a load balancer.

Add `'lib/monitoring/ecs.ts'`, `'lib/monitoring/elb.ts'` to `SERVER_ONLY_MODULES`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/monitoring-ecs.test.ts tests/unit/monitoring-elb.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `ecs.ts` and the target group part of `elb.ts`**

Every AWS call goes through `describeCall(target, '<iam action>', <params>, run, deps)` with `sendWithTimeout(client, command, describeTimeout(deps))`. One `describeCall` per AWS action, so a denied failure names the right action. Key code:

```ts
const serviceName = (arn: string) => arn.slice(arn.lastIndexOf('/') + 1);
export const taskDefinitionLabel = (arn: string) => arn.slice(arn.lastIndexOf('/') + 1);
const ms = (d: Date | undefined) => d?.getTime() ?? null;
const byName = (a: string, b: string) => a.localeCompare(b, 'en');
const MAX_SERVICE_ARNS = 2000;

function listServiceArns(target: AwsTarget, cluster: string, deps: MonitoringDeps) {
  return describeCall(target, 'ecs:ListServices', { cluster }, async () => {
    const client = new ECSClient(clientConfig(target.region, target.credentials));
    const arns: string[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const out = await sendWithTimeout(client, new ListServicesCommand({ cluster, maxResults: 100, ...(nextToken ? { nextToken } : {}) }), describeTimeout(deps));
        arns.push(...(out.serviceArns ?? []));
        nextToken = out.nextToken;
      } while (nextToken && arns.length < MAX_SERVICE_ARNS);
    } catch (error) {
      if ((error as { name?: string }).name === 'ClusterNotFoundException') return [];
      throw error;
    }
    return arns;
  }, deps);
}

function describeServicesBatch(target: AwsTarget, cluster: string, names: string[], deps: MonitoringDeps) {
  return describeCall(target, 'ecs:DescribeServices', { cluster, names }, async () => {
    const client = new ECSClient(clientConfig(target.region, target.credentials));
    try {
      const out = await sendWithTimeout(client, new DescribeServicesCommand({ cluster, services: names }), describeTimeout(deps));
      return (out.services ?? []).map((s) => toService(s, cluster));
    } catch (error) {
      if ((error as { name?: string }).name === 'ClusterNotFoundException') return [];
      throw error;
    }
  }, deps);
}

export async function listServices(target: AwsTarget, cluster: string, search: string, deps: MonitoringDeps = {}) {
  const arns = await listServiceArns(target, cluster, deps);
  if (!arns.ok) return arns;
  const needle = search.trim().toLowerCase();
  const names = arns.data.map(serviceName).filter((n) => n.toLowerCase().includes(needle)).sort(byName);
  const shown = names.slice(0, MAX_SERVICES);
  const batches = await Promise.all(chunk(shown, DESCRIBE_SERVICES_BATCH).map((batch) => describeServicesBatch(target, cluster, batch, deps)));
  const failure = batches.find((b) => !b.ok);
  if (failure && !failure.ok) return failure;
  const services = batches.flatMap((b) => (b.ok ? b.data : [])).sort((a, b) => byName(a.name, b.name));
  return { ok: true as const, data: { services, matched: names.length, truncated: names.length > MAX_SERVICES } };
}
```

`toService(s, cluster)`: `primaryDeployment = deployments.find((d) => d.status === 'PRIMARY') ?? null`; `events = (s.events ?? []).slice(0, MAX_EVENTS).map((e) => ({ id: e.id ?? '', createdAt: ms(e.createdAt), message: e.message ?? '' }))` (AWS returns events newest first); `taskDefinitionArn = s.taskDefinition ?? ''`; `taskDefinition = taskDefinitionLabel(taskDefinitionArn)`; deployment `taskDefinition` also through `taskDefinitionLabel`; numbers default to 0, strings to `null` where the type allows.

`listClusters`: `describeCall 'ecs:ListClusters' {}` (paginated, `maxResults: 100`), then, when ARNs exist, `describeCall 'ecs:DescribeClusters' { arns }` in chunks of 100 with `include: ['SETTINGS']`; `containerInsights = settings.some((x) => x.name === 'containerInsights' && (x.value === 'enabled' || x.value === 'enhanced'))`; sort by name.

`describeService(target, cluster, service)`: `describeServicesBatch(target, cluster, [service], deps)` → `data[0] ?? null` (moto and AWS report a missing service in `failures`, which yields an empty `services` array).

`listServiceTasks`: `describeCall 'ecs:ListTasks' { cluster, service }` (paginate until `MAX_TASKS`), then `describeCall 'ecs:DescribeTasks' { cluster, arns }` when non-empty; map `id = taskArn.slice(taskArn.lastIndexOf('/') + 1)`, `taskDefinition = taskDefinitionLabel(taskDefinitionArn)`; sort by `startedAt` descending (nulls last).

`taskDefinitionLogs`: `describeCall 'ecs:DescribeTaskDefinition' { taskDefinitionArn }`; keep `containerDefinitions` where `logConfiguration?.logDriver === 'awslogs' && logConfiguration.options?.['awslogs-group']`.

`elb.ts` (first part): `loadBalancerDimension = (arn) => arn.split(':loadbalancer/')[1] ?? arn`; `targetGroupDimension = (arn) => arn.slice(arn.lastIndexOf(':') + 1)`; `describeTargetGroups` = `Promise.all(chunk(arns, 20).map((batch) => describeCall(target, 'elasticloadbalancing:DescribeTargetGroups', { arns: batch }, run)))`, `TargetGroupNotFoundException` → `[]` inside `run`, results flattened and sorted by name; `targetHealth` = `describeCall(target, 'elasticloadbalancing:DescribeTargetHealth', { targetGroupArn }, …)`; query builders as specified above.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/unit/monitoring-ecs.test.ts tests/unit/monitoring-elb.test.ts tests/unit/module-boundaries.test.ts`
Expected: pass.

- [ ] **Step 5: Containers list page**

`containers/page.tsx`: metadata `localizedTitle('Monitoring.containers.title')`; `Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ range?: string | string[]; q?: string | string[] }> }`; `const context = await initMonitoringRoute(params);` first; `range = parseTimeRange(sp.range)`; `search = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? '').trim().slice(0, 100)`; `MonitoringHeader` with `range`; a GET search form (`Input name="q"` labelled `t('search.label')`, `defaultValue={search}`, hidden `range`, submit `t('search.submit')`); then `<SuspenseCard key={`${range}|${search}`} title={t('clustersTitle')} variant="table"><ClusterSections scope={context.scope} range={range} search={search} /></SuspenseCard>`.

`containers/cards.tsx`:
- `ClusterSections({ scope, range, search })`: `resolveTarget` → `listClusters`; failures → `MonitoringCard` + `FailureNotice`; no cluster → `MonitoringCard` titled `t('clustersTitle')` with `t('noClusters')`; else `<div className="space-y-6">` with one `<SuspenseCard key={c.arn} title={c.name} variant="table"><ServicesCard scope={scope} cluster={c} range={range} search={search} /></SuspenseCard>` per cluster.
- `ServicesCard({ scope, cluster, range, search })`: `resolveTarget` → `listServices(target, cluster.name, search)`; `window = timeWindow(range, Date.now())`; `metrics = await getMetricSeries(target, services.flatMap((s, i) => serviceUtilizationQueries(cluster.name, s.name, `s${i}`)), window)`. The card title is the cluster name; `actions` shows a `Badge` `t('containerInsights')` when `cluster.containerInsights`. A metrics failure renders `FailureNotice` above the table and blank sparklines (the table still renders). `truncated` → `<p>` `t('truncated', { shown: MAX_SERVICES, matched })`. No service → `t('noServices')`. Table columns `t('columns.service' | 'status' | 'tasks' | 'cpu' | 'memory' | 'deployment')`: service name `Link` to `monitoringPath(scope, 'containers', cluster.name, s.name)` + `?range=`; status raw AWS value; tasks `t('taskCounts', { running, desired, pending })`; CPU and memory cells show `formatMetricValue(latestValue(series), 'percent', locale)` and `<Sparkline values={series.values} max={100} label={tCommon('sparkline', { metric: tMetrics('cpu'), value })} />`; deployment `Badge` from `primaryDeployment?.rolloutState` (`COMPLETED` success, `IN_PROGRESS` info, `FAILED` danger) labelled `t(`rollout.${state}`)`, `—` when null or unknown.

- [ ] **Step 6: Service detail page**

`containers/[cluster]/[service]/page.tsx`: metadata `localizedTitle('Monitoring.containers.serviceMetaTitle')`; params add `cluster`, `service`; `const context = await initMonitoringRoute(params);` first; `if (!isEcsName(cluster) || !isEcsName(service)) notFound();`; back link (`ArrowLeft`) `t('back')` to `monitoringPath(scope, 'containers')`; `MonitoringHeader` with `title={service}`, `description={t('serviceDescription', { cluster })}`, `range`; then, each in its own `SuspenseCard`: `ServiceSummaryCard`, `ServiceChartsCard` (variant chart), `TargetGroupsCard`, `TasksCard`, `EventsCard`, `LogsCard`. All cards call `resolveTarget(scope)` and `describeService(...)` themselves (cached).

`cards.tsx`:
- `ServiceSummaryCard`: null service → `t('summary.notFound')`; else a `<dl className="grid gap-3 sm:grid-cols-3">` with `t('summary.status')` status, `t('summary.taskDefinition')` `taskDefinition`, `t('summary.launchType')` launch type or `—`, `t('summary.desired' | 'running' | 'pending')` counts, `t('summary.deployment')` rollout badge plus `rolloutStateReason` and `t('summary.deploymentStarted', { time: format.relativeTime(createdAt) })`.
- `ServiceChartsCard({ scope, cluster, service, range })`: `listClusters` (cached) to know `containerInsights`; queries = `serviceUtilizationQueries(cluster, service, 'u')` plus `serviceTaskCountQueries(cluster, service, 'u')` when Container Insights is on; one `getMetricSeries`; grid `md:grid-cols-2` of `MetricChart` `tMetrics('cpu')` (percent, series `ucpu` labelled `tMetrics('cpu')`), `tMetrics('memory')` (percent), and when Container Insights is on `tMetrics('tasks')` (count, two series labelled `tMetrics('runningTasks')`, `tMetrics('desiredTasks')`).
- `TasksCard`: `listServiceTasks`; empty → `t('tasks.empty')`; table `t('tasks.columns.task' | 'revision' | 'lastStatus' | 'health' | 'started' | 'zone')`, id in mono, started `format.relativeTime`.
- `EventsCard`: `service.events`; empty → `t('events.empty')`; `<ol>` of `<li>` with relative time and the AWS message (untranslated).
- `TargetGroupsCard`: no `loadBalancers` → `t('targetGroups.empty')`; else `describeTargetGroups(target, service.loadBalancers.map((l) => l.targetGroupArn))` and one `<TargetGroupPanel scope={scope} group={g} range={range} />` per group inside the card.
- `LogsCard`: `taskDefinitionLogs(target, service.taskDefinitionArn)`; empty → `t('logs.empty')`; else a list of log group names in mono (`t('logs.otherRegion', { group, region })` when the awslogs region differs from `scope.region`). Task 13 turns same-region names into links to the Logs page.

`src/components/monitoring/target-group-panel.tsx` (async server): `<section aria-labelledby>` with an `<h3>` group name and `protocol:port`; `targetHealth` table (`t('targetGroup.columns.target' | 'state' | 'reason')`, target `id:port`, state badge `healthy` success, `unhealthy` danger, others muted, reason + description as `title`), empty → `t('targetGroup.noTargets')`; if `loadBalancerArns` is empty → `t('targetGroup.notAttached')` and no charts; else `window = timeWindow(range, Date.now())`, `main = getMetricSeries(target, targetGroupQueries(group, 'g'), window)` and, separately, `p95 = getMetricSeries(target, [targetGroupLatencyQuery(group, 'g')!], window)` (own request: moto fact 2). Charts grid: `tMetrics('requests')` (count, `greq`), `tMetrics('target5xx')` (count, `gt5xx`), `tMetrics('responseTimeP95')` (seconds, `gp95`; when `p95` failed render the figure caption and `<p role="status">` `tMetrics('p95Unavailable')` instead of the chart), `tMetrics('hosts')` (count, series `ghealthy` labelled `tMetrics('healthyHosts')`, `gunhealthy` labelled `tMetrics('unhealthyHosts')`). A `main` failure renders `FailureNotice`.

- [ ] **Step 7: Messages**

| Key | en | fr |
|---|---|---|
| `Monitoring.metrics.cpu` | CPU utilization | Utilisation CPU |
| `Monitoring.metrics.memory` | Memory utilization | Utilisation mémoire |
| `Monitoring.metrics.tasks` | Tasks | Tâches |
| `Monitoring.metrics.runningTasks` | Running | En cours |
| `Monitoring.metrics.desiredTasks` | Desired | Souhaitées |
| `Monitoring.metrics.requests` | Requests | Requêtes |
| `Monitoring.metrics.target5xx` | Target 5xx errors | Erreurs 5xx des cibles |
| `Monitoring.metrics.responseTimeP95` | Response time (p95) | Temps de réponse (p95) |
| `Monitoring.metrics.p95Unavailable` | The p95 response time could not be read. | Le temps de réponse p95 n'a pas pu être lu. |
| `Monitoring.metrics.hosts` | Hosts | Hôtes |
| `Monitoring.metrics.healthyHosts` | Healthy | Sains |
| `Monitoring.metrics.unhealthyHosts` | Unhealthy | Défaillants |
| `Monitoring.containers.title` | Containers | Conteneurs |
| `Monitoring.containers.description` | ECS clusters and services of {connection} in {region}. | Clusters et services ECS de {connection} dans {region}. |
| `Monitoring.containers.search.label` | Search services | Rechercher des services |
| `Monitoring.containers.search.submit` | Search | Rechercher |
| `Monitoring.containers.clustersTitle` | ECS clusters | Clusters ECS |
| `Monitoring.containers.noClusters` | No ECS cluster in this region. | Aucun cluster ECS dans cette région. |
| `Monitoring.containers.containerInsights` | Container Insights on | Container Insights activé |
| `Monitoring.containers.noServices` | No service matches. | Aucun service ne correspond. |
| `Monitoring.containers.truncated` | Showing the first {shown} of {matched} services. Refine the search to see the others. | Affichage des {shown} premiers services sur {matched}. Affinez la recherche pour voir les autres. |
| `Monitoring.containers.columns.service` | Service | Service |
| `Monitoring.containers.columns.status` | Status | Statut |
| `Monitoring.containers.columns.tasks` | Tasks | Tâches |
| `Monitoring.containers.columns.cpu` | CPU | CPU |
| `Monitoring.containers.columns.memory` | Memory | Mémoire |
| `Monitoring.containers.columns.deployment` | Last deployment | Dernier déploiement |
| `Monitoring.containers.taskCounts` | {running}/{desired} running · {pending} pending | {running}/{desired} en cours · {pending} en attente |
| `Monitoring.containers.rollout.COMPLETED` | Completed | Terminé |
| `Monitoring.containers.rollout.IN_PROGRESS` | In progress | En cours |
| `Monitoring.containers.rollout.FAILED` | Failed | Échec |
| `Monitoring.containers.back` | All services | Tous les services |
| `Monitoring.containers.serviceMetaTitle` | ECS service | Service ECS |
| `Monitoring.containers.serviceDescription` | ECS service in the {cluster} cluster. | Service ECS du cluster {cluster}. |
| `Monitoring.containers.summary.title` | Service | Service |
| `Monitoring.containers.summary.status` | Status | Statut |
| `Monitoring.containers.summary.taskDefinition` | Task definition | Définition de tâche |
| `Monitoring.containers.summary.launchType` | Launch type | Type de lancement |
| `Monitoring.containers.summary.desired` | Desired tasks | Tâches souhaitées |
| `Monitoring.containers.summary.running` | Running tasks | Tâches en cours |
| `Monitoring.containers.summary.pending` | Pending tasks | Tâches en attente |
| `Monitoring.containers.summary.deployment` | Last deployment | Dernier déploiement |
| `Monitoring.containers.summary.deploymentStarted` | Started {time} | Lancé {time} |
| `Monitoring.containers.summary.notFound` | This service does not exist in this cluster and region. | Ce service n'existe pas dans ce cluster et cette région. |
| `Monitoring.containers.charts.title` | Utilization | Utilisation |
| `Monitoring.containers.tasks.title` | Running tasks | Tâches en cours |
| `Monitoring.containers.tasks.empty` | No running tasks. | Aucune tâche en cours. |
| `Monitoring.containers.tasks.columns.task` | Task | Tâche |
| `Monitoring.containers.tasks.columns.revision` | Revision | Révision |
| `Monitoring.containers.tasks.columns.lastStatus` | Status | Statut |
| `Monitoring.containers.tasks.columns.health` | Health | Santé |
| `Monitoring.containers.tasks.columns.started` | Started | Démarrée |
| `Monitoring.containers.tasks.columns.zone` | Zone | Zone |
| `Monitoring.containers.events.title` | Recent events | Événements récents |
| `Monitoring.containers.events.empty` | No recent event. | Aucun événement récent. |
| `Monitoring.containers.targetGroups.title` | Target groups | Groupes cibles |
| `Monitoring.containers.targetGroups.empty` | This service is not attached to a load balancer. | Ce service n'est rattaché à aucun répartiteur de charge. |
| `Monitoring.containers.logs.title` | Logs | Journaux |
| `Monitoring.containers.logs.empty` | The task definition does not send logs to CloudWatch Logs (awslogs driver). | La définition de tâche n'envoie pas ses journaux à CloudWatch Logs (pilote awslogs). |
| `Monitoring.containers.logs.otherRegion` | {group} (region {region}) | {group} (région {region}) |
| `Monitoring.targetGroup.targets` | Targets | Cibles |
| `Monitoring.targetGroup.noTargets` | No registered target. | Aucune cible enregistrée. |
| `Monitoring.targetGroup.notAttached` | This target group is not attached to a load balancer, so it has no metrics. | Ce groupe cible n'est rattaché à aucun répartiteur de charge : il n'a pas de métriques. |
| `Monitoring.targetGroup.columns.target` | Target | Cible |
| `Monitoring.targetGroup.columns.state` | State | État |
| `Monitoring.targetGroup.columns.reason` | Reason | Raison |

- [ ] **Step 8: E2E tests**

Append to `tests/e2e/06-monitoring.spec.ts`:

```ts
test('the containers page lists the seeded service with its task counts and sparklines', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers'));
  await expect(page).toHaveTitle('Containers · OpsWatch');
  await expect(page.getByRole('heading', { level: 2, name: 'opswatch-e2e', exact: true })).toBeVisible();
  await expect(page.getByText('Container Insights on')).toBeVisible();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'web', exact: true }) });
  // moto starts no task (fact 6): 0 running, 2 pending, deployment in progress.
  await expect(row).toContainText('0/2 running · 2 pending');
  await expect(row).toContainText('In progress');
  await expect(row.getByRole('img', { name: /^CPU utilization over the selected period/ })).toBeVisible();
});

test('the time range is kept in the URL', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers'));
  await page.getByRole('navigation', { name: 'Time range' }).getByRole('link', { name: '12 h' }).click();
  await expect(page).toHaveURL(/range=12h/);
  await expect(page.getByRole('navigation', { name: 'Time range' }).getByRole('link', { name: '12 h' })).toHaveAttribute('aria-current', 'page');
});

test('the service page shows charts, target health and the log group', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers'));
  await page.getByRole('link', { name: 'web', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${connectionId}/us-east-1/containers/opswatch-e2e/web`));
  await expect(page.getByRole('figure', { name: 'CPU utilization' }).locator('.recharts-line-curve')).toHaveCount(1);
  await expect(page.getByRole('figure', { name: 'Tasks' }).locator('.recharts-line-curve')).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 3, name: /opswatch-e2e-web/ })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '10.0.1.10:80' })).toContainText('healthy');
  await expect(page.getByText('/ecs/opswatch-web')).toBeVisible();
  // moto gaps (facts 2 and 6): no running task, no p95.
  await expect(page.getByText('No running tasks.')).toBeVisible();
  await expect(page.getByText('The p95 response time could not be read.')).toBeVisible();
});
```

- [ ] **Step 9: Verify**

Run: `npm test && npm run typecheck && npm run lint`, then the e2e stack.
Expected: all pass (`41 passed` e2e). E2E gaps touched: running tasks content, service events, FAILED/stuck rollouts, p95 values, denied states.

- [ ] **Step 10: Commit**

```bash
git add src messages tests
git commit -m "feat(monitoring): containers page with ECS services, service detail, target groups and logs configuration

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 7: Databases — RDS/Aurora list, instance detail and Performance Insights top SQL

**Files:**
- Create: `src/lib/monitoring/rds.ts`, `src/lib/monitoring/instance-memory.ts`, `src/lib/monitoring/pi.ts`
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/databases/page.tsx`, `databases/cards.tsx`, `databases/[instance]/page.tsx`, `databases/[instance]/cards.tsx`
- Modify: `messages/en.json`, `messages/fr.json`, `tests/unit/module-boundaries.test.ts`, `tests/e2e/06-monitoring.spec.ts`
- Test: `tests/unit/monitoring-rds.test.ts`, `tests/unit/monitoring-pi.test.ts`

**Interfaces:**
- Consumes: Task 2 `describeCall`, `describeTimeout`, `AwsTarget`, `MonitoringDeps`, `MonitoringResult`, `PI_TTL_MS`, `createTtlCache`, `getMetricSeries`, `seriesById`, `latestValue`, `MetricQuery`, `timeWindow`, `parseTimeRange`, `RANGE_SECONDS`, `periodForRange`, `TimeRange`, `TimeWindow`; Task 3 `initMonitoringRoute`, `MonitoringParams`, `resolveTarget`, `MonitoringScope`, `monitoringPath`, `isDbInstanceId`; Task 4 `MonitoringHeader`, `MonitoringCard`, `SuspenseCard`, `FailureNotice`, `MetricChart`, `Sparkline`, `formatMetricValue`, `MetricUnit`; `Table*`, `Badge`, `getFormatter`, `getLocale`, `localizedTitle`, `notFound`; `@aws-sdk/client-rds`, `@aws-sdk/client-pi`.
- Produces:
  - `instance-memory.ts`: `instanceMemoryGiB(instanceClass: string): number | null`
  - `rds.ts`: `type DbRole = 'writer' | 'reader' | 'standalone'`; `type RdsInstance = { id: string; arn: string | null; resourceId: string | null; engine: string; engineVersion: string | null; instanceClass: string; status: string; availabilityZone: string | null; clusterId: string | null; role: DbRole; aurora: boolean; performanceInsights: boolean; memoryGiB: number | null }`; `type RdsCluster = { id: string; engine: string; status: string; writer: string | null; readers: string[] }`; `type RdsMetric = 'CPUUtilization' | 'DatabaseConnections' | 'FreeableMemory' | 'ReadIOPS' | 'WriteIOPS' | 'ReadLatency' | 'WriteLatency' | 'AuroraReplicaLag'`; `RDS_METRIC_UNITS: Record<RdsMetric, MetricUnit>`; `listDatabases(target, deps?): Promise<MonitoringResult<{ clusters: RdsCluster[]; instances: RdsInstance[] }>>`; `findInstance(target, id: string, deps?): Promise<MonitoringResult<{ instance: RdsInstance; cluster: RdsCluster | null } | null>>`; `rdsMetricQueries(instanceId: string, metrics: readonly RdsMetric[], idPrefix: string): MetricQuery[]` (id `${idPrefix}${metric}`); `detailMetrics(instance: RdsInstance): RdsMetric[]`
  - `pi.ts`: `TOP_SQL_LIMIT = 10`; `type TopSqlEntry = { id: string | null; statement: string; load: number }`; `piWindow(range: TimeRange, nowMs: number): TimeWindow`; `topSql(target, resourceId: string, window: TimeWindow, deps?): Promise<MonitoringResult<TopSqlEntry[]>>`

moto limits (facts 7, 8): no Performance Insights backend and `PerformanceInsightsEnabled` never reported, so the PI card is e2e-tested only in its "not enabled" state and `topSql` is covered by unit tests only.

- [ ] **Step 1: Write the failing tests**

`tests/unit/monitoring-rds.test.ts`:

1. **instanceMemoryGiB table.** `db.r6g.large` → 16; `db.r8g.xlarge` → 32; `db.r5.24xlarge` → 768; `db.m6g.2xlarge` → 32; `db.m7i.large` → 8; `db.t3.medium` → 4; `db.t4g.micro` → 1; `db.serverless` → null; `db.x2g.large` → null; `db.r6g.metal` → null; `nonsense` → null.
2. **listDatabases paginates and assigns roles.** `DescribeDBClustersCommand` resolves `{ DBClusters: [{ DBClusterIdentifier: 'orders', Engine: 'aurora-mysql', Status: 'available', DBClusterMembers: [{ DBInstanceIdentifier: 'orders-1', IsClusterWriter: true }, { DBInstanceIdentifier: 'orders-2', IsClusterWriter: false }] }], Marker: 'm' }` then `{ DBClusters: [] }` (second input `{ MaxRecords: 100, Marker: 'm' }`). `DescribeDBInstancesCommand` resolves `{ DBInstances: [orders-2, legacy, orders-1] }` where orders-* have `Engine: 'aurora-mysql'`, `EngineVersion: '8.0.mysql_aurora.3.08.0'`, `DBInstanceClass: 'db.r6g.large'`, `DBClusterIdentifier: 'orders'`, `PerformanceInsightsEnabled: true`, `DbiResourceId: 'db-ORDERS1'`/`'db-ORDERS2'`, and `legacy` has `Engine: 'mysql'`, `DBInstanceClass: 'db.t3.medium'`, `PerformanceInsightsEnabled: false`. Expect `instances.map((i) => [i.id, i.role, i.aurora, i.memoryGiB, i.performanceInsights])` = `[['legacy', 'standalone', false, 4, false], ['orders-1', 'writer', true, 16, true], ['orders-2', 'reader', true, 16, true]]` and `clusters` = `[{ id: 'orders', engine: 'aurora-mysql', status: 'available', writer: 'orders-1', readers: ['orders-2'] }]`. An instance with `ReadReplicaSourceDBInstanceIdentifier: 'legacy'` and no cluster is a `reader`.
3. **findInstance.** Input `{ DBInstanceIdentifier: 'orders-2' }` then `DescribeDBClustersCommand` input `{ DBClusterIdentifier: 'orders' }`; returns `{ instance: { id: 'orders-2', role: 'reader', … }, cluster: { id: 'orders', … } }`. `DBInstanceNotFoundFault` → `{ ok: true, data: null }`. Denied `AccessDenied` → `action: 'rds:DescribeDBInstances'`.
4. **metrics.** `rdsMetricQueries('orders-2', ['CPUUtilization', 'AuroraReplicaLag'], 'm')` = `[{ id: 'mCPUUtilization', namespace: 'AWS/RDS', metricName: 'CPUUtilization', dimensions: { DBInstanceIdentifier: 'orders-2' }, stat: 'Average' }, { id: 'mAuroraReplicaLag', …, metricName: 'AuroraReplicaLag', … }]`. `detailMetrics(reader aurora)` ends with `'AuroraReplicaLag'` (8 metrics); `detailMetrics(writer)` and `detailMetrics(standalone)` have the 7 others. `RDS_METRIC_UNITS` = `{ CPUUtilization: 'percent', DatabaseConnections: 'count', FreeableMemory: 'bytes', ReadIOPS: 'rate', WriteIOPS: 'rate', ReadLatency: 'seconds', WriteLatency: 'seconds', AuroraReplicaLag: 'milliseconds' }`.

`tests/unit/monitoring-pi.test.ts` (mock `PIClient`; `let t = Date.parse('2026-09-17T10:07:42Z')`; cache `createTtlCache({ now: () => t })`):

```ts
it('asks for the top 10 tokenized statements by average load', async () => {
  pi.on(DescribeDimensionKeysCommand).resolves({
    Keys: [
      { Dimensions: { 'db.sql_tokenized.id': 'A1', 'db.sql_tokenized.statement': 'SELECT * FROM orders WHERE id = ?' }, Total: 0.4 },
      { Dimensions: { 'db.sql_tokenized.id': 'B2', 'db.sql_tokenized.statement': 'UPDATE stock SET qty = qty - ? WHERE sku = ?' }, Total: 1.25 },
      { Dimensions: {}, Total: 0.1 },
    ],
  });
  const window = piWindow('1h', t);
  expect(window).toEqual({ start: new Date('2026-09-17T09:05:00Z'), end: new Date('2026-09-17T10:05:00Z'), periodSeconds: 60 });
  const result = await topSql(target, 'db-ORDERS1', window, deps);
  expect(pi.commandCalls(DescribeDimensionKeysCommand)[0].args[0].input).toEqual({
    ServiceType: 'RDS',
    Identifier: 'db-ORDERS1',
    StartTime: window.start,
    EndTime: window.end,
    PeriodInSeconds: 60,
    Metric: 'db.load.avg',
    GroupBy: { Group: 'db.sql_tokenized', Dimensions: ['db.sql_tokenized.id', 'db.sql_tokenized.statement'], Limit: 10 },
  });
  expect(result).toEqual({
    ok: true,
    data: [
      { id: 'B2', statement: 'UPDATE stock SET qty = qty - ? WHERE sku = ?', load: 1.25 },
      { id: 'A1', statement: 'SELECT * FROM orders WHERE id = ?', load: 0.4 },
      { id: null, statement: '', load: 0.1 },
    ],
  });
});

it('keeps top SQL for 5 minutes', async () => {
  pi.on(DescribeDimensionKeysCommand).resolves({ Keys: [] });
  const window = piWindow('3h', t);
  await topSql(target, 'db-ORDERS1', window, deps);
  t += 299_999;
  await topSql(target, 'db-ORDERS1', window, deps);
  expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(1);
  t += 1;
  await topSql(target, 'db-ORDERS1', window, deps);
  expect(pi.commandCalls(DescribeDimensionKeysCommand)).toHaveLength(2);
});

it('reports a denied call', async () => {
  pi.on(DescribeDimensionKeysCommand).rejects(Object.assign(new Error('no'), { name: 'NotAuthorizedException' }));
  expect(await topSql(target, 'db-ORDERS1', piWindow('1h', t), deps)).toEqual({ ok: false, reason: 'denied', code: 'NotAuthorizedException', action: 'pi:DescribeDimensionKeys' });
});
```

Also `piWindow('7d', t).periodSeconds` → 3600 and `piWindow('12h', t).end` → `2026-09-17T10:05:00Z`.

Add `'lib/monitoring/rds.ts'`, `'lib/monitoring/instance-memory.ts'`, `'lib/monitoring/pi.ts'` to `SERVER_ONLY_MODULES`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/monitoring-rds.test.ts tests/unit/monitoring-pi.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`instance-memory.ts`:

```ts
import 'server-only';

const BURSTABLE: Record<string, number> = { micro: 1, small: 2, medium: 4, large: 8, xlarge: 16, '2xlarge': 32 };
const SIZE_UNITS: Record<string, number> = { large: 1, xlarge: 2, '2xlarge': 4, '4xlarge': 8, '8xlarge': 16, '12xlarge': 24, '16xlarge': 32, '24xlarge': 48 };
const GIB_PER_LARGE: Record<string, number> = {
  r5: 16, r6g: 16, r6gd: 16, r6i: 16, r7g: 16, r7i: 16, r8g: 16,
  m5: 8, m6g: 8, m6gd: 8, m6i: 8, m7g: 8, m7i: 8, m8g: 8,
};

/** Memory of common RDS classes. Unknown classes (serverless, x2, metal…) return null and memory rules skip them. */
export function instanceMemoryGiB(instanceClass: string): number | null {
  const match = /^db\.([a-z0-9]+)\.([a-z0-9]+)$/.exec(instanceClass);
  if (!match) return null;
  const [, family, size] = match;
  if (family === 't3' || family === 't4g') return BURSTABLE[size] ?? null;
  const perLarge = GIB_PER_LARGE[family];
  const units = SIZE_UNITS[size];
  return perLarge && units ? perLarge * units : null;
}
```

`rds.ts`: `listDatabases` runs `describeCall(target, 'rds:DescribeDBClusters', {}, …)` and `describeCall(target, 'rds:DescribeDBInstances', {}, …)` in parallel (each paginated with `MaxRecords: 100` and `Marker`, 50 pages max), returns the first failure, then maps: cluster `writer` = member with `IsClusterWriter`, `readers` = other members sorted; instance `role` = `writer` if some cluster lists it as writer, `reader` if listed as a non-writer member or if `ReadReplicaSourceDBInstanceIdentifier` is set, else `standalone`; `aurora = engine.startsWith('aurora')`; `performanceInsights = PerformanceInsightsEnabled === true`; `memoryGiB = instanceMemoryGiB(class)`. Sort instances by `(clusterId ?? id)`, then writer before reader, then id. `findInstance`: `describeCall 'rds:DescribeDBInstances' { id }` with `DBInstanceIdentifier` (`DBInstanceNotFoundFault` → `null` inside `run`), then when `clusterId` is set `describeCall 'rds:DescribeDBClusters' { clusterId }` with `DBClusterIdentifier` (`DBClusterNotFoundFault` → cluster `null`); role computed from that cluster (or `ReadReplicaSourceDBInstanceIdentifier`). `detailMetrics(i)` = the 7 base metrics plus `AuroraReplicaLag` when `i.aurora && i.role === 'reader'`.

`pi.ts`:

```ts
const FIVE_MINUTES = 300_000;

/** PI results are cached 5 minutes, so the window end is floored to 5 minutes to keep the key stable. */
export function piWindow(range: TimeRange, nowMs: number): TimeWindow {
  const end = Math.floor(nowMs / FIVE_MINUTES) * FIVE_MINUTES;
  return { start: new Date(end - RANGE_SECONDS[range] * 1000), end: new Date(end), periodSeconds: periodForRange(range) };
}

export function topSql(target: AwsTarget, resourceId: string, window: TimeWindow, deps: MonitoringDeps = {}): Promise<MonitoringResult<TopSqlEntry[]>> {
  return describeCall(
    target,
    'pi:DescribeDimensionKeys',
    { resourceId, start: window.start, end: window.end, period: window.periodSeconds },
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
          GroupBy: { Group: 'db.sql_tokenized', Dimensions: ['db.sql_tokenized.id', 'db.sql_tokenized.statement'], Limit: TOP_SQL_LIMIT },
        }),
        describeTimeout(deps),
      );
      return (out.Keys ?? [])
        .map((k) => ({ id: k.Dimensions?.['db.sql_tokenized.id'] ?? null, statement: k.Dimensions?.['db.sql_tokenized.statement'] ?? '', load: k.Total ?? 0 }))
        .sort((a, b) => b.load - a.load)
        .slice(0, TOP_SQL_LIMIT);
    },
    deps,
    PI_TTL_MS,
  );
}
```

(The allowed `PeriodInSeconds` values 60, 300 and 3600 are exactly `periodForRange`'s.)

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/unit/monitoring-rds.test.ts tests/unit/monitoring-pi.test.ts tests/unit/module-boundaries.test.ts`
Expected: pass.

- [ ] **Step 5: Pages and cards**

`databases/page.tsx`: metadata `localizedTitle('Monitoring.databases.title')`; `initMonitoringRoute` first; `range`; `MonitoringHeader` with range; `<SuspenseCard key={range} title={t('cardTitle')} variant="table" rows={6}><DatabasesCard scope={context.scope} range={range} /></SuspenseCard>`.

`DatabasesCard`: `resolveTarget` → `listDatabases`; empty → `t('empty')`; `getMetricSeries(target, instances.flatMap((i, n) => rdsMetricQueries(i.id, i.aurora && i.role === 'reader' ? ['CPUUtilization', 'DatabaseConnections', 'FreeableMemory', 'AuroraReplicaLag'] : ['CPUUtilization', 'DatabaseConnections', 'FreeableMemory'], `d${n}`)), timeWindow(range, Date.now()))` (a failure shows `FailureNotice` above the table and `—` values). Table columns `t('columns.instance' | 'cluster' | 'engine' | 'class' | 'role' | 'cpu' | 'connections' | 'freeableMemory' | 'replicaLag')`: instance `Link` to `monitoringPath(scope, 'databases', id)` + `?range=`; cluster id or `—`; engine + version; class; role `t(`roles.${role}`)`; CPU latest percent + `Sparkline max={100}`; connections latest count; freeable memory latest bytes; replica lag latest milliseconds + `Sparkline` for aurora readers, `—` otherwise.

`databases/[instance]/page.tsx`: metadata `localizedTitle('Monitoring.databases.metaTitle')`; `initMonitoringRoute` first; `if (!isDbInstanceId(instance)) notFound();`; back link `t('back')`; `MonitoringHeader` `title={instance}`, `description={t('instanceDescription')}`, `range`; `SuspenseCard`s: `InstanceSummaryCard` (stat), `InstanceChartsCard` (chart), `TopSqlCard` (table).

`databases/[instance]/cards.tsx`:
- `InstanceSummaryCard`: `findInstance` null → `t('notFound')`; else `<dl>` with `t('summary.status')`, engine + version, class, `t('summary.memory')` (`formatMetricValue(memoryGiB * 1024 ** 3, 'bytes', locale)` or `t('summary.memoryUnknown')`), role, cluster, `t('summary.zone')`, `t('summary.performanceInsights')` `t('summary.enabled' | 'summary.disabled')`.
- `InstanceChartsCard`: null → `t('notFound')`; one `getMetricSeries(target, rdsMetricQueries(id, detailMetrics(instance), 'm'), window)`; grid of `MetricChart`s: `tMetrics('cpu')` (`mCPUUtilization`, percent), `tMetrics('connections')` (count), `tMetrics('freeableMemory')` (bytes), `tMetrics('iops')` (rate; two series `tMetrics('read')`, `tMetrics('write')`), `tMetrics('latency')` (seconds; read/write), and `tMetrics('replicaLag')` (milliseconds) only when `detailMetrics` includes it.
- `TopSqlCard({ scope, instanceId, range })`: `findInstance`; when `!performanceInsights || !resourceId` → `<p>` `t('topSql.disabled')`; else `topSql(target, resourceId, piWindow(range, Date.now()))`; failure → `FailureNotice`; empty → `t('topSql.empty')`; table `t('topSql.columns.rank' | 'statement' | 'load')` with `<code className="line-clamp-3 whitespace-pre-wrap break-all font-mono text-xs" title={statement}>` and load `formatMetricValue(load, 'rate', locale)`. Card description `t('topSql.description')`.

- [ ] **Step 6: Messages**

| Key | en | fr |
|---|---|---|
| `Monitoring.metrics.connections` | Connections | Connexions |
| `Monitoring.metrics.freeableMemory` | Freeable memory | Mémoire disponible |
| `Monitoring.metrics.iops` | IOPS | IOPS |
| `Monitoring.metrics.latency` | Latency | Latence |
| `Monitoring.metrics.read` | Read | Lecture |
| `Monitoring.metrics.write` | Write | Écriture |
| `Monitoring.metrics.replicaLag` | Replica lag | Retard de réplication |
| `Monitoring.databases.title` | Databases | Bases de données |
| `Monitoring.databases.description` | RDS and Aurora instances of {connection} in {region}. | Instances RDS et Aurora de {connection} dans {region}. |
| `Monitoring.databases.cardTitle` | Database instances | Instances de base de données |
| `Monitoring.databases.empty` | No database instance in this region. | Aucune instance de base de données dans cette région. |
| `Monitoring.databases.columns.instance` | Instance | Instance |
| `Monitoring.databases.columns.cluster` | Cluster | Cluster |
| `Monitoring.databases.columns.engine` | Engine | Moteur |
| `Monitoring.databases.columns.class` | Class | Classe |
| `Monitoring.databases.columns.role` | Role | Rôle |
| `Monitoring.databases.columns.cpu` | CPU | CPU |
| `Monitoring.databases.columns.connections` | Connections | Connexions |
| `Monitoring.databases.columns.freeableMemory` | Freeable memory | Mémoire disponible |
| `Monitoring.databases.columns.replicaLag` | Replica lag | Retard de réplication |
| `Monitoring.databases.roles.writer` | Writer | Écriture |
| `Monitoring.databases.roles.reader` | Reader | Lecture |
| `Monitoring.databases.roles.standalone` | Standalone | Autonome |
| `Monitoring.databases.back` | All databases | Toutes les bases de données |
| `Monitoring.databases.metaTitle` | Database instance | Instance de base de données |
| `Monitoring.databases.instanceDescription` | RDS database instance. | Instance de base de données RDS. |
| `Monitoring.databases.notFound` | This instance does not exist in this region. | Cette instance n'existe pas dans cette région. |
| `Monitoring.databases.summary.title` | Instance | Instance |
| `Monitoring.databases.summary.status` | Status | Statut |
| `Monitoring.databases.summary.engine` | Engine | Moteur |
| `Monitoring.databases.summary.class` | Class | Classe |
| `Monitoring.databases.summary.memory` | Memory | Mémoire |
| `Monitoring.databases.summary.memoryUnknown` | Unknown for this class | Inconnue pour cette classe |
| `Monitoring.databases.summary.role` | Role | Rôle |
| `Monitoring.databases.summary.cluster` | Cluster | Cluster |
| `Monitoring.databases.summary.zone` | Availability zone | Zone de disponibilité |
| `Monitoring.databases.summary.performanceInsights` | Performance Insights | Performance Insights |
| `Monitoring.databases.summary.enabled` | Enabled | Activé |
| `Monitoring.databases.summary.disabled` | Disabled | Désactivé |
| `Monitoring.databases.charts.title` | Metrics | Métriques |
| `Monitoring.databases.topSql.title` | Top SQL | Top SQL |
| `Monitoring.databases.topSql.description` | Statements ranked by average active sessions over the selected period. | Requêtes classées par sessions actives moyennes sur la période choisie. |
| `Monitoring.databases.topSql.disabled` | Performance Insights is not enabled for this instance. | Performance Insights n'est pas activé pour cette instance. |
| `Monitoring.databases.topSql.empty` | No SQL activity recorded for this period. | Aucune activité SQL enregistrée sur cette période. |
| `Monitoring.databases.topSql.columns.rank` | Rank | Rang |
| `Monitoring.databases.topSql.columns.statement` | Statement | Requête |
| `Monitoring.databases.topSql.columns.load` | Average active sessions | Sessions actives moyennes |

- [ ] **Step 7: E2E tests**

```ts
test('the databases page lists the seeded instance', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'databases'));
  await expect(page).toHaveTitle('Databases · OpsWatch');
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'opswatch-e2e-db' }) });
  await expect(row).toContainText('db.t3.medium');
  await expect(row).toContainText('Standalone');
  await expect(row).toContainText('3 GB');
});

test('the instance page shows charts and explains that Performance Insights is off', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'databases'));
  await page.getByRole('link', { name: 'opswatch-e2e-db' }).click();
  await expect(page.getByRole('figure', { name: 'CPU utilization' }).locator('.recharts-line-curve')).toHaveCount(1);
  await expect(page.getByRole('figure', { name: 'IOPS' }).locator('.recharts-line-curve')).toHaveCount(2);
  // moto never reports Performance Insights as enabled (fact 7) and has no PI backend (fact 8).
  await expect(page.getByText('Performance Insights is not enabled for this instance.')).toBeVisible();
});
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npm run lint`, then the e2e stack.
Expected: all pass (`43 passed` e2e). E2E gaps touched: Performance Insights top SQL, Aurora roles and replica lag, denied states.

- [ ] **Step 9: Commit**

```bash
git add src messages tests
git commit -m "feat(monitoring): databases page with RDS/Aurora instances, instance metrics and Performance Insights top SQL

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Load balancers — ALB list and detail

**Files:**
- Modify: `src/lib/monitoring/elb.ts`
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/load-balancers/page.tsx`, `load-balancers/cards.tsx`, `load-balancers/[name]/page.tsx`, `load-balancers/[name]/cards.tsx`
- Modify: `messages/en.json`, `messages/fr.json`, `tests/unit/monitoring-elb.test.ts`, `tests/e2e/06-monitoring.spec.ts`

**Interfaces:**
- Consumes: Task 6 `TargetGroup`, `TargetHealthEntry`, `loadBalancerDimension`, `targetHealth`, `TargetGroupPanel`; Task 2 `describeCall`, `describeTimeout`, `getMetricSeries`, `seriesById`, `latestValue`, `MetricQuery`, `timeWindow`, `parseTimeRange`; Task 3 `initMonitoringRoute`, `MonitoringParams`, `resolveTarget`, `monitoringPath`, `isLoadBalancerName`; Task 4 `MonitoringHeader`, `MonitoringCard`, `SuspenseCard`, `FailureNotice`, `MetricChart`, `formatMetricValue`; `Table*`, `TONE_TEXT`, `getFormatter`, `getLocale`, `localizedTitle`, `notFound`.
- Produces (added to `elb.ts`):
  - `type LoadBalancer = { name: string; arn: string; dimension: string; dnsName: string | null; scheme: string | null; state: string | null; vpcId: string | null; createdAt: number | null }`
  - `MAX_TARGET_GROUPS_WITH_HEALTH = 50`
  - `listLoadBalancers(target, deps?): Promise<MonitoringResult<LoadBalancer[]>>`
  - `findLoadBalancer(target, name: string, deps?): Promise<MonitoringResult<LoadBalancer | null>>`
  - `listTargetGroups(target, loadBalancerArn: string | null, deps?): Promise<MonitoringResult<TargetGroup[]>>`
  - `loadBalancerQueries(lb: LoadBalancer, idPrefix: string): MetricQuery[]` (dimensions `{ LoadBalancer: lb.dimension }`: `${p}req` RequestCount Sum, `${p}elb5xx` HTTPCode_ELB_5XX_Count Sum, `${p}t5xx` HTTPCode_Target_5XX_Count Sum)
  - `loadBalancerLatencyQuery(lb: LoadBalancer, idPrefix: string): MetricQuery` (`${p}p95` TargetResponseTime `p95`)
  - `targetHealthCounts(entries: readonly TargetHealthEntry[]): { healthy: number; unhealthy: number }`

moto limits (facts 2, 5): p95 requests fail, so the p95 column shows `—` and the detail p95 chart shows its unavailable notice in e2e; ELB 5xx values are unit-tested (the seed puts none).

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/monitoring-elb.test.ts`)

1. `listLoadBalancers` paginates (`DescribeLoadBalancersCommand` inputs `{ PageSize: 400 }` then `{ PageSize: 400, Marker: 'm' }`), keeps `Type === 'application'` only (drops a `network` one), sorts by name and maps `{ LoadBalancerName: 'api', LoadBalancerArn: 'arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/api/50dc6c495c0c9188', DNSName: 'api-1.eu-west-1.elb.amazonaws.com', Scheme: 'internet-facing', State: { Code: 'active' }, VpcId: 'vpc-1', CreatedTime: new Date('2026-01-01T00:00:00Z'), Type: 'application' }` to `{ name: 'api', arn, dimension: 'app/api/50dc6c495c0c9188', dnsName: 'api-1.eu-west-1.elb.amazonaws.com', scheme: 'internet-facing', state: 'active', vpcId: 'vpc-1', createdAt: Date.parse('2026-01-01T00:00:00Z') }`.
2. `findLoadBalancer(target, 'api')` input `{ Names: ['api'] }`; `LoadBalancerNotFoundException` → `{ ok: true, data: null }`; a `network` type → `null`.
3. `listTargetGroups(target, lbArn)` input `{ LoadBalancerArn: lbArn, PageSize: 400 }`; `listTargetGroups(target, null)` input `{ PageSize: 400 }`; pagination with `Marker`.
4. `loadBalancerQueries(lb, 'l0')` exact three queries; `loadBalancerLatencyQuery(lb, 'l0')` exact query with `stat: 'p95'`.
5. `targetHealthCounts([healthy, unhealthy, draining, initial, unhealthy.draining])` → `{ healthy: 1, unhealthy: 1 }` (`state === 'healthy'` and `state === 'unhealthy'` only).

- [ ] **Step 2: Run to see failures**

Run: `npx vitest run tests/unit/monitoring-elb.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement** (all through `describeCall` with actions `elasticloadbalancing:DescribeLoadBalancers` / `elasticloadbalancing:DescribeTargetGroups`, `LoadBalancerNotFoundException` → `null` inside `run`, 50 pages max).

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run tests/unit/monitoring-elb.test.ts`
Expected: pass.

- [ ] **Step 5: Pages and cards**

`load-balancers/page.tsx`: metadata `localizedTitle('Monitoring.loadBalancers.title')`; `initMonitoringRoute` first; `range`; header with range; `<SuspenseCard key={range} title={t('cardTitle')} variant="table"><LoadBalancersCard scope range /></SuspenseCard>`.

`LoadBalancersCard`: `resolveTarget`; `listLoadBalancers` and `listTargetGroups(target, null)` in parallel (failures → notice); empty → `t('empty')`; `window = timeWindow(range, Date.now())`; `main = getMetricSeries(target, lbs.flatMap((lb, i) => loadBalancerQueries(lb, `l${i}`)), window)`; `p95 = getMetricSeries(target, lbs.map((lb, i) => loadBalancerLatencyQuery(lb, `l${i}`)), window)` (separate request, moto fact 2); target health for the first `MAX_TARGET_GROUPS_WITH_HEALTH` groups (`Promise.all(targetHealth…)`), counted per load balancer through `group.loadBalancerArns`. Table columns `t('columns.name' | 'scheme' | 'state' | 'requests' | 'elb5xx' | 'target5xx' | 'p95' | 'hosts')`: name `Link` to `monitoringPath(scope, 'load-balancers', name)` + `?range=`; requests/5xx = `series.values.reduce((a, b) => a + b, 0)` over the range, formatted `count`; p95 = latest p95 datapoint formatted `seconds` or `—` when `p95` failed or is empty; hosts `t('hostCounts', { healthy, unhealthy })` (unhealthy > 0 rendered with `TONE_TEXT.danger`). A `main` failure renders `FailureNotice` and `—` cells.

`load-balancers/[name]/page.tsx`: metadata `localizedTitle('Monitoring.loadBalancers.metaTitle')`; `initMonitoringRoute` first; `if (!isLoadBalancerName(name)) notFound();`; back link `t('back')`; header `title={name}`, `description={t('detailDescription')}`, range; cards `LoadBalancerSummaryCard` (stat), `LoadBalancerChartsCard` (chart), `TargetGroupsSection` (table).

`[name]/cards.tsx`:
- `LoadBalancerSummaryCard`: `findLoadBalancer` null → `t('notFound')`; `<dl>` DNS name (mono, `break-all`), scheme, state, VPC, `t('summary.created', { time: format.relativeTime(createdAt) })`.
- `LoadBalancerChartsCard`: `main` + separate `p95`; charts `tMetrics('requests')` (count), `tMetrics('errors5xx')` (count; series `l0elb5xx` labelled `tMetrics('elb5xx')`, `l0t5xx` labelled `tMetrics('target5xx')`), `tMetrics('responseTimeP95')` (seconds, or the `p95Unavailable` notice).
- `TargetGroupsSection`: `listTargetGroups(target, lb.arn)`; empty → `t('targetGroups.empty')`; one `TargetGroupPanel` per group.

- [ ] **Step 6: Messages**

| Key | en | fr |
|---|---|---|
| `Monitoring.metrics.elb5xx` | Load balancer 5xx errors | Erreurs 5xx du répartiteur |
| `Monitoring.metrics.errors5xx` | 5xx errors | Erreurs 5xx |
| `Monitoring.loadBalancers.title` | Load balancers | Répartiteurs de charge |
| `Monitoring.loadBalancers.description` | Application load balancers of {connection} in {region}. | Application Load Balancers de {connection} dans {region}. |
| `Monitoring.loadBalancers.cardTitle` | Application load balancers | Application Load Balancers |
| `Monitoring.loadBalancers.empty` | No application load balancer in this region. | Aucun Application Load Balancer dans cette région. |
| `Monitoring.loadBalancers.columns.name` | Name | Nom |
| `Monitoring.loadBalancers.columns.scheme` | Scheme | Schéma |
| `Monitoring.loadBalancers.columns.state` | State | État |
| `Monitoring.loadBalancers.columns.requests` | Requests | Requêtes |
| `Monitoring.loadBalancers.columns.elb5xx` | ELB 5xx | 5xx ELB |
| `Monitoring.loadBalancers.columns.target5xx` | Target 5xx | 5xx cibles |
| `Monitoring.loadBalancers.columns.p95` | p95 response time | Temps de réponse p95 |
| `Monitoring.loadBalancers.columns.hosts` | Healthy / unhealthy hosts | Hôtes sains / défaillants |
| `Monitoring.loadBalancers.hostCounts` | {healthy} / {unhealthy} | {healthy} / {unhealthy} |
| `Monitoring.loadBalancers.back` | All load balancers | Tous les répartiteurs de charge |
| `Monitoring.loadBalancers.metaTitle` | Load balancer | Répartiteur de charge |
| `Monitoring.loadBalancers.detailDescription` | Application load balancer. | Application Load Balancer. |
| `Monitoring.loadBalancers.notFound` | This load balancer does not exist in this region, or it is not an application load balancer. | Ce répartiteur de charge n'existe pas dans cette région, ou ce n'est pas un Application Load Balancer. |
| `Monitoring.loadBalancers.summary.title` | Load balancer | Répartiteur de charge |
| `Monitoring.loadBalancers.summary.dnsName` | DNS name | Nom DNS |
| `Monitoring.loadBalancers.summary.scheme` | Scheme | Schéma |
| `Monitoring.loadBalancers.summary.state` | State | État |
| `Monitoring.loadBalancers.summary.vpc` | VPC | VPC |
| `Monitoring.loadBalancers.summary.created` | Created {time} | Créé {time} |
| `Monitoring.loadBalancers.charts.title` | Traffic and errors | Trafic et erreurs |
| `Monitoring.loadBalancers.targetGroups.title` | Target groups | Groupes cibles |
| `Monitoring.loadBalancers.targetGroups.empty` | No target group is attached to this load balancer. | Aucun groupe cible n'est rattaché à ce répartiteur de charge. |

- [ ] **Step 7: E2E tests**

```ts
test('the load balancers page lists the seeded ALB with its requests and hosts', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'load-balancers'));
  await expect(page).toHaveTitle('Load balancers · OpsWatch');
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'opswatch-e2e-alb' }) });
  await expect(row).toContainText('3,600'); // 30 datapoints of 120 requests
  await expect(row).toContainText('1 / 0');
  await expect(row).toContainText('—'); // p95 unavailable on moto (fact 2)
});

test('the load balancer page shows traffic charts and its target group', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'load-balancers'));
  await page.getByRole('link', { name: 'opswatch-e2e-alb' }).click();
  await expect(page.getByRole('figure', { name: 'Requests' }).first().locator('.recharts-line-curve')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 3, name: /opswatch-e2e-web/ })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '10.0.1.10:80' })).toContainText('healthy');
});
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npm run lint`, then the e2e stack.
Expected: all pass (`45 passed` e2e). E2E gaps touched: p95 values, ELB 5xx values, denied states.

- [ ] **Step 9: Commit**

```bash
git add src messages tests
git commit -m "feat(monitoring): load balancers page with ALB traffic, 5xx, p95 and target groups

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 9: Insight rules (pure functions)

**Files:**
- Create: `src/lib/monitoring/evaluate.ts`, `src/lib/monitoring/insights.ts`
- Modify: `messages/en.json`, `messages/fr.json`, `tests/unit/module-boundaries.test.ts`
- Test: `tests/unit/monitoring-evaluate.test.ts`, `tests/unit/monitoring-insights.test.ts`

**Interfaces:**
- Consumes: Task 2 `SeriesData`; Task 3 `monitoringPath`, `ScopeRef`; Task 4 `formatMetricValue`, `MetricUnit`; Task 5 `AlarmSummary`; Task 6 `EcsService`, `EcsDeployment`, `TargetGroup`; Task 7 `RdsInstance`, `RdsCluster`; Task 8 `LoadBalancer`.
- Produces:
  - `evaluate.ts`: `MIN_CONSECUTIVE = 3`; `type Direction = 'above' | 'below'`; `type Level = { threshold: number; clearAt: number }`; `type Levels = { warning: Level; critical?: Level }`; `sliceSince(series: SeriesData, sinceMs: number): SeriesData`; `average(values: readonly number[]): number | null`; `sum(values: readonly number[]): number`; `breachActive(values: readonly number[], level: Level, direction: Direction): boolean`; `thresholdLevel(series: SeriesData, levels: Levels, direction: Direction): 'critical' | 'warning' | null`
  - `insights.ts`:
    - `type InsightSeverity = 'critical' | 'warning' | 'info'`
    - `type InsightKind = 'ecs_tasks_below_desired' | 'ecs_cpu_high' | 'ecs_memory_high' | 'ecs_rollout_failed' | 'ecs_rollout_stuck' | 'rds_cpu_high' | 'rds_freeable_memory_low' | 'aurora_replica_lag' | 'alb_5xx_rate' | 'alb_elb_5xx_count' | 'alb_unhealthy_hosts' | 'alarm_firing'`
    - `type InsightValues = Record<string, string | number>`
    - `type InsightMember = { resource: string; severity: InsightSeverity; messageKey: string; values: InsightValues; href: string }`
    - `type Insight = { severity: InsightSeverity; kind: InsightKind; resource: string; messageKey: string; values: InsightValues; href: string; members?: InsightMember[] }`
    - `type RuleContext = { scope: ScopeRef; now: number }` (`now` = window end, epoch ms)
    - constants: `INSIGHT_WINDOW_MINUTES = 15`, `TASKS_WINDOW_MINUTES = 10`, `ROLLOUT_STUCK_MINUTES = 30`, `GROUP_MIN_SERVICES = 4`, `ECS_UTILIZATION_LEVELS`, `RDS_CPU_LEVELS`, `FREEABLE_MEMORY_LEVELS`, `REPLICA_LAG_LEVELS`, `ALB_5XX_RATE_LEVELS`, `ALB_MIN_REQUESTS = 100`, `ALB_ELB_5XX_COUNT = { warning: 10, critical: 100 }`, `UNHEALTHY_HOSTS_LEVELS`
    - `type EcsServiceSignals = { service: EcsService; cpu: SeriesData; memory: SeriesData; running: SeriesData | null; desired: SeriesData | null }`; `type EcsClusterSignals = { cluster: string; services: EcsServiceSignals[] }`
    - `type RdsInstanceSignals = { instance: RdsInstance; cpu: SeriesData; freeableMemory: SeriesData; replicaLag: SeriesData | null }`
    - `type AlbSignals = { loadBalancer: LoadBalancer; requests: SeriesData; elb5xx: SeriesData; target5xx: SeriesData; targetGroups: { group: TargetGroup; unhealthy: SeriesData }[] }`
    - `ecsInsights(clusters: readonly EcsClusterSignals[], ctx: RuleContext): Insight[]`
    - `rdsInsights(input: { clusters: readonly RdsCluster[]; instances: readonly RdsInstanceSignals[] }, ctx: RuleContext): Insight[]`
    - `albInsights(input: readonly AlbSignals[], ctx: RuleContext): Insight[]`
    - `alarmInsights(alarms: readonly AlarmSummary[], ctx: RuleContext): Insight[]`
    - `sortInsights(insights: readonly Insight[]): Insight[]`
    - `INSIGHT_VALUE_UNITS: Record<string, Record<string, MetricUnit>>` (keyed by message key)
    - `formatInsightValues(messageKey: string, values: InsightValues, locale: string): InsightValues`

**Rule semantics (binding; spec §6 with amendments 7 and 8):**
- Evaluation windows are sliced from fetched 1-minute series: datapoints with `timestamp >= now - minutes * 60_000`.
- A **threshold rule** fires at a level when both hold: (a) the window average is past the level's threshold (`>` for `above`, `<` for `below`), and (b) the hysteresis state is active at the end of the window. Hysteresis walks the datapoints in order: while inactive, a run of `MIN_CONSECUTIVE` (3) consecutive datapoints past the threshold activates it; while active, a datapoint at or beyond `clearAt` (`<= clearAt` for `above`, `>= clearAt` for `below`) clears it, and datapoints between `clearAt` and the threshold keep it active. Critical is checked first with its own threshold and `clearAt`.
- `clearAt` ruling: "5 points below" applies literally to percentage-of-capacity rules (ECS CPU/memory, RDS CPU, freeable memory percent); for rules in other units the margin is 5 % of the threshold (replica lag 1000 → 950 ms; ALB 5xx rate 1 % → 0.95 %, 5 % → 4.75 %), because 5 points below a 1 % threshold could never clear. Unhealthy hosts clear at 0.
- Levels: ECS CPU and memory warning 85 (clear 80), critical 95 (clear 90); RDS CPU warning 80 (clear 75), critical 95 (clear 90); freeable memory below 5 % of instance memory warning (clear at 10 %), skipped when `memoryGiB` is null; Aurora replica lag above 1000 ms warning (clear 950); unhealthy hosts (Maximum) above 0 warning (clear 0).
- **ECS tasks below desired (critical):** with Container Insights series, align `running` and `desired` on timestamps within the last 10 minutes; fires when there are at least 3 aligned datapoints and every one has `running < desired` (values `running`/`desired` = last aligned values, rounded). Without Container Insights series (null, or fewer than 3 aligned datapoints): fires when `service.runningCount < service.desiredCount` and `primaryDeployment.updatedAt <= now - 10 min` (values from describe).
- **ECS rollout:** primary deployment `rolloutState === 'FAILED'` → critical (`reason` = `rolloutStateReason ?? ''`); `IN_PROGRESS` with `createdAt <= now - 30 min` → warning (`minutes` = whole minutes since `createdAt`).
- **ECS grouping:** per cluster and kind, 4 or more service insights (more than 3) become one insight: `resource` = cluster, `messageKey` = `groups.<kind>`, `values` = `{ cluster, count }`, `severity` = highest member severity, `href` = containers page, `members` = the individual insights (as `InsightMember`, sorted by resource).
- **RDS CPU** → `rds_cpu_high` (`instance`, `value` = window average, `threshold`); **freeable memory** → percent series `bytes / (memoryGiB * 1024^3) * 100`, `rds_freeable_memory_low` (`instance`, `value` = average percent).
- **Aurora replica lag (always grouped per cluster):** readers = aurora instances with role `reader` and a `replicaLag` series, grouped by `clusterId`; lagging = readers whose lag level is `warning`; when lagging ≥ 1 → one warning insight `resource` = cluster id, `messageKey` `messages.aurora_replica_lag`, `values` `{ cluster, lagging, readers }`, `members` per lagging reader with `messageKey` `members.aurora_replica_lag` and `values` `{ instance, value }` (average lag ms).
- **ALB rate check:** in the 15-minute window, `requests = sum(requests)`, `errors = sum(elb5xx) + sum(target5xx)`; skipped when `requests < 100`; `rate = errors / requests * 100`; per-minute rate series computed on the request timestamps with `requests > 0` (missing 5xx datapoints count as 0). Critical when `rate > 5` and `breachActive(rates, { threshold: 5, clearAt: 4.75 }, 'above')`; else warning when `rate > 1` and `breachActive(rates, { threshold: 1, clearAt: 0.95 }, 'above')`. Values `{ loadBalancer, rate, errors, requests }`.
- **ALB absolute check (independent of RequestCount):** `count = sum(elb5xx)` in the window; `>= 100` critical, `>= 10` warning; values `{ loadBalancer, count }`. Both checks may fire for the same load balancer.
- **Unhealthy hosts:** per target group, `thresholdLevel(unhealthy, UNHEALTHY_HOSTS_LEVELS, 'above')` → `alb_unhealthy_hosts` warning, `resource` = `<lb>/<tg>`, values `{ loadBalancer, targetGroup, count }` (`count` = rounded maximum in the window).
- **Alarms:** each alarm with `state === 'ALARM'` and not `targetTracking` → `alarm_firing` critical, `values { alarm }`, `href` = alarms page with `?state=ALARM`.
- hrefs (without locale): ECS service `monitoringPath(scope, 'containers', cluster, service)`; RDS instance `monitoringPath(scope, 'databases', id)`; Aurora group `monitoringPath(scope, 'databases')`; ALB `monitoringPath(scope, 'load-balancers', name)`.
- `sortInsights`: severity (critical, warning, info), then kind, then resource.
- Counts that feed ICU plurals (`count`, `lagging`, `readers`, `errors`, `requests`, `running`, `desired`, `minutes`) stay numbers; only the keys listed in `INSIGHT_VALUE_UNITS` are pre-formatted: `messages.ecs_cpu_high`, `messages.ecs_memory_high`, `messages.rds_cpu_high` → `{ value: 'percent', threshold: 'percent' }`; `messages.rds_freeable_memory_low` → `{ value: 'percent' }`; `messages.alb_5xx_rate` → `{ rate: 'percent' }`; `members.aurora_replica_lag` → `{ value: 'milliseconds' }`.

- [ ] **Step 1: Write the failing tests**

Shared fixture helper at the top of both test files:

```ts
const NOW = Date.parse('2026-09-17T10:00:00Z');
/** A 1-minute series whose last datapoint is at NOW. */
const series = (values: number[]) => ({ timestamps: values.map((_, i) => NOW - (values.length - 1 - i) * 60_000), values });
const repeat = (value: number, n: number) => Array.from({ length: n }, () => value);
const ctx = { scope: { connectionId: 'abc123def456', region: 'eu-west-1' }, now: NOW };
```

`tests/unit/monitoring-evaluate.test.ts`:

```ts
describe('breachActive', () => {
  const warn = { threshold: 85, clearAt: 80 };
  it.each([
    [[86, 86, 86], true],
    [[86, 86], false],
    [[86, 84, 86, 86], false],
    [[86, 86, 86, 82, 83], true],
    [[86, 86, 86, 80], false],
    [[86, 86, 86, 79, 86, 86], false],
    [[], false],
  ])('above 85, clearing at 80: %j → %s', (values, expected) => {
    expect(breachActive(values, warn, 'above')).toBe(expected);
  });

  it('works downwards', () => {
    const low = { threshold: 5, clearAt: 10 };
    expect(breachActive([4, 4, 4], low, 'below')).toBe(true);
    expect(breachActive([4, 4, 4, 9], low, 'below')).toBe(true);
    expect(breachActive([4, 4, 4, 10], low, 'below')).toBe(false);
  });
});

describe('thresholdLevel', () => {
  const levels = { warning: { threshold: 85, clearAt: 80 }, critical: { threshold: 95, clearAt: 90 } };
  it('needs both the average and a held breach', () => {
    expect(thresholdLevel(series(repeat(86, 15)), levels, 'above')).toBe('warning');
    expect(thresholdLevel(series(repeat(96, 15)), levels, 'above')).toBe('critical');
    expect(thresholdLevel(series(repeat(85, 15)), levels, 'above')).toBeNull();
    expect(thresholdLevel(series([...repeat(84, 12), 99, 99, 99]), levels, 'above')).toBe('warning');
    expect(thresholdLevel(series([...repeat(90, 12), 79, 79, 79]), levels, 'above')).toBeNull();
    expect(thresholdLevel(series([...repeat(50, 12), 99, 99, 99]), levels, 'above')).toBeNull();
    expect(thresholdLevel(series([]), levels, 'above')).toBeNull();
  });

  it('slices the evaluation window by time', () => {
    const old = series([...repeat(99, 20), ...repeat(50, 15)]);
    expect(thresholdLevel(sliceSince(old, NOW - 15 * 60_000), levels, 'above')).toBeNull();
    expect(sliceSince(series([1, 2, 3]), NOW - 60_000).values).toEqual([2, 3]);
    expect(average([1, 2, 3])).toBe(2);
    expect(average([])).toBeNull();
    expect(sum([1, 2, 3])).toBe(6);
  });
});
```

`tests/unit/monitoring-insights.test.ts` — fixtures `service(overrides)` returning an `EcsService` (`name: 'web'`, `cluster: 'prod'`, `status: 'ACTIVE'`, `desiredCount: 2`, `runningCount: 2`, `pendingCount: 0`, `primaryDeployment: { id: 'd', status: 'PRIMARY', rolloutState: 'COMPLETED', rolloutStateReason: null, taskDefinition: 'web:1', desiredCount: 2, runningCount: 2, pendingCount: 0, failedTasks: 0, createdAt: NOW - 3_600_000, updatedAt: NOW - 3_600_000 }`, `deployments`, `events: []`, `loadBalancers: []`, …) and `signals(overrides)` = `{ service: service(), cpu: series(repeat(30, 15)), memory: series(repeat(40, 15)), running: null, desired: null, ...overrides }`. Cases:

1. **CPU warning with values and href:** `ecsInsights([{ cluster: 'prod', services: [signals({ cpu: series(repeat(90, 15)) })] }], ctx)` equals `[{ severity: 'warning', kind: 'ecs_cpu_high', resource: 'web', messageKey: 'messages.ecs_cpu_high', values: { service: 'web', value: 90, threshold: 85 }, href: '/c/abc123def456/eu-west-1/containers/prod/web' }]`; memory 96 × 15 → `ecs_memory_high` critical with `threshold: 95`.
2. **Tasks below desired from Container Insights:** `running: series(repeat(1, 11))`, `desired: series(repeat(2, 11))` → one `ecs_tasks_below_desired` critical `values { service: 'web', running: 1, desired: 2 }`; with the last running datapoint 2 → none.
3. **Tasks below desired without Container Insights:** `running: series([1, 1])`, `desired: series([2, 2])` (only 2 aligned) and `service({ runningCount: 1, desiredCount: 2, primaryDeployment: { …, updatedAt: NOW - 11 * 60_000 } })` → critical `{ running: 1, desired: 2 }`; `updatedAt: NOW - 9 * 60_000` → none.
4. **Rollouts:** `rolloutState: 'FAILED', rolloutStateReason: 'circuit breaker'` → `ecs_rollout_failed` critical `{ service: 'web', reason: 'circuit breaker' }`; `IN_PROGRESS` with `createdAt: NOW - 31 * 60_000` → `ecs_rollout_stuck` warning `{ service: 'web', minutes: 31 }`; `createdAt: NOW - 29 * 60_000` → none.
5. **Grouping:** four services `a`…`d` with CPU 90 in cluster `prod` → exactly one insight `{ severity: 'warning', kind: 'ecs_cpu_high', resource: 'prod', messageKey: 'groups.ecs_cpu_high', values: { cluster: 'prod', count: 4 }, href: '/c/abc123def456/eu-west-1/containers' }` with 4 `members` (`resource` a…d, `messageKey` `messages.ecs_cpu_high`); one of them at 96 makes the group `critical`; three services → three individual insights.
6. **RDS:** instance fixture `{ id: 'orders-1', role: 'writer', aurora: true, memoryGiB: 16, clusterId: 'orders', … }`: CPU 81 × 15 → `rds_cpu_high` warning `{ instance: 'orders-1', value: 81, threshold: 80 }`, href `/c/abc123def456/eu-west-1/databases/orders-1`; freeable memory `0.5 * 1024 ** 3` × 15 → `rds_freeable_memory_low` warning `{ instance: 'orders-1', value: 3.125 }`; same with `memoryGiB: null` → none.
7. **Aurora replica lag grouped:** cluster `orders` with readers `orders-2` (lag 1500 × 15) and `orders-3` (lag 200 × 15), writer `orders-1` (lag null) → one insight `{ severity: 'warning', kind: 'aurora_replica_lag', resource: 'orders', messageKey: 'messages.aurora_replica_lag', values: { cluster: 'orders', lagging: 1, readers: 2 }, href: '/c/abc123def456/eu-west-1/databases', members: [{ resource: 'orders-2', severity: 'warning', messageKey: 'members.aurora_replica_lag', values: { instance: 'orders-2', value: 1500 }, href: '/c/abc123def456/eu-west-1/databases/orders-2' }] }`; both at 200 → none.
8. **ALB rate:** requests 60 × 15 (900), target 5xx 1 × 15, ELB 5xx empty → `alb_5xx_rate` warning `{ loadBalancer: 'api', rate: 1.6666666666666667, errors: 15, requests: 900 }` (compare `rate` with `toBeCloseTo(1.667, 3)`); target 5xx 4 × 15 (6.67 %) → critical; requests 5 × 15 (75 < 100) with target 5xx 5 × 15 → no rate insight.
9. **ALB absolute:** ELB 5xx `series([...repeat(0, 5), ...repeat(1, 10)])` with empty requests → `alb_elb_5xx_count` warning `{ loadBalancer: 'api', count: 10 }`; 9 → none; `series(repeat(10, 10))` → critical `count: 100`.
10. **Unhealthy hosts:** `unhealthy: series([...repeat(0, 12), 1, 1, 1])` → `alb_unhealthy_hosts` warning `{ loadBalancer: 'api', targetGroup: 'web', count: 1 }`, `resource: 'api/web'`; `series([...repeat(0, 12), 1, 1, 0])` → none.
11. **Alarms:** `[{ name: 'db-cpu', state: 'ALARM', targetTracking: false, … }, { name: 'TargetTracking-x', state: 'ALARM', targetTracking: true, … }, { name: 'ok', state: 'OK', … }]` → one `{ severity: 'critical', kind: 'alarm_firing', resource: 'db-cpu', messageKey: 'messages.alarm_firing', values: { alarm: 'db-cpu' }, href: '/c/abc123def456/eu-west-1/alarms?state=ALARM' }`.
12. **Sorting and formatting:** `sortInsights` puts critical before warning, then kinds alphabetically, then resources; `formatInsightValues('messages.ecs_cpu_high', { service: 'web', value: 91.24, threshold: 85 }, 'en')` → `{ service: 'web', value: '91.2%', threshold: '85%' }`; `formatInsightValues('messages.alb_elb_5xx_count', { loadBalancer: 'api', count: 12 }, 'en')` → unchanged.
13. **Message catalogue coverage:** for every `InsightKind`, `en.Insights.messages[kind]` is a non-empty string; `en.Insights.groups` has the five ECS kinds; `en.Insights.members.aurora_replica_lag` exists (import `messages/en.json`).

Add `'lib/monitoring/evaluate.ts'`, `'lib/monitoring/insights.ts'` to `SERVER_ONLY_MODULES`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/monitoring-evaluate.test.ts tests/unit/monitoring-insights.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`evaluate.ts`:

```ts
import 'server-only';
import type { SeriesData } from './metrics';

export const MIN_CONSECUTIVE = 3;
export type Direction = 'above' | 'below';
export type Level = { threshold: number; clearAt: number };
export type Levels = { warning: Level; critical?: Level };

export function sliceSince(series: SeriesData, sinceMs: number): SeriesData {
  const start = series.timestamps.findIndex((t) => t >= sinceMs);
  if (start === -1) return { timestamps: [], values: [] };
  return { timestamps: series.timestamps.slice(start), values: series.values.slice(start) };
}

export const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
export const average = (values: readonly number[]) => (values.length === 0 ? null : sum(values) / values.length);

/** Hysteresis computed from the series alone: no state is stored between requests. */
export function breachActive(values: readonly number[], level: Level, direction: Direction): boolean {
  const past = (v: number) => (direction === 'above' ? v > level.threshold : v < level.threshold);
  const cleared = (v: number) => (direction === 'above' ? v <= level.clearAt : v >= level.clearAt);
  let active = false;
  let run = 0;
  for (const v of values) {
    if (active) {
      if (cleared(v)) {
        active = false;
        run = 0;
      }
      continue;
    }
    run = past(v) ? run + 1 : 0;
    if (run >= MIN_CONSECUTIVE) active = true;
  }
  return active;
}

export function thresholdLevel(series: SeriesData, levels: Levels, direction: Direction): 'critical' | 'warning' | null {
  const avg = average(series.values);
  if (avg === null) return null;
  const fires = (level: Level) => (direction === 'above' ? avg > level.threshold : avg < level.threshold) && breachActive(series.values, level, direction);
  if (levels.critical && fires(levels.critical)) return 'critical';
  return fires(levels.warning) ? 'warning' : null;
}
```

(`sliceSince` assumes ascending timestamps, which `getMetricSeries` guarantees.)

`insights.ts` — write each rule exactly per "Rule semantics". Key parts:

```ts
export const ECS_UTILIZATION_LEVELS: Levels = { warning: { threshold: 85, clearAt: 80 }, critical: { threshold: 95, clearAt: 90 } };
export const RDS_CPU_LEVELS: Levels = { warning: { threshold: 80, clearAt: 75 }, critical: { threshold: 95, clearAt: 90 } };
export const FREEABLE_MEMORY_LEVELS: Levels = { warning: { threshold: 5, clearAt: 10 } };
export const REPLICA_LAG_LEVELS: Levels = { warning: { threshold: 1000, clearAt: 950 } };
export const ALB_5XX_RATE_LEVELS = { warning: { threshold: 1, clearAt: 0.95 }, critical: { threshold: 5, clearAt: 4.75 } } as const;
export const UNHEALTHY_HOSTS_LEVELS: Levels = { warning: { threshold: 0, clearAt: 0 } };

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
const minutesAgo = (ctx: RuleContext, minutes: number) => ctx.now - minutes * 60_000;
const levelThreshold = (levels: Levels, level: 'critical' | 'warning') => (level === 'critical' ? levels.critical!.threshold : levels.warning.threshold);

function alignedPairs(running: SeriesData, desired: SeriesData, since: number): [number, number][] {
  const wanted = new Map(desired.timestamps.map((t, i) => [t, desired.values[i]]));
  return running.timestamps.flatMap((t, i) => (t >= since && wanted.has(t) ? [[running.values[i], wanted.get(t) as number] as [number, number]] : []));
}

function ecsServiceInsights(cluster: string, s: EcsServiceSignals, ctx: RuleContext): Insight[] {
  const name = s.service.name;
  const href = monitoringPath(ctx.scope, 'containers', cluster, name);
  const out: Insight[] = [];
  const make = (severity: InsightSeverity, kind: InsightKind, values: InsightValues): Insight => ({ severity, kind, resource: name, messageKey: `messages.${kind}`, values: { service: name, ...values }, href });

  const pairs = s.running && s.desired ? alignedPairs(s.running, s.desired, minutesAgo(ctx, TASKS_WINDOW_MINUTES)) : [];
  if (pairs.length >= MIN_CONSECUTIVE) {
    if (pairs.every(([r, d]) => r < d)) {
      const [r, d] = pairs[pairs.length - 1];
      out.push(make('critical', 'ecs_tasks_below_desired', { running: Math.round(r), desired: Math.round(d) }));
    }
  } else {
    const updatedAt = s.service.primaryDeployment?.updatedAt;
    if (s.service.runningCount < s.service.desiredCount && updatedAt != null && updatedAt <= minutesAgo(ctx, TASKS_WINDOW_MINUTES)) {
      out.push(make('critical', 'ecs_tasks_below_desired', { running: s.service.runningCount, desired: s.service.desiredCount }));
    }
  }

  const since = minutesAgo(ctx, INSIGHT_WINDOW_MINUTES);
  for (const [kind, data] of [['ecs_cpu_high', s.cpu], ['ecs_memory_high', s.memory]] as const) {
    const window = sliceSince(data, since);
    const level = thresholdLevel(window, ECS_UTILIZATION_LEVELS, 'above');
    if (level) out.push(make(level, kind, { value: average(window.values) as number, threshold: levelThreshold(ECS_UTILIZATION_LEVELS, level) }));
  }

  const deployment = s.service.primaryDeployment;
  if (deployment?.rolloutState === 'FAILED') out.push(make('critical', 'ecs_rollout_failed', { reason: deployment.rolloutStateReason ?? '' }));
  if (deployment?.rolloutState === 'IN_PROGRESS' && deployment.createdAt != null && deployment.createdAt <= minutesAgo(ctx, ROLLOUT_STUCK_MINUTES)) {
    out.push(make('warning', 'ecs_rollout_stuck', { minutes: Math.floor((ctx.now - deployment.createdAt) / 60_000) }));
  }
  return out;
}

export function ecsInsights(clusters: readonly EcsClusterSignals[], ctx: RuleContext): Insight[] {
  return clusters.flatMap(({ cluster, services }) => {
    const all = services.flatMap((s) => ecsServiceInsights(cluster, s, ctx));
    const byKind = Map.groupBy(all, (i) => i.kind);
    return [...byKind.entries()].flatMap(([kind, list]) => {
      if (list.length < GROUP_MIN_SERVICES) return list;
      const members = list
        .map(({ resource, severity, messageKey, values, href }) => ({ resource, severity, messageKey, values, href }))
        .sort((a, b) => a.resource.localeCompare(b.resource, 'en'));
      const severity = members.some((m) => m.severity === 'critical') ? 'critical' : 'warning';
      return [{ severity, kind, resource: cluster, messageKey: `groups.${kind}`, values: { cluster, count: list.length }, href: monitoringPath(ctx.scope, 'containers'), members }];
    });
  });
}
```

`Map.groupBy` needs ES2024 lib typings; the project's `tsconfig` uses `lib: ["dom", "dom.iterable", "esnext"]`, which includes it, and Node 22 implements it. If typecheck disagrees, replace with a `reduce` into a `Map`.

`rdsInsights`, `albInsights`, `alarmInsights`, `sortInsights`, `formatInsightValues` follow the semantics above with the same `make`/`sliceSince`/`thresholdLevel` pattern; `formatInsightValues` maps each key in `INSIGHT_VALUE_UNITS[messageKey]` whose value is a number through `formatMetricValue(value, unit, locale)` and returns the other values unchanged.

- [ ] **Step 4: Messages** (`Insights` top-level namespace, server-only)

| Key | en | fr |
|---|---|---|
| `Insights.severity.critical` | Critical | Critique |
| `Insights.severity.warning` | Warning | Avertissement |
| `Insights.severity.info` | Information | Information |
| `Insights.messages.ecs_tasks_below_desired` | {service} has run {running} of {desired} tasks for at least 10 minutes. | {service} exécute {running} tâches sur {desired} depuis au moins 10 minutes. |
| `Insights.messages.ecs_cpu_high` | {service} CPU averages {value} over 15 minutes (threshold {threshold}). | Le CPU de {service} est en moyenne à {value} sur 15 minutes (seuil {threshold}). |
| `Insights.messages.ecs_memory_high` | {service} memory averages {value} over 15 minutes (threshold {threshold}). | La mémoire de {service} est en moyenne à {value} sur 15 minutes (seuil {threshold}). |
| `Insights.messages.ecs_rollout_failed` | The last deployment of {service} failed: {reason} | Le dernier déploiement de {service} a échoué : {reason} |
| `Insights.messages.ecs_rollout_stuck` | The deployment of {service} has been in progress for {minutes} minutes. | Le déploiement de {service} est en cours depuis {minutes} minutes. |
| `Insights.messages.rds_cpu_high` | {instance} CPU averages {value} over 15 minutes (threshold {threshold}). | Le CPU de {instance} est en moyenne à {value} sur 15 minutes (seuil {threshold}). |
| `Insights.messages.rds_freeable_memory_low` | {instance} has only {value} of its memory free. | {instance} n'a plus que {value} de mémoire disponible. |
| `Insights.messages.aurora_replica_lag` | {cluster}: {lagging} of {readers} readers {lagging, plural, one {lags} other {lag}} more than 1 s. | {cluster} : {lagging, plural, one {# lecteur sur {readers} a} other {# lecteurs sur {readers} ont}} plus d'1 s de retard. |
| `Insights.messages.alb_5xx_rate` | {loadBalancer} answers {rate} of requests with a 5xx error ({errors} of {requests} in 15 minutes). | {loadBalancer} répond à {rate} des requêtes par une erreur 5xx ({errors} sur {requests} en 15 minutes). |
| `Insights.messages.alb_elb_5xx_count` | {loadBalancer} itself returned {count} 5xx errors in 15 minutes. | {loadBalancer} a lui-même renvoyé {count} erreurs 5xx en 15 minutes. |
| `Insights.messages.alb_unhealthy_hosts` | {targetGroup} on {loadBalancer} has {count, plural, one {# unhealthy host} other {# unhealthy hosts}}. | {targetGroup} sur {loadBalancer} a {count, plural, one {# hôte défaillant} other {# hôtes défaillants}}. |
| `Insights.messages.alarm_firing` | Alarm {alarm} is in ALARM state. | L'alarme {alarm} est à l'état ALARM. |
| `Insights.groups.ecs_tasks_below_desired` | {count} services of {cluster} run fewer tasks than desired. | {count} services de {cluster} exécutent moins de tâches que souhaité. |
| `Insights.groups.ecs_cpu_high` | {count} services of {cluster} have high CPU. | {count} services de {cluster} ont un CPU élevé. |
| `Insights.groups.ecs_memory_high` | {count} services of {cluster} have high memory use. | {count} services de {cluster} ont une utilisation mémoire élevée. |
| `Insights.groups.ecs_rollout_failed` | {count} services of {cluster} have a failed deployment. | {count} services de {cluster} ont un déploiement en échec. |
| `Insights.groups.ecs_rollout_stuck` | {count} services of {cluster} have had a deployment in progress for more than 30 minutes. | {count} services de {cluster} ont un déploiement en cours depuis plus de 30 minutes. |
| `Insights.members.aurora_replica_lag` | {instance} lags {value} on average. | {instance} a en moyenne {value} de retard. |

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/unit/monitoring-evaluate.test.ts tests/unit/monitoring-insights.test.ts tests/unit/i18n-messages.test.ts tests/unit/module-boundaries.test.ts`
Expected: pass.

- [ ] **Step 6: Full verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: clean. E2E gaps touched: ECS cluster grouping, Aurora replica lag grouping, rollout rules, ALB 5xx rules (unit fixtures only).

- [ ] **Step 7: Commit**

```bash
git add src messages tests
git commit -m "feat(monitoring): insight rules with hysteresis and grouping for ECS, RDS, ALB and alarms

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 10: Overview page — health summary cards and insights list

**Files:**
- Create: `src/lib/monitoring/overview.ts`, `src/components/monitoring/insight-list.tsx`, `src/app/[locale]/(app)/c/[connectionId]/[region]/overview/cards.tsx`
- Modify: `src/app/[locale]/(app)/c/[connectionId]/[region]/overview/page.tsx`, `messages/en.json`, `messages/fr.json`, `tests/unit/module-boundaries.test.ts`, `tests/e2e/06-monitoring.spec.ts`
- Test: `tests/unit/monitoring-overview.test.ts`

**Interfaces:**
- Consumes: Task 2 `getMetricSeries`, `seriesById`, `recentWindow`, `MonitoringDeps`, `AwsTarget`, `MonitoringResult`; Task 3 `resolveTarget`, `MonitoringScope`, `monitoringPath`; Task 4 `MonitoringCard`, `SuspenseCard`, `FailureNotice`, `TONE_*`; Task 5 `listAlarms`; Task 6 `listClusters`, `listServices`, `serviceUtilizationQueries`, `serviceTaskCountQueries`; Task 7 `listDatabases`, `rdsMetricQueries`; Task 8 `listLoadBalancers`, `listTargetGroups`, `loadBalancerQueries`, `loadBalancerDimension`, `targetGroupDimension`; Task 9 `ecsInsights`, `rdsInsights`, `albInsights`, `alarmInsights`, `sortInsights`, `formatInsightValues`, `INSIGHT_WINDOW_MINUTES`, `Insight`, `EcsClusterSignals`, `RdsInstanceSignals`, `AlbSignals`.
- Produces (`overview.ts`):
  - `INSIGHT_FAMILIES = ['ecs', 'rds', 'alb', 'alarms'] as const`; `type InsightFamily = (typeof INSIGHT_FAMILIES)[number]`
  - `type FamilySummary = { insights: Insight[]; total: number; affected: number }`
  - `INSIGHT_FETCH_MINUTES = 20` (fetched window; rules slice 15 or 10 minutes)
  - `ecsFamily(target: AwsTarget, nowMs: number, deps?: MonitoringDeps): Promise<MonitoringResult<FamilySummary>>`
  - `rdsFamily(target, nowMs, deps?)`, `albFamily(target, nowMs, deps?)`, `alarmsFamily(target, nowMs, deps?)` — same signature
  - `loadFamily(family: InsightFamily, target: AwsTarget, nowMs: number, deps?: MonitoringDeps): Promise<MonitoringResult<FamilySummary>>`
- Produces (component): `InsightList({ insights }: { insights: readonly Insight[] })` — async server component.

Loader definitions (`window = recentWindow(INSIGHT_FETCH_MINUTES, nowMs)`, `ctx = { scope: { connectionId: target.connectionId, region: target.region }, now: window.end.getTime() }` — never put the credentials in the rule context; any failed call returns its failure):
- `ecsFamily`: `listClusters`; for each cluster `listServices(target, name, '')`; one `getMetricSeries` with, for cluster index `c` and service index `s`, `serviceUtilizationQueries(cluster, service, `c${c}s${s}`)` plus `serviceTaskCountQueries(…)` when the cluster has Container Insights; signals use `seriesById(series, `c${c}s${s}cpu`)` etc. (`running`/`desired` null without Container Insights); `total` = number of services; `affected` = number of distinct services named in ECS insights (a grouped insight counts each member).
- `rdsFamily`: `listDatabases`; queries `rdsMetricQueries(id, ['CPUUtilization', 'FreeableMemory'], `d${n}`)` plus `AuroraReplicaLag` for aurora readers; `total` = instances; `affected` = distinct instances in `rds_cpu_high` insights.
- `albFamily`: `listLoadBalancers` and `listTargetGroups(target, null)`; queries `loadBalancerQueries(lb, `l${n}`)` per load balancer plus, per target group attached to a listed load balancer, `{ id: `g${m}unhealthy`, namespace: 'AWS/ApplicationELB', metricName: 'UnHealthyHostCount', dimensions: { LoadBalancer: loadBalancerDimension(group.loadBalancerArns[0]), TargetGroup: targetGroupDimension(group.arn) }, stat: 'Maximum' }`; `total` = load balancers; `affected` = distinct load balancers in `alb_5xx_rate` or `alb_elb_5xx_count` insights. No p95 query here.
- `alarmsFamily`: `listAlarms`; `total` = alarms not target-tracking; `affected` = those in `ALARM`.

Overview cost note: per refresh, the Overview requests 4 series per ECS service with Container Insights (2 without), 2–3 per database instance, 3 per ALB and 1 per target group; the cache shares them between the summary cards and the insights card.

moto (facts 6, 9): the seed yields the alarm insight for `opswatch-e2e-high-cpu` and nothing for CPU, memory, database or ALB rules (ECS CPU 35–39 %, RDS CPU 20–23 %, ALB target 5xx 0.83 % with no ELB 5xx, no unhealthy host). The seeded datapoints end at the seed minute, so once the suite has run for more than 10 minutes the Container Insights task series leave the 10-minute window and the describe fallback legitimately reports `web` as running 0 of 2 tasks (moto never starts tasks). The e2e test therefore asserts the alarm insight and the absence of the target-tracking alarm, not the total number of insights. Every other rule is unit-tested only.

- [ ] **Step 1: Write the failing test**

`tests/unit/monitoring-overview.test.ts` (mock `ECSClient`, `CloudWatchClient`, `RDSClient`, `ElasticLoadBalancingV2Client`; `deps = { cache: createTtlCache(), log: vi.fn() }`; `NOW = Date.parse('2026-09-17T10:00:30Z')`; `GetMetricDataCommand` answered with `callsFake` that returns, for each query, 20 datapoints ending at 10:00 with a value chosen from the query's `MetricStat.Metric.MetricName` through a table given per test):

1. **ecsFamily:** one cluster `prod` (Container Insights enabled) with service `web` (desired 2, running 2, COMPLETED deployment); metric table `{ CPUUtilization: 96, MemoryUtilization: 40, RunningTaskCount: 2, DesiredTaskCount: 2 }`. Expect `{ ok: true, data: { total: 1, affected: 1, insights: [{ kind: 'ecs_cpu_high', severity: 'critical', resource: 'web', … }] } }`, exactly one `GetMetricDataCommand` call with 4 queries, `Period: 60`, `StartTime` `09:40:00Z`, `EndTime` `10:00:00Z`.
2. **rdsFamily:** one standalone `mysql` `db.t3.medium` instance, CPU 50 and FreeableMemory `3 * 1024 ** 3` → `{ total: 1, affected: 0, insights: [] }`; queries are 2 (`CPUUtilization`, `FreeableMemory`).
3. **albFamily:** load balancer `api` and target group `web` attached to it; table `{ RequestCount: 60, HTTPCode_ELB_5XX_Count: 0, HTTPCode_Target_5XX_Count: 0, UnHealthyHostCount: 1 }` → one `alb_unhealthy_hosts` insight, `affected: 0` (unhealthy hosts do not count as 5xx), `total: 1`; the `UnHealthyHostCount` query has dimensions `{ LoadBalancer: 'app/api/50dc6c495c0c9188', TargetGroup: 'targetgroup/web/73e2d6bc24d8a067' }` and stat `Maximum`.
4. **alarmsFamily:** alarms `db-cpu` (ALARM), `TargetTracking-x` (ALARM), `ok` (OK) → `{ total: 2, affected: 1, insights: [alarm_firing db-cpu] }`.
5. **failures propagate:** `DescribeAlarms` rejects `AccessDenied` → `alarmsFamily` returns `{ ok: false, reason: 'denied', code: 'AccessDenied', action: 'cloudwatch:DescribeAlarms' }`; `loadFamily('alarms', …)` returns the same.

Add `'lib/monitoring/overview.ts'` to `SERVER_ONLY_MODULES`.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/monitoring-overview.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `overview.ts`** as defined above (server-only; each loader uses `recentWindow(INSIGHT_FETCH_MINUTES, nowMs)` so all cards in one minute share cache keys).

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/unit/monitoring-overview.test.ts tests/unit/module-boundaries.test.ts`
Expected: pass.

- [ ] **Step 5: Cards and page**

`overview/page.tsx` — after the header add:

```tsx
<section aria-label={t('summary.label')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
  {INSIGHT_FAMILIES.map((family) => (
    <SuspenseCard key={family} title={t(`summary.${family}.title`)} variant="stat">
      <SummaryCard scope={context.scope} family={family} />
    </SuspenseCard>
  ))}
</section>
<SuspenseCard title={t('insights.title')} variant="table" rows={4}>
  <InsightsCard scope={context.scope} />
</SuspenseCard>
```

`overview/cards.tsx`:
- `SummaryCard({ scope, family })`: `resolveTarget` → `loadFamily(family, target, Date.now())`; failure → `MonitoringCard` + `FailureNotice`; else `MonitoringCard` with `title={t(`summary.${family}.title`)}`, `description={t('summary.window')}`, `className` border from the worst insight severity (`critical` → `TONE_BORDER.danger`, `warning` → `TONE_BORDER.warning`); content: `<p className="text-2xl font-semibold">{t(`summary.${family}.value`, { affected, total })}</p>` and a `Link` `t('summary.open')` to `monitoringPath(scope, SECTION[family])` where `SECTION = { ecs: 'containers', rds: 'databases', alb: 'load-balancers', alarms: 'alarms' }`.
- `InsightsCard({ scope })`: `resolveTarget` (failure → notice); `results = await Promise.all(INSIGHT_FAMILIES.map((f) => loadFamily(f, target, Date.now())))`; `insights = sortInsights(results.flatMap((r) => (r.ok ? r.data.insights : [])))`; `unavailable` = families whose result failed, rendered as `t('insights.unavailable', { families: format.list(unavailable.map((f) => tNav(NAV_KEY[f])), { type: 'conjunction' }) })` with `NAV_KEY = { ecs: 'containers', rds: 'databases', alb: 'loadBalancers', alarms: 'alarms' }` (`tNav = getTranslations('Common.nav')`); the card description is `t('insights.description')`; no insight and no failure → `t('insights.none')`; else `<InsightList insights={insights} />`.

`src/components/monitoring/insight-list.tsx` (async server; `getTranslations('Insights')`, `getTranslations('Monitoring.overview.insights')`, `getLocale()`):
- `<ul aria-label={tList('listLabel')} className="divide-y">`, one `<li className="flex items-start gap-3 py-3">` per insight: icon `OctagonAlert` (`TONE_TEXT.danger`) for critical, `TriangleAlert` (`TONE_TEXT.warning`) for warning, `Info` (`text-muted-foreground`) for info, each `aria-hidden`, followed by `<span className="sr-only">{t(`severity.${severity}`)}: </span>`; the text `t(insight.messageKey, formatInsightValues(insight.messageKey, insight.values, locale))`; a `Link` `tList('view')` to `insight.href`.
- When `members` exist: `<details className="mt-1"><summary className="cursor-pointer text-sm text-muted-foreground">{tList('showMembers', { count: members.length })}</summary><ul className="mt-2 space-y-1 text-sm">` with each member's `t(member.messageKey, formatInsightValues(member.messageKey, member.values, locale))` linked to `member.href`.

- [ ] **Step 6: Messages**

| Key | en | fr |
|---|---|---|
| `Monitoring.overview.summary.label` | Health summary | Synthèse de santé |
| `Monitoring.overview.summary.window` | Last 15 minutes | 15 dernières minutes |
| `Monitoring.overview.summary.open` | Open | Ouvrir |
| `Monitoring.overview.summary.ecs.title` | Containers | Conteneurs |
| `Monitoring.overview.summary.ecs.value` | {affected} of {total} services degraded | {affected} services dégradés sur {total} |
| `Monitoring.overview.summary.rds.title` | Databases | Bases de données |
| `Monitoring.overview.summary.rds.value` | {affected} of {total} instances hot | {affected} instances surchargées sur {total} |
| `Monitoring.overview.summary.alb.title` | Load balancers | Répartiteurs de charge |
| `Monitoring.overview.summary.alb.value` | {affected} of {total} with 5xx errors | {affected} sur {total} avec des erreurs 5xx |
| `Monitoring.overview.summary.alarms.title` | Alarms | Alarmes |
| `Monitoring.overview.summary.alarms.value` | {affected} of {total} alarms firing | {affected} alarmes déclenchées sur {total} |
| `Monitoring.overview.insights.title` | Insights | Analyses |
| `Monitoring.overview.insights.description` | Automatic checks on the last 15 minutes. Target-tracking alarms are left out. | Vérifications automatiques sur les 15 dernières minutes. Les alarmes de suivi de cible sont ignorées. |
| `Monitoring.overview.insights.listLabel` | Insights | Analyses |
| `Monitoring.overview.insights.none` | Nothing to report: every check passes. | Rien à signaler : toutes les vérifications passent. |
| `Monitoring.overview.insights.unavailable` | Some checks could not run: {families}. | Certaines vérifications n'ont pas pu s'exécuter : {families}. |
| `Monitoring.overview.insights.view` | View | Voir |
| `Monitoring.overview.insights.showMembers` | {count, plural, one {Show # resource} other {Show # resources}} | {count, plural, one {Afficher # ressource} other {Afficher # ressources}} |

- [ ] **Step 7: E2E test**

```ts
test('the overview shows the seeded alarm insight and leaves target-tracking alarms out', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview'));
  const insights = page.getByRole('list', { name: 'Insights' });
  const alarm = insights.getByRole('listitem').filter({ hasText: 'Alarm opswatch-e2e-high-cpu is in ALARM state.' });
  await expect(alarm).toHaveCount(1);
  await expect(insights).not.toContainText('TargetTracking-');
  await expect(page.getByText('1 of 2 alarms firing')).toBeVisible();
  await expect(page.getByText(/of 1 services degraded/)).toBeVisible();
  await alarm.getByRole('link', { name: 'View' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${connectionId}/us-east-1/alarms\\?state=ALARM$`));
});```

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`, then the e2e stack.
Expected: all pass (`46 passed` e2e). E2E gaps touched: every non-alarm insight rule, grouping, denied families.

- [ ] **Step 9: Commit**

```bash
git add src messages tests
git commit -m "feat(monitoring): overview with health summary cards and automatic insights

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Phase A documentation, cost model and billed action flag

**Files:**
- Modify: `src/lib/aws/actions.ts`, `tests/unit/aws-actions.test.ts`, `src/components/getting-started/service-cards.tsx`, `src/app/[locale]/getting-started/page.tsx`, `messages/en.json`, `messages/fr.json`, `README.md`, `README.fr.md`, `tests/e2e/02-getting-started.spec.ts`
- Create: `src/components/getting-started/pages-section.tsx`

**Interfaces:**
- Consumes: `SERVICE_GROUPS`, `TEMPLATE_VERSION` (`src/lib/aws/actions.ts`); `getTranslations`; the `Section` helper of `src/app/[locale]/getting-started/page.tsx`.
- Produces: `SERVICE_GROUPS` entry `cloudwatch` with `billedActions: ['cloudwatch:GetMetricData']`; `PagesSection()` async server component.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/aws-actions.test.ts` replace `it('flags logs:StartQuery as billed', …)` with:

```ts
it('flags the billed actions without changing the template version', () => {
  expect(SERVICE_GROUPS.filter((g) => g.billedActions.length > 0).map((g) => [g.id, g.billedActions])).toEqual([
    ['cloudwatch', ['cloudwatch:GetMetricData']],
    ['logs', ['logs:StartQuery']],
  ]);
  expect(TEMPLATE_VERSION).toBe(1);
  for (const group of SERVICE_GROUPS) {
    for (const action of group.billedActions) expect(group.actions).toContain(action);
  }
});
```

(import `TEMPLATE_VERSION`; the existing "37 read-only actions" test proves the action list is unchanged.)

In `tests/e2e/02-getting-started.spec.ts` add:

```ts
test('the guide lists the monitoring pages and the billed CloudWatch action', async ({ page }) => {
  await page.goto('/en/getting-started');
  await expect(page.getByRole('heading', { level: 2, name: 'What OpsWatch shows' })).toBeVisible();
  await expect(page.getByText('cloudwatch:GetMetricData is billed by AWS per metric requested', { exact: false })).toBeVisible();
});
```

- [ ] **Step 2: Run to see failures**

Run: `npx vitest run tests/unit/aws-actions.test.ts`
Expected: FAIL — `cloudwatch` has no billed action.

- [ ] **Step 3: Implement**

- `src/lib/aws/actions.ts`: `cloudwatch` group `billedActions: ['cloudwatch:GetMetricData']`. `TEMPLATE_VERSION` stays 1 (billed flags are not part of the policy).
- `src/components/getting-started/service-cards.tsx`: the billed note becomes `t(`billed.${group.id}`, { action })`.
- Messages: `GettingStarted.serviceCards.billed` becomes an object:

| Key | en | fr |
|---|---|---|
| `GettingStarted.serviceCards.billed.logs` | {action} is billed by AWS per GB of logs scanned. | {action} est facturée par AWS au Go de journaux analysé. |
| `GettingStarted.serviceCards.billed.cloudwatch` | {action} is billed by AWS per metric requested (about USD 0.01 per 1,000 metrics). | {action} est facturée par AWS par métrique demandée (environ 0,01 USD pour 1 000 métriques). |
| `GettingStarted.pages.title` | What OpsWatch shows | Ce qu'OpsWatch affiche |
| `GettingStarted.pages.intro` | Once a connection passes its permission test, pick it in the top bar, then a region, to open these pages. | Dès qu'une connexion réussit son test des permissions, choisissez-la dans la barre du haut puis choisissez une région pour ouvrir ces pages. |
| `GettingStarted.pages.items.overview` | Overview: health summary and automatic insights on the last 15 minutes (tasks below desired, high CPU or memory, failed deployments, database CPU and memory, Aurora replica lag, load balancer 5xx errors and unhealthy hosts, alarms firing). | Vue d'ensemble : synthèse de santé et analyses automatiques sur les 15 dernières minutes (tâches manquantes, CPU ou mémoire élevés, déploiements en échec, CPU et mémoire des bases, retard de réplication Aurora, erreurs 5xx et hôtes défaillants des répartiteurs, alarmes déclenchées). |
| `GettingStarted.pages.items.containers` | Containers: ECS services with tasks, CPU and memory, then per service its charts, tasks, events, target groups and log groups. | Conteneurs : services ECS avec tâches, CPU et mémoire, puis pour chaque service ses graphiques, tâches, événements, groupes cibles et groupes de journaux. |
| `GettingStarted.pages.items.databases` | Databases: RDS and Aurora instances with their role, metrics and, when Performance Insights is on, the top SQL statements. | Bases de données : instances RDS et Aurora avec leur rôle, leurs métriques et, si Performance Insights est activé, les requêtes SQL les plus coûteuses. |
| `GettingStarted.pages.items.loadBalancers` | Load balancers: requests, 5xx errors, p95 response time and target health of each application load balancer. | Répartiteurs de charge : requêtes, erreurs 5xx, temps de réponse p95 et santé des cibles de chaque Application Load Balancer. |
| `GettingStarted.pages.items.alarms` | Alarms: CloudWatch alarms by state, with target-tracking autoscaling alarms hidden by default. | Alarmes : alarmes CloudWatch par état, les alarmes de suivi de cible de l'autoscaling étant masquées par défaut. |
| `GettingStarted.pages.refresh` | Charts cover 1 hour to 7 days and refresh every 2 minutes while the tab is visible; you can pause the refresh. | Les graphiques couvrent de 1 heure à 7 jours et s'actualisent toutes les 2 minutes tant que l'onglet est visible ; vous pouvez suspendre l'actualisation. |

- `pages-section.tsx`: `getTranslations('GettingStarted.pages')`; `<ul className="list-disc space-y-2 pl-5">` over `['overview', 'containers', 'databases', 'loadBalancers', 'alarms']` rendering `t(`items.${key}`)`, then `<p className="text-sm text-muted-foreground">{t('refresh')}</p>`.
- `getting-started/page.tsx`: add `<Section id="pages" title={t('pages.title')} intro={t('pages.intro')}><PagesSection /></Section>` right after the `services` section.
- README.md, section `## Status`: replace the table with

```markdown
| Stage | Content | Status |
|-------|---------|--------|
| 1 | Admin account, AWS connections, permission test, getting started guide (English and French) | Available |
| 2 | Live monitoring: Overview with automatic insights, Containers (ECS), Databases (RDS, Aurora, Performance Insights), Load balancers (ALB), Alarms | Available |
| 3 | History storage and on-demand snapshots | Planned |
| 4 | Notifications | Planned |
| 5 | More AWS services (SQS, Lambda, EC2/EBS) and a multi-account overview | Planned |
```

and change "This release covers the foundations:" to "This release covers the foundations and live monitoring:". Add after `## Connecting AWS` a section:

```markdown
## Monitoring pages

Pick a connection in the top bar, then a region. Every page reads AWS live; nothing is stored.

- **Overview**: health summary and automatic insights on the last 15 minutes (tasks below desired, CPU or memory above 85 %, failed or stuck deployments, database CPU above 80 %, free memory below 5 %, Aurora replica lag above 1 s, load balancer 5xx errors, unhealthy hosts, alarms in ALARM state). A threshold must hold for 3 consecutive minutes to raise an insight.
- **Containers**: ECS clusters and services (up to 100 per cluster, with search), then per service CPU and memory charts, running tasks, recent events, target groups and log groups.
- **Databases**: RDS and Aurora instances with role, CPU, connections, free memory and replica lag; per instance charts and Performance Insights top SQL.
- **Load balancers**: application load balancers with requests, 5xx errors, p95 response time and target health.
- **Alarms**: CloudWatch alarms by state; target-tracking autoscaling alarms are hidden by default.

Charts cover 1 hour to 7 days (`?range=`) and refresh every 2 minutes while the tab is visible; the refresh can be paused. When a permission is missing, the card says which IAM action and links to the permission test; the rest of the page still loads.

### What monitoring costs

`cloudwatch:GetMetricData` is billed per metric requested: about USD 0.01 per 1,000 metrics (see CloudWatch pricing for your region). OpsWatch requests one metric per series it shows, caches results for 60 seconds so viewers and cards share them, and refreshes only visible tabs. A Containers page with 30 services refreshing every 2 minutes for 8 hours is roughly 30,000 metrics, about USD 0.30. Describe calls to ECS, RDS and Elastic Load Balancing are not billed.
```

- README.fr.md: same changes in French — table rows `| 2 | Supervision en direct : vue d'ensemble avec analyses automatiques, conteneurs (ECS), bases de données (RDS, Aurora, Performance Insights), répartiteurs de charge (ALB), alarmes | Disponible |`, `| 3 | Stockage de l'historique et sauvegardes à la demande | Prévu |`, `| 4 | Notifications | Prévu |`, `| 5 | Autres services AWS (SQS, Lambda, EC2/EBS) et vue multi-comptes | Prévu |`; intro "Cette version couvre les fondations et la supervision en direct :"; section `## Pages de supervision` and `### Ce que coûte la supervision` translating the English text above sentence by sentence (keep IAM action names, `?range=`, numbers; write "environ 0,01 USD pour 1 000 métriques", "environ 30 000 métriques, soit environ 0,30 USD").

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`, then the e2e stack.
Expected: all pass (`47 passed` e2e).

- [ ] **Step 5: Commit**

```bash
git add src messages tests README.md README.fr.md
git commit -m "docs: monitoring pages, cost model and billed GetMetricData flag

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**Phase A checkpoint:** stop here for the Phase A review. Phase B starts only after it is clean.

---
## Phase B

### Task 12: Logs Insights data module and region-bound query routes

**Files:**
- Create: `src/lib/monitoring/logs.ts`, `src/lib/monitoring/query-bindings.ts`, `src/lib/monitoring/logs-route.ts`
- Create: `src/app/api/connections/[id]/regions/[region]/logs/query/route.ts`, `src/app/api/connections/[id]/regions/[region]/logs/query/[queryId]/route.ts`
- Modify: `src/lib/auth/current.ts`, `src/lib/http/api-error.ts`, `tests/unit/module-boundaries.test.ts`
- Test: `tests/unit/monitoring-logs.test.ts`, `tests/unit/query-bindings.test.ts`, `tests/unit/logs-routes.test.ts`; create `tests/e2e/07-logs.spec.ts`

**Interfaces:**
- Consumes: Task 2 `runCall`, `describeCall`, `describeTimeout`, `AwsTarget`, `MonitoringDeps`, `MonitoringResult`, `MonitoringFailure`, `MonitoringScope`; Task 3 `checkSelection`, `resolveTarget`; `findConnection`, `getDb`, `env`, `isSameOrigin`, `apiError`, `ApiErrorCode`; `cookies` (`next/headers`), `validateSession`, `hashToken` (`src/lib/crypto.ts`); `zod`; `@aws-sdk/client-cloudwatch-logs`.
- Produces:
  - `src/lib/auth/current.ts`: `getCurrentSession(): Promise<{ adminId: number; sessionId: string } | null>` (`sessionId` = `hashToken(token, secret)`, the stored session id, never the token); `getCurrentAdminId` reimplemented as `(await getCurrentSession())?.adminId ?? null`
  - `src/lib/http/api-error.ts`: `ApiErrorCode` gains `'invalid_query' | 'range_too_long' | 'connection_unusable' | 'aws_denied' | 'aws_throttled' | 'aws_error'` with statuses 400, 400, 409, 403, 429, 502
  - `logs.ts`: `LOGS_MAX_RANGE_SECONDS = 86_400`; `LOGS_MAX_ROWS = 1000`; `LOGS_MAX_GROUPS = 20`; `LOGS_MAX_QUERY_LENGTH = 10_000`; `LOG_GROUP_SEARCH_LIMIT = 50`; `type LogGroup = { name: string; storedBytes: number | null; retentionDays: number | null }`; `searchLogGroups(target, prefix: string, deps?): Promise<MonitoringResult<LogGroup[]>>`; `type LogsQueryInput = { logGroups: string[]; query: string; startSeconds: number; endSeconds: number }`; `parseLogsQueryInput(body: unknown, nowMs: number): { ok: true; value: LogsQueryInput } | { ok: false; error: 'invalid_query' | 'range_too_long' }`; `startLogsQuery(target, input: LogsQueryInput, deps?): Promise<MonitoringResult<{ queryId: string }>>`; `type QueryStatus = 'Scheduled' | 'Running' | 'Complete' | 'Failed' | 'Cancelled' | 'Timeout' | 'Unknown'`; `type LogsQueryResults = { status: QueryStatus; fields: string[]; rows: Record<string, string>[]; statistics: { recordsMatched: number; recordsScanned: number; bytesScanned: number } }`; `getLogsQueryResults(target, queryId: string, deps?): Promise<MonitoringResult<LogsQueryResults>>`; `stopLogsQuery(target, queryId: string, deps?): Promise<MonitoringResult<boolean>>`
  - `query-bindings.ts`: `QUERY_BINDING_TTL_MS = 600_000`; `MAX_QUERY_BINDINGS = 1000`; `type QueryBinding = { connectionId: string; region: string; sessionId: string }`; `type QueryBindings = { bind(queryId: string, binding: QueryBinding): void; matches(queryId: string, binding: QueryBinding): boolean; forget(queryId: string): void }`; `createQueryBindings(options?: { now?: () => number; ttlMs?: number; maxEntries?: number }): QueryBindings`; `queryBindings: QueryBindings`
  - `logs-route.ts`: `type LogsRouteParams = { id: string; region: string }`; `authorizeLogsRoute(request: Request, params: LogsRouteParams, options: { mutating: boolean }): Promise<{ ok: true; sessionId: string; scope: MonitoringScope } | { ok: false; response: Response }>`; `failureResponse(failure: MonitoringFailure): Response` (body `{ error, action, code }`)
  - Routes: `POST /api/connections/:id/regions/:region/logs/query` → 200 `{ queryId }`; `GET /api/connections/:id/regions/:region/logs/query/:queryId` → 200 `LogsQueryResults`; `DELETE` same path → 204

moto limits (fact 10): `StartQuery`/`GetQueryResults` work (results immediately `Complete`, filters ignored); `StopQuery` is not implemented, so the DELETE route ignores stop failures and e2e never asserts a stop round-trip; `GetQueryResults` with an unknown id errors, which the binding check prevents from ever being called.

- [ ] **Step 1: Write the failing tests**

`tests/unit/query-bindings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createQueryBindings } from '@/lib/monitoring/query-bindings';

const binding = { connectionId: 'abc123def456', region: 'eu-west-1', sessionId: 'session-a' };

describe('query bindings', () => {
  it('match only the same connection, region and session within 10 minutes', () => {
    let t = 0;
    const bindings = createQueryBindings({ now: () => t });
    bindings.bind('q1', binding);
    expect(bindings.matches('q1', binding)).toBe(true);
    expect(bindings.matches('q1', { ...binding, sessionId: 'session-b' })).toBe(false);
    expect(bindings.matches('q1', { ...binding, region: 'us-east-1' })).toBe(false);
    expect(bindings.matches('q1', { ...binding, connectionId: 'def456abc123' })).toBe(false);
    expect(bindings.matches('q2', binding)).toBe(false);
    t = 599_999;
    expect(bindings.matches('q1', binding)).toBe(true);
    t = 600_000;
    expect(bindings.matches('q1', binding)).toBe(false);
  });

  it('forgets on request and stays bounded', () => {
    const bindings = createQueryBindings({ maxEntries: 2 });
    bindings.bind('a', binding);
    bindings.bind('b', binding);
    bindings.bind('c', binding);
    expect(bindings.matches('a', binding)).toBe(false);
    expect(bindings.matches('c', binding)).toBe(true);
    bindings.forget('c');
    expect(bindings.matches('c', binding)).toBe(false);
  });
});
```

`tests/unit/monitoring-logs.test.ts` (mock `CloudWatchLogsClient`, `NOW = Date.parse('2026-09-17T10:00:00Z')`):

1. **parseLogsQueryInput.** Valid `{ logGroups: ['/ecs/web'], query: 'fields @message', startSeconds: NOW / 1000 - 3600, endSeconds: NOW / 1000 }` → `ok` with the same value (query trimmed). `invalid_query` for: `null`; `logGroups: []`; 21 groups; a group of 513 characters; `query: '  '`; a query of 10,001 characters; non-integer seconds; `endSeconds <= startSeconds`; `endSeconds > NOW / 1000 + 300`. `range_too_long` for `endSeconds - startSeconds = 86_401`; exactly 86,400 is accepted.
2. **searchLogGroups.** Input `{ logGroupNamePrefix: '/ecs', limit: 50 }`; an empty prefix sends `{ limit: 50 }`; maps `{ logGroupName: '/ecs/web', storedBytes: 1024, retentionInDays: 30 }` → `{ name: '/ecs/web', storedBytes: 1024, retentionDays: 30 }`; cached 60 s (second identical call makes no request).
3. **startLogsQuery.** Input `{ logGroupNames: ['/ecs/web'], queryString: 'fields @message', startTime: 1789639200, endTime: 1789642800, limit: 1000 }` → `{ ok: true, data: { queryId: 'q-1' } }`; not cached (two calls → two requests); `LimitExceededException` → `{ ok: false, reason: 'throttled', code: 'LimitExceededException', action: 'logs:StartQuery' }`; a response without `queryId` → `{ ok: false, reason: 'error', code: 'MissingQueryId', action: 'logs:StartQuery' }`.
4. **getLogsQueryResults.** Response `{ status: 'Complete', results: [[{ field: '@timestamp', value: '2026-09-17 09:59:00.000' }, { field: '@message', value: 'ERROR boom' }, { field: '@ptr', value: 'abc' }], [{ field: '@message', value: 'ok' }, { field: 'duration', value: '12' }]], statistics: { recordsMatched: 2, recordsScanned: 10, bytesScanned: 2048 } }` → `{ status: 'Complete', fields: ['@timestamp', '@message', 'duration'], rows: [{ '@timestamp': '2026-09-17 09:59:00.000', '@message': 'ERROR boom' }, { '@message': 'ok', duration: '12' }], statistics: { recordsMatched: 2, recordsScanned: 10, bytesScanned: 2048 } }`; status `'Weird'` → `'Unknown'`; 1,500 result rows → 1,000 rows; not cached.
5. **stopLogsQuery.** `{ success: true }` → `{ ok: true, data: true }`; rejection `SyntaxError` (moto) → `{ ok: false, reason: 'error', code: 'SyntaxError', action: 'logs:StopQuery' }`.

`tests/unit/logs-routes.test.ts` (style of `tests/unit/template-route.test.ts`):

```ts
const state = vi.hoisted(() => ({
  db: undefined as unknown as Db,
  session: { adminId: 1, sessionId: 'session-a' } as { adminId: number; sessionId: string } | null,
}));
vi.mock('@/lib/auth/current', () => ({ getCurrentSession: async () => state.session }));
vi.mock('@/lib/db/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/db/client')>()), getDb: () => state.db }));
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: 'k'.repeat(32), OPSWATCH_PUBLIC_URL: 'http://localhost:3000' }) }));
vi.mock('@/lib/monitoring/target', () => ({
  resolveTarget: vi.fn(async (scope: object) => ({ ok: true, data: { ...scope, credentials: { accessKeyId: 'A', secretAccessKey: 'S' } } })),
}));
vi.mock('@/lib/monitoring/logs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/monitoring/logs')>()),
  startLogsQuery: vi.fn(async () => ({ ok: true, data: { queryId: 'q-1' } })),
  getLogsQueryResults: vi.fn(async () => ({ ok: true, data: { status: 'Running', fields: [], rows: [], statistics: { recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 } } })),
  stopLogsQuery: vi.fn(async () => ({ ok: false, reason: 'error', code: 'SyntaxError', action: 'logs:StopQuery' })),
}));

const { POST } = await import('@/app/api/connections/[id]/regions/[region]/logs/query/route');
const { GET, DELETE } = await import('@/app/api/connections/[id]/regions/[region]/logs/query/[queryId]/route');
const logs = await import('@/lib/monitoring/logs');
const { queryBindings } = await import('@/lib/monitoring/query-bindings');

const ORIGIN = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
const nowSeconds = () => Math.floor(Date.now() / 1000);
const body = (overrides = {}) => JSON.stringify({ logGroups: ['/ecs/web'], query: 'fields @message', startSeconds: nowSeconds() - 3600, endSeconds: nowSeconds(), ...overrides });
const url = (id: string, region: string, queryId?: string) => `http://localhost:3000/api/connections/${id}/regions/${region}/logs/query${queryId ? `/${queryId}` : ''}`;
const post = (id: string, region: string, init: { headers?: Record<string, string>; body?: string } = {}) =>
  POST(new Request(url(id, region), { method: 'POST', headers: init.headers ?? ORIGIN, body: init.body ?? body() }), { params: Promise.resolve({ id, region }) });
const get = (id: string, region: string, queryId: string) => GET(new Request(url(id, region, queryId)), { params: Promise.resolve({ id, region, queryId }) });
const del = (id: string, region: string, queryId: string, headers: Record<string, string> = ORIGIN) =>
  DELETE(new Request(url(id, region, queryId), { method: 'DELETE', headers }), { params: Promise.resolve({ id, region, queryId }) });
```

`beforeEach`: fresh `createTestDb()`, `state.session = { adminId: 1, sessionId: 'session-a' }`, `vi.clearAllMocks()`, and an `ok` role connection `usable` (`createReadyRoleConnection` + `saveTestResult` overall `ok`, regions `['eu-west-1']`). Cases:

1. POST with `origin: 'https://evil.example'` → 403 `{ error: 'forbidden_origin' }` and `startLogsQuery` not called; POST without an `origin` header → 403.
2. POST with `state.session = null` → 401 `{ error: 'unauthorized' }`.
3. POST for `000000000000` → 404; for `usable.id` in `us-east-1` → 404; for a pending connection → 409 `{ error: 'connection_unusable' }`.
4. POST with `body: 'not json'` → 400 `invalid_query`; with a 25-hour range → 400 `range_too_long`.
5. POST ok → 200 `{ queryId: 'q-1' }`; `startLogsQuery` called with `({ connectionId: usable.id, region: 'eu-west-1', credentials }, { logGroups: ['/ecs/web'], query: 'fields @message', startSeconds, endSeconds })`; `queryBindings.matches('q-1', { connectionId: usable.id, region: 'eu-west-1', sessionId: 'session-a' })` is true.
6. POST where `startLogsQuery` resolves `{ ok: false, reason: 'denied', code: 'AccessDeniedException', action: 'logs:StartQuery' }` → 403 `{ error: 'aws_denied', action: 'logs:StartQuery', code: 'AccessDeniedException' }`; `throttled` → 429 `aws_throttled`; `error` → 502 `aws_error`.
7. GET after a successful POST → 200 with the results; GET with another session (`state.session = { adminId: 1, sessionId: 'session-b' }`) → 404 and `getLogsQueryResults` not called; GET for region `eu-west-3` on a connection with regions `['eu-west-1', 'eu-west-3']` whose query was bound to `eu-west-1` → 404; GET for an unbound `q-unknown` → 404; GET after `vi.setSystemTime(Date.now() + 600_000)` (use `vi.useFakeTimers({ toFake: ['Date'] })`) → 404; GET signed out → 401.
8. DELETE with a foreign origin → 403; DELETE bound → 204 with an empty body, `stopLogsQuery` called, and the binding forgotten (a following GET → 404) even though `stopLogsQuery` failed; DELETE unbound → 404.

Add `'lib/monitoring/logs.ts'`, `'lib/monitoring/query-bindings.ts'`, `'lib/monitoring/logs-route.ts'` to `SERVER_ONLY_MODULES`.

- [ ] **Step 2: Run to see failures**

Run: `npx vitest run tests/unit/query-bindings.test.ts tests/unit/monitoring-logs.test.ts tests/unit/logs-routes.test.ts`
Expected: FAIL — modules and routes missing.

- [ ] **Step 3: Implement**

`src/lib/auth/current.ts`:

```ts
export async function getCurrentSession(): Promise<{ adminId: number; sessionId: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { OPSWATCH_SECRET } = env();
  const adminId = validateSession(getDb(), token, OPSWATCH_SECRET);
  // The stored session id (an HMAC of the token), so the token itself is never kept in memory maps.
  return adminId === null ? null : { adminId, sessionId: hashToken(token, OPSWATCH_SECRET) };
}

export async function getCurrentAdminId(): Promise<number | null> {
  return (await getCurrentSession())?.adminId ?? null;
}
```

`query-bindings.ts`:

```ts
import 'server-only';

export const QUERY_BINDING_TTL_MS = 10 * 60_000;
export const MAX_QUERY_BINDINGS = 1000;
export type QueryBinding = { connectionId: string; region: string; sessionId: string };
export type QueryBindings = { bind(queryId: string, binding: QueryBinding): void; matches(queryId: string, binding: QueryBinding): boolean; forget(queryId: string): void };

export function createQueryBindings({ now = Date.now, ttlMs = QUERY_BINDING_TTL_MS, maxEntries = MAX_QUERY_BINDINGS } = {}): QueryBindings {
  const entries = new Map<string, QueryBinding & { expiresAt: number }>();
  return {
    bind(queryId, binding) {
      const t = now();
      for (const [id, entry] of entries) if (entry.expiresAt <= t) entries.delete(id);
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
      entries.set(queryId, { ...binding, expiresAt: t + ttlMs });
    },
    matches(queryId, binding) {
      const entry = entries.get(queryId);
      return (
        entry !== undefined &&
        entry.expiresAt > now() &&
        entry.connectionId === binding.connectionId &&
        entry.region === binding.region &&
        entry.sessionId === binding.sessionId
      );
    },
    forget(queryId) {
      entries.delete(queryId);
    },
  };
}

/** Per process: a query started on one OpsWatch instance can only be polled on that instance. */
export const queryBindings = createQueryBindings();
```

(`now` defaults to `Date.now` read at call time, so `vi.setSystemTime` applies.)

`logs.ts` key parts:

```ts
const inputSchema = z.object({
  logGroups: z.array(z.string().min(1).max(512)).min(1).max(LOGS_MAX_GROUPS),
  query: z.string().trim().min(1).max(LOGS_MAX_QUERY_LENGTH),
  startSeconds: z.number().int(),
  endSeconds: z.number().int(),
});

export function parseLogsQueryInput(body: unknown, nowMs: number) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, error: 'invalid_query' as const };
  const { startSeconds, endSeconds } = parsed.data;
  if (endSeconds <= startSeconds || endSeconds > Math.floor(nowMs / 1000) + 300) return { ok: false as const, error: 'invalid_query' as const };
  if (endSeconds - startSeconds > LOGS_MAX_RANGE_SECONDS) return { ok: false as const, error: 'range_too_long' as const };
  return { ok: true as const, value: parsed.data };
}

export function startLogsQuery(target: AwsTarget, input: LogsQueryInput, deps: MonitoringDeps = {}): Promise<MonitoringResult<{ queryId: string }>> {
  // Never cached, and never logged with its query text.
  return runCall(target, 'logs:StartQuery', async () => {
    const client = new CloudWatchLogsClient(clientConfig(target.region, target.credentials));
    const out = await sendWithTimeout(
      client,
      new StartQueryCommand({ logGroupNames: input.logGroups, queryString: input.query, startTime: input.startSeconds, endTime: input.endSeconds, limit: LOGS_MAX_ROWS }),
      describeTimeout(deps),
    );
    if (!out.queryId) throw Object.assign(new Error('StartQuery returned no query id'), { name: 'MissingQueryId' });
    return { queryId: out.queryId };
  }, deps);
}
```

`getLogsQueryResults` (`runCall 'logs:GetQueryResults'`): `status` through `isOneOf(QUERY_STATUSES, out.status)` else `'Unknown'`; for each result row build a record skipping field `@ptr`; `fields` in first-appearance order; `rows.slice(0, LOGS_MAX_ROWS)`; statistics default 0. `stopLogsQuery` (`runCall 'logs:StopQuery'`) returns `out.success ?? false`. `searchLogGroups` uses `describeCall 'logs:DescribeLogGroups' { prefix }` with `DescribeLogGroupsCommand({ ...(prefix ? { logGroupNamePrefix: prefix } : {}), limit: LOG_GROUP_SEARCH_LIMIT })`.

`logs-route.ts`:

```ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '../auth/current';
import { findConnection } from '../connections/repository';
import { getDb } from '../db/client';
import { env } from '../env';
import { apiError } from '../http/api-error';
import { isSameOrigin } from '../http/origin';
import type { MonitoringScope } from './call';
import type { MonitoringFailure } from './result';
import { checkSelection } from './selection';

export type LogsRouteParams = { id: string; region: string };

/** Origin (mutating methods), then session, then connection and region: nothing touches AWS before all three pass. */
export async function authorizeLogsRoute(request: Request, params: LogsRouteParams, options: { mutating: boolean }) {
  if (options.mutating && !isSameOrigin(request, env().OPSWATCH_PUBLIC_URL)) return { ok: false as const, response: apiError('forbidden_origin') };
  const session = await getCurrentSession();
  if (!session) return { ok: false as const, response: apiError('unauthorized') };
  const check = checkSelection(findConnection(getDb(), params.id), params.region);
  if (check.kind === 'not_found') return { ok: false as const, response: apiError('not_found') };
  if (check.kind === 'unusable') return { ok: false as const, response: apiError('connection_unusable') };
  return { ok: true as const, sessionId: session.sessionId, scope: { connectionId: params.id, region: params.region } satisfies MonitoringScope };
}

const FAILURE_CODES = { denied: 'aws_denied', throttled: 'aws_throttled', error: 'aws_error' } as const;
const FAILURE_STATUS = { denied: 403, throttled: 429, error: 502 } as const;

export function failureResponse(failure: MonitoringFailure) {
  return NextResponse.json({ error: FAILURE_CODES[failure.reason], action: failure.action, code: failure.code }, { status: FAILURE_STATUS[failure.reason] });
}
```

`…/logs/query/route.ts`:

```ts
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string; region: string }> }) {
  const auth = await authorizeLogsRoute(request, await params, { mutating: true });
  if (!auth.ok) return auth.response;
  const input = parseLogsQueryInput(await request.json().catch(() => null), Date.now());
  if (!input.ok) return apiError(input.error);
  const target = await resolveTarget(auth.scope);
  if (!target.ok) return failureResponse(target);
  const started = await startLogsQuery(target.data, input.value);
  if (!started.ok) return failureResponse(started);
  queryBindings.bind(started.data.queryId, { ...auth.scope, sessionId: auth.sessionId });
  return NextResponse.json({ queryId: started.data.queryId });
}
```

`…/logs/query/[queryId]/route.ts`:

```ts
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; region: string; queryId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { queryId, ...rest } = await params;
  const auth = await authorizeLogsRoute(request, rest, { mutating: false });
  if (!auth.ok) return auth.response;
  if (!queryBindings.matches(queryId, { ...auth.scope, sessionId: auth.sessionId })) return apiError('not_found');
  const target = await resolveTarget(auth.scope);
  if (!target.ok) return failureResponse(target);
  const results = await getLogsQueryResults(target.data, queryId);
  return results.ok ? NextResponse.json(results.data) : failureResponse(results);
}

export async function DELETE(request: Request, { params }: Context) {
  const { queryId, ...rest } = await params;
  const auth = await authorizeLogsRoute(request, rest, { mutating: true });
  if (!auth.ok) return auth.response;
  if (!queryBindings.matches(queryId, { ...auth.scope, sessionId: auth.sessionId })) return apiError('not_found');
  const target = await resolveTarget(auth.scope);
  // StopQuery failures are ignored (moto 5.2.3 does not implement it); the binding is dropped either way.
  if (target.ok) await stopLogsQuery(target.data, queryId);
  queryBindings.forget(queryId);
  return new NextResponse(null, { status: 204 });
}
```

`src/lib/http/api-error.ts`: extend `ApiErrorCode` and `STATUS` with the six codes.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run tests/unit/query-bindings.test.ts tests/unit/monitoring-logs.test.ts tests/unit/logs-routes.test.ts tests/unit/template-route.test.ts tests/unit/auth.test.ts tests/unit/module-boundaries.test.ts`
Expected: pass (template-route and auth prove `getCurrentAdminId` still behaves).

- [ ] **Step 5: E2E route checks**

Create `tests/e2e/07-logs.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

test('the Logs Insights routes check origin, session and query ownership', async ({ page, playwright, baseURL }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  const path = `/api/connections/${id}/regions/${MOTO_REGION}/logs/query`;
  const now = Math.floor(Date.now() / 1000);
  const data = { logGroups: ['/ecs/opswatch-web'], query: 'fields @timestamp, @message | limit 5', startSeconds: now - 3600, endSeconds: now };

  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.post(path, { data, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await anonymous.post(path, { data, headers: { origin: baseURL as string } })).status()).toBe(401);
  await anonymous.dispose();

  expect((await page.request.get(`${path}/not-a-query-id`)).status()).toBe(404);
  const started = await page.request.post(path, { data, headers: { origin: baseURL as string } });
  expect(started.status()).toBe(200);
  const { queryId } = (await started.json()) as { queryId: string };
  const results = await page.request.get(`${path}/${queryId}`);
  expect(results.status()).toBe(200);
  expect(((await results.json()) as { status: string }).status).toBe('Complete');
  expect((await page.request.post(`/api/connections/${id}/regions/eu-west-3/logs/query`, { data, headers: { origin: baseURL as string } })).status()).toBe(404);
});
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`, then the e2e stack.
Expected: all pass (`48 passed` e2e). E2E gaps touched: StopQuery round-trip, Logs Insights filter semantics, denied and throttled query errors.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat(logs): Logs Insights query routes bound to connection, region and session

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Logs page — log group picker, query editor and results

**Files:**
- Create: `src/lib/monitoring/shared/logs-queries.ts`, `src/lib/monitoring/shared/logs-poller.ts`, `src/lib/monitoring/shared/logs-api.ts`
- Create: `src/app/[locale]/(app)/c/[connectionId]/[region]/logs/page.tsx`, `logs/log-group-picker.tsx`, `logs/logs-query-panel.tsx`
- Modify: `src/app/[locale]/(app)/c/[connectionId]/[region]/containers/[cluster]/[service]/cards.tsx` (log group links), `src/components/getting-started/pages-section.tsx`, `messages/en.json`, `messages/fr.json`, `README.md`, `README.fr.md`, `tests/e2e/07-logs.spec.ts`
- Test: `tests/unit/logs-poller.test.ts`

**Interfaces:**
- Consumes: Task 12 routes and response shapes (`{ queryId }`, `LogsQueryResults`, errors `{ error, action?, code? }`), `LOGS_MAX_GROUPS`, `searchLogGroups`, `LogGroup`; Task 2 `TimeRange`, `RANGE_SECONDS`; Task 3 `initMonitoringRoute`, `resolveTarget`, `monitoringPath`; Task 4 `MonitoringHeader` (with `autoRefresh={false}`), `MonitoringCard`, `SuspenseCard`, `FailureNotice`, `formatMetricValue`; Task 6 `taskDefinitionLogs`; `Button`, `Input`, `Label`, `Table*`, `Badge`; `useTranslations('Monitoring.client')`, `useLocale`.
- Produces:
  - `shared/logs-queries.ts`: `DEFAULT_LOGS_QUERY = 'fields @timestamp, @message | sort @timestamp desc | limit 100'`; `EXAMPLE_QUERIES: Record<'default' | 'errors' | 'serverErrors' | 'slowRequests', string>`; `LOGS_TIME_RANGES = ['1h', '3h', '12h', '24h'] as const satisfies readonly TimeRange[]`; `type LogsTimeRange`; `LOGS_POLL_INTERVAL_MS = 1000`; `LOGS_CLIENT_TIMEOUT_MS = 60_000`; `TERMINAL_QUERY_STATUSES = ['Complete', 'Failed', 'Cancelled', 'Timeout', 'Unknown'] as const`
  - `shared/logs-api.ts`: `type LogsClientError = { code: string; action?: string; awsCode?: string }`; `type ClientQueryResults = { status: string; fields: string[]; rows: Record<string, string>[]; statistics: { recordsMatched: number; recordsScanned: number; bytesScanned: number } }`; `type ApiOutcome<T> = { ok: true; data: T } | { ok: false; error: LogsClientError }`; `type LogsApi = { start(input: { logGroups: string[]; query: string; startSeconds: number; endSeconds: number }): Promise<ApiOutcome<{ queryId: string }>>; poll(queryId: string): Promise<ApiOutcome<ClientQueryResults>>; stop(queryId: string): Promise<void> }`; `createLogsApi(connectionId: string, region: string): LogsApi`
  - `shared/logs-poller.ts`: `type PollOutcome = { kind: 'complete'; results: ClientQueryResults } | { kind: 'ended'; status: string; results: ClientQueryResults } | { kind: 'timeout' } | { kind: 'aborted' } | { kind: 'error'; error: LogsClientError }`; `runLogsQuery(options: { api: LogsApi; input: Parameters<LogsApi['start']>[0]; signal: AbortSignal; onProgress: (results: ClientQueryResults, elapsedMs: number) => void; onStarted?: (queryId: string) => void; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; now?: () => number; intervalMs?: number; timeoutMs?: number }): Promise<PollOutcome>`

moto limits (fact 10): results are `Complete` at the first poll and filters are ignored, so e2e asserts that the seeded messages appear, not that example filters narrow them; `StopQuery` is not implemented, so e2e does not assert stopping (unit-tested with a fake API).

- [ ] **Step 1: Write the failing test**

`tests/unit/logs-poller.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ClientQueryResults, LogsApi } from '@/lib/monitoring/shared/logs-api';
import { runLogsQuery } from '@/lib/monitoring/shared/logs-poller';

const results = (status: string): ClientQueryResults => ({ status, fields: ['@message'], rows: [{ '@message': 'x' }], statistics: { recordsMatched: 1, recordsScanned: 1, bytesScanned: 10 } });
const input = { logGroups: ['/ecs/web'], query: 'fields @message', startSeconds: 0, endSeconds: 3600 };

function setup(statuses: string[], step = 1000) {
  let t = 0;
  const api: LogsApi = {
    start: vi.fn(async () => ({ ok: true as const, data: { queryId: 'q-1' } })),
    poll: vi.fn(async () => ({ ok: true as const, data: results(statuses.shift() ?? 'Running') })),
    stop: vi.fn(async () => {}),
  };
  const sleep = vi.fn(async (ms: number) => {
    t += step === 1000 ? ms : step;
  });
  return { api, sleep, now: () => t, controller: new AbortController(), onProgress: vi.fn() };
}

describe('runLogsQuery', () => {
  it('polls every second until Complete and reports progress', async () => {
    const s = setup(['Scheduled', 'Running', 'Complete']);
    const outcome = await runLogsQuery({ ...s, input, signal: s.controller.signal });
    expect(outcome).toEqual({ kind: 'complete', results: results('Complete') });
    expect(s.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 1000]);
    expect(s.onProgress).toHaveBeenCalledTimes(3);
    expect(s.api.stop).not.toHaveBeenCalled();
  });

  it.each(['Failed', 'Cancelled', 'Timeout', 'Unknown'])('ends on %s', async (status) => {
    const s = setup([status]);
    expect(await runLogsQuery({ ...s, input, signal: s.controller.signal })).toEqual({ kind: 'ended', status, results: results(status) });
  });

  it('stops the query after 60 seconds', async () => {
    const s = setup([], 20_000);
    expect(await runLogsQuery({ ...s, input, signal: s.controller.signal })).toEqual({ kind: 'timeout' });
    expect(s.api.stop).toHaveBeenCalledWith('q-1');
    expect(s.api.poll).toHaveBeenCalledTimes(3);
  });

  it('stops the query when aborted and ignores a failing stop', async () => {
    const s = setup([]);
    vi.mocked(s.api.stop).mockRejectedValueOnce(new Error('moto has no StopQuery'));
    s.sleep.mockImplementationOnce(async () => s.controller.abort());
    expect(await runLogsQuery({ ...s, input, signal: s.controller.signal })).toEqual({ kind: 'aborted' });
    expect(s.api.stop).toHaveBeenCalledWith('q-1');
  });

  it('returns start and poll errors without polling further', async () => {
    const s = setup([]);
    vi.mocked(s.api.start).mockResolvedValueOnce({ ok: false, error: { code: 'aws_denied', action: 'logs:StartQuery', awsCode: 'AccessDeniedException' } });
    expect(await runLogsQuery({ ...s, input, signal: s.controller.signal })).toEqual({ kind: 'error', error: { code: 'aws_denied', action: 'logs:StartQuery', awsCode: 'AccessDeniedException' } });
    expect(s.api.poll).not.toHaveBeenCalled();

    const p = setup([]);
    vi.mocked(p.api.poll).mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    expect(await runLogsQuery({ ...p, input, signal: p.controller.signal })).toEqual({ kind: 'error', error: { code: 'not_found' } });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/logs-poller.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the shared client modules**

`logs-queries.ts` — the example queries (query text is AWS syntax, not translated):

```ts
export const DEFAULT_LOGS_QUERY = 'fields @timestamp, @message | sort @timestamp desc | limit 100';
export const EXAMPLE_QUERIES = {
  default: DEFAULT_LOGS_QUERY,
  errors: 'fields @timestamp, @logStream, @message | filter @message like /(?i)(error|exception|fatal)/ | sort @timestamp desc | limit 100',
  serverErrors: 'fields @timestamp, @logStream, @message | filter @message like / 5\\d\\d / | sort @timestamp desc | limit 100',
  slowRequests: 'fields @timestamp, @message | parse @message /(?<durationMs>\\d+(\\.\\d+)?)\\s?ms/ | filter durationMs > 1000 | sort durationMs desc | limit 100',
} as const;
```

`logs-poller.ts`:

```ts
import type { ClientQueryResults, LogsApi, LogsClientError } from './logs-api';
import { LOGS_CLIENT_TIMEOUT_MS, LOGS_POLL_INTERVAL_MS } from './logs-queries';

export type PollOutcome =
  | { kind: 'complete'; results: ClientQueryResults }
  | { kind: 'ended'; status: string; results: ClientQueryResults }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'error'; error: LogsClientError };

const ENDED = new Set(['Failed', 'Cancelled', 'Timeout', 'Unknown']);

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

export async function runLogsQuery(options: {
  api: LogsApi;
  input: Parameters<LogsApi['start']>[0];
  signal: AbortSignal;
  onProgress: (results: ClientQueryResults, elapsedMs: number) => void;
  onStarted?: (queryId: string) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<PollOutcome> {
  const { api, signal, onProgress } = options;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? LOGS_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? LOGS_CLIENT_TIMEOUT_MS;
  const stop = (queryId: string) => api.stop(queryId).catch(() => undefined);

  const started = await api.start(options.input);
  if (!started.ok) return { kind: 'error', error: started.error };
  const { queryId } = started.data;
  options.onStarted?.(queryId);
  const startedAt = now();

  for (;;) {
    if (signal.aborted) {
      await stop(queryId);
      return { kind: 'aborted' };
    }
    const polled = await api.poll(queryId);
    if (!polled.ok) return { kind: 'error', error: polled.error };
    onProgress(polled.data, now() - startedAt);
    if (polled.data.status === 'Complete') return { kind: 'complete', results: polled.data };
    if (ENDED.has(polled.data.status)) return { kind: 'ended', status: polled.data.status, results: polled.data };
    if (now() - startedAt >= timeoutMs) {
      await stop(queryId);
      return { kind: 'timeout' };
    }
    await sleep(intervalMs, signal);
    if (now() - startedAt >= timeoutMs && !signal.aborted) {
      await stop(queryId);
      return { kind: 'timeout' };
    }
  }
}
```

With `step = 20_000` in the timeout test: poll 1 at t=0, sleep → 20 s, poll 2, sleep → 40 s, poll 3, sleep → 60 s → timeout after 3 polls.

`logs-api.ts`:

```ts
const base = (connectionId: string, region: string) => `/api/connections/${encodeURIComponent(connectionId)}/regions/${encodeURIComponent(region)}/logs/query`;

async function outcome<T>(response: Response): Promise<ApiOutcome<T>> {
  if (response.ok) return { ok: true, data: (await response.json()) as T };
  const body = (await response.json().catch(() => ({}))) as { error?: string; action?: string; code?: string };
  return { ok: false, error: { code: body.error ?? 'request_failed', action: body.action, awsCode: body.code } };
}

export function createLogsApi(connectionId: string, region: string): LogsApi {
  const url = base(connectionId, region);
  return {
    start: async (input) => outcome(await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })),
    poll: async (queryId) => outcome(await fetch(`${url}/${encodeURIComponent(queryId)}`, { cache: 'no-store' })),
    // keepalive lets the stop request finish when the user leaves the page.
    stop: async (queryId) => {
      await fetch(`${url}/${encodeURIComponent(queryId)}`, { method: 'DELETE', keepalive: true });
    },
  };
}
```

A network failure (`fetch` rejecting) inside `start`/`poll` must map to `{ ok: false, error: { code: 'request_failed' } }`: wrap each `fetch` in `try/catch`.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/unit/logs-poller.test.ts tests/unit/module-boundaries.test.ts`
Expected: pass.

- [ ] **Step 5: Page, picker and panel**

`logs/page.tsx`: metadata `localizedTitle('Monitoring.logs.title')`; `Props` search params `{ group?: string | string[]; prefix?: string | string[]; range?: string | string[] }`; `const context = await initMonitoringRoute(params);` first; `groups = [...new Set(toArray(sp.group))].filter((g) => g.length > 0 && g.length <= 512).slice(0, LOGS_MAX_GROUPS)`; `prefix = first(sp.prefix)?.trim().slice(0, 512) ?? ''`; `range = isOneOf(LOGS_TIME_RANGES, first(sp.range)) ? … : '1h'`; `MonitoringHeader` with `autoRefresh={false}` and no `range`; layout `grid gap-6 lg:grid-cols-[20rem_1fr]`: left `<SuspenseCard key={prefix} title={t('picker.title')} variant="table"><LogGroupPicker scope={context.scope} prefix={prefix} selected={groups} range={range} /></SuspenseCard>`, right `<LogsQueryPanel connectionId={context.scope.connectionId} region={context.scope.region} groups={groups} initialRange={range} />`.

`log-group-picker.tsx` (async server): a GET form with `Label`/`Input name="prefix"` `t('picker.prefix')`, hidden `range`, hidden `group` inputs for the current selection, submit `t('picker.search')`; `resolveTarget` → `searchLogGroups(target, prefix)` (failure → `FailureNotice`); empty → `t('picker.empty')`; else a second GET form: one native checkbox per group (`name="group"`, `value={name}`, `defaultChecked={selected.includes(name)}`, label = name in mono plus `formatMetricValue(storedBytes, 'bytes', locale)`), hidden `prefix` and `range`, submit `t('picker.use')`; when 50 groups are returned, `t('picker.limit', { count: 50 })`; footer `t('picker.billed')`.

`logs-query-panel.tsx` (`'use client'`, `useTranslations('Monitoring.client')`):
- State: `query` (initial `DEFAULT_LOGS_QUERY`), `range` (initial `initialRange`), `phase` (`'idle' | 'running' | 'done'`), `elapsed`, `results: ClientQueryResults | null`, `message: { kind: 'status' | 'error'; text: string } | null`; `controllerRef`, `queryIdRef`.
- Selected groups shown as `Badge`s under `t('logs.groups')`; none → `t('logs.noGroups')` and Run disabled.
- `<Label htmlFor>` `t('logs.query')` + `<textarea>` (`rows={6}`, mono, `maxLength={10000}`); a `<select>` `t('logs.range')` over `LOGS_TIME_RANGES` labelled `t(`range.options.${r}`)`; example buttons (`type="button"`, `variant="outline" size="sm"`) `t('logs.examples.default' | 'errors' | 'serverErrors' | 'slowRequests')` that set `query` to `EXAMPLE_QUERIES[key]`, grouped under `t('logs.examples.label')`.
- Run: `endSeconds = Math.floor(Date.now() / 1000)`, `startSeconds = endSeconds - RANGE_SECONDS[range]`; new `AbortController`; `runLogsQuery({ api: createLogsApi(connectionId, region), input: { logGroups: groups, query, startSeconds, endSeconds }, signal, onStarted: (id) => (queryIdRef.current = id), onProgress: (r, ms) => { setResults(r); setElapsed(ms) } })`; while running show Stop (`t('logs.stop')`) and `t('logs.status.running', { seconds: Math.round(elapsed / 1000) })` in a `role="status"` line.
- Outcome messages: `complete` → `t('logs.status.complete', { rows: results.rows.length, records: results.statistics.recordsScanned })`; `ended` → `t('logs.status.failed', { status })`; `timeout` → `t('logs.status.timeout')`; `aborted` → `t('logs.status.stopped')`; `error` by `code`: `aws_denied` → `t('logs.errors.denied', { action })`, `aws_throttled` → `t('logs.errors.throttled')`, `aws_error` → `t('logs.errors.aws', { code: awsCode ?? '' })`, `invalid_query` / `range_too_long` / `unauthorized` → `t(`logs.errors.${code}`)`, anything else → `t('logs.errors.generic')`; errors render in `role="alert"`.
- Leaving: a `useEffect` cleanup aborts the controller (the poller then calls `stop`); a `pagehide` listener calls `createLogsApi(...).stop(queryIdRef.current)` when a query is running.
- Results: `<Table aria-label={t('logs.results.label')}>` with one column per `results.fields`, cells `whitespace-pre-wrap break-all font-mono text-xs`; zero rows after completion → `t('logs.results.empty')`.

Service detail link (Task 6 `LogsCard`): for each awslogs target whose `region` is null or equals `scope.region`, render `<Link href={`${monitoringPath(scope, 'logs')}?group=${encodeURIComponent(logGroup)}`}>` around the group name; other regions keep the plain text.

`pages-section.tsx`: add `'logs'` to the item list.

- [ ] **Step 6: Messages**

| Key | en | fr |
|---|---|---|
| `Monitoring.logs.title` | Logs | Journaux |
| `Monitoring.logs.description` | CloudWatch Logs Insights queries for {connection} in {region}. | Requêtes CloudWatch Logs Insights pour {connection} dans {region}. |
| `Monitoring.logs.picker.title` | Log groups | Groupes de journaux |
| `Monitoring.logs.picker.prefix` | Log group name prefix | Préfixe du nom du groupe |
| `Monitoring.logs.picker.search` | Search | Rechercher |
| `Monitoring.logs.picker.use` | Use selected groups | Utiliser les groupes sélectionnés |
| `Monitoring.logs.picker.empty` | No log group starts with this prefix. | Aucun groupe de journaux ne commence par ce préfixe. |
| `Monitoring.logs.picker.limit` | Showing the first {count} groups. Type a longer prefix to narrow the list. | Affichage des {count} premiers groupes. Saisissez un préfixe plus long pour affiner la liste. |
| `Monitoring.logs.picker.billed` | Logs Insights queries are billed by AWS per GB of logs scanned. | Les requêtes Logs Insights sont facturées par AWS au Go de journaux analysé. |
| `Monitoring.client.logs.query` | Query | Requête |
| `Monitoring.client.logs.range` | Time range | Période |
| `Monitoring.client.logs.groups` | Selected log groups | Groupes sélectionnés |
| `Monitoring.client.logs.noGroups` | Select at least one log group to run a query. | Sélectionnez au moins un groupe de journaux pour lancer une requête. |
| `Monitoring.client.logs.run` | Run query | Lancer la requête |
| `Monitoring.client.logs.stop` | Stop | Arrêter |
| `Monitoring.client.logs.examples.label` | Examples | Exemples |
| `Monitoring.client.logs.examples.default` | Latest messages | Derniers messages |
| `Monitoring.client.logs.examples.errors` | Errors | Erreurs |
| `Monitoring.client.logs.examples.serverErrors` | 5xx responses | Réponses 5xx |
| `Monitoring.client.logs.examples.slowRequests` | Slow requests | Requêtes lentes |
| `Monitoring.client.logs.status.running` | Running… {seconds} s | En cours… {seconds} s |
| `Monitoring.client.logs.status.complete` | {rows, plural, one {# row} other {# rows}} · {records, plural, one {# record scanned} other {# records scanned}} | {rows, plural, one {# ligne} other {# lignes}} · {records, plural, one {# enregistrement analysé} other {# enregistrements analysés}} |
| `Monitoring.client.logs.status.stopped` | Query stopped. | Requête arrêtée. |
| `Monitoring.client.logs.status.timeout` | The query was stopped after 60 seconds. | La requête a été arrêtée après 60 secondes. |
| `Monitoring.client.logs.status.failed` | The query ended with status {status}. | La requête s'est terminée avec le statut {status}. |
| `Monitoring.client.logs.errors.denied` | OpsWatch cannot run this query (missing {action}). | OpsWatch ne peut pas lancer cette requête (permission {action} manquante). |
| `Monitoring.client.logs.errors.throttled` | AWS is limiting Logs Insights queries. Wait a moment and try again. | AWS limite les requêtes Logs Insights. Patientez un instant puis réessayez. |
| `Monitoring.client.logs.errors.aws` | AWS returned an error ({code}). | AWS a renvoyé une erreur ({code}). |
| `Monitoring.client.logs.errors.invalid_query` | The query or the log groups are not valid. | La requête ou les groupes de journaux ne sont pas valides. |
| `Monitoring.client.logs.errors.range_too_long` | The time range cannot exceed 24 hours. | La période ne peut pas dépasser 24 heures. |
| `Monitoring.client.logs.errors.unauthorized` | Your session has expired. Sign in again. | Votre session a expiré. Reconnectez-vous. |
| `Monitoring.client.logs.errors.generic` | The query could not be run. Please try again. | La requête n'a pas pu être lancée. Veuillez réessayer. |
| `Monitoring.client.logs.results.label` | Query results | Résultats de la requête |
| `Monitoring.client.logs.results.empty` | The query returned no rows. | La requête n'a renvoyé aucune ligne. |
| `GettingStarted.pages.items.logs` | Logs: pick log groups and run CloudWatch Logs Insights queries over up to 24 hours, with example queries for errors, 5xx responses and slow requests. | Journaux : choisissez des groupes de journaux et lancez des requêtes CloudWatch Logs Insights sur 24 heures au plus, avec des exemples pour les erreurs, les réponses 5xx et les requêtes lentes. |

README.md: Stage 2 table row content becomes "…, Alarms, Logs (CloudWatch Logs Insights)"; add a **Logs** bullet to `## Monitoring pages`: "**Logs**: pick log groups by prefix and run CloudWatch Logs Insights queries over at most 24 hours (1,000 rows); a query stops after 60 seconds or when you leave the page. `logs:StartQuery` is billed per GB of logs scanned." README.fr.md: the same in French ("Journaux (CloudWatch Logs Insights)"; "**Journaux** : choisissez des groupes de journaux par préfixe et lancez des requêtes CloudWatch Logs Insights sur 24 heures au plus (1 000 lignes) ; une requête s'arrête après 60 secondes ou quand vous quittez la page. `logs:StartQuery` est facturée au Go de journaux analysé.").

- [ ] **Step 7: E2E tests** (append to `tests/e2e/07-logs.spec.ts`)

```ts
test('the logs page searches groups, runs a query and shows rows', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs`);
  await expect(page).toHaveTitle('Logs · OpsWatch');
  await page.getByLabel('Log group name prefix').fill('/ecs');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await page.getByRole('button', { name: 'Use selected groups' }).click();
  await expect(page).toHaveURL(/group=%2Fecs%2Fopswatch-web/);
  await expect(page.getByLabel('Query', { exact: true })).toHaveValue('fields @timestamp, @message | sort @timestamp desc | limit 100');
  await page.getByRole('button', { name: 'Run query' }).click();
  const results = page.getByRole('table', { name: 'Query results' });
  // moto returns every event in range at once (fact 10).
  await expect(results.getByRole('row').filter({ hasText: 'ERROR payment gateway timeout' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^3 rows · /)).toBeVisible();
});

test('the service page links to its log group', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/containers/opswatch-e2e/web`);
  await page.getByRole('link', { name: '/ecs/opswatch-web' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}/${MOTO_REGION}/logs\\?group=%2Fecs%2Fopswatch-web$`));
  await expect(page.getByText('/ecs/opswatch-web').first()).toBeVisible();
});
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`, then the e2e stack.
Expected: all pass (`50 passed` e2e). E2E gaps touched: Logs Insights filters and example queries, Stop and StopQuery, 60-second timeout (unit-tested).

- [ ] **Step 9: Commit**

```bash
git add src messages tests README.md README.fr.md
git commit -m "feat(logs): logs page with log group picker, Logs Insights editor, polling and results

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| §2.1 Overview cards and insights | 10 (rules 9) |
| §2.2 Containers list, service detail, target groups, awslogs link | 6, link 13 |
| §2.3 Databases, instance charts, PI top SQL | 7 |
| §2.4 Load balancers list and detail | 8 |
| §2.5 Alarms with target-tracking toggle | 5 |
| §2.6 Logs picker, editor, examples, 24 h / 1000 rows / 60 s | 12, 13 |
| §3 Sidebar, switcher, region selector, URLs, redirect, time range, refresh | 3, 4 |
| §4 Module layout, typed results, timeouts, cache, streaming, charts, sparklines, Intl formatting, route pair, denied cards | 2, 3, 4, 12 |
| §5 ECS, RDS/PI, ELB, alarms data details | 5–8 |
| §6 Insight rules, localized messages | 9, 10 |
| §7 Unit tests, moto seeding, e2e scenarios, i18n parity | 1–13 |
| §8 README EN/FR, guide pages, no template change | 11, 13 |
| §9.1 Per-card Suspense, no shared Promise.all | 4–10 |
| §9.2 120 s refresh, pause, hidden tab; 60 s cache; cost model; billedActions | 2, 4, 11 |
| §9.3 Phase A order with moto harness first; Phase B logs; PI unit-only | 1, 7, 11 checkpoint, 12–13 |
| §9.4 Region validation, unusable redirect | 3 |
| §9.5 Region-bound log routes, 10-minute bindings, stop states, StopQuery ignored | 12, 13 |
| §9.6 `p95` stat | 2, 6, 8 |
| §9.7 ALB rate and absolute checks | 9 |
| §9.8 Grouping and hysteresis | 9 |
| §9.9 moto limits and explicit e2e gaps | header facts, 1, every task |
