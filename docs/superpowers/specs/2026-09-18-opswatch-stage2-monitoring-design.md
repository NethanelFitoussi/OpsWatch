# OpsWatch Stage 2 — Live monitoring of containers, databases, load balancers, alarms and logs

Status: controller design written overnight while the owner was away. Owner request: "check service on cloudwatch to add here". It follows the roadmap in the Step 1 spec (§2): live reading plus automatic analyses, no historical storage yet. Decisions below are rulings recorded in the ledger; the owner can revisit them.

## 1. Evidence from the owner's account (read-only inventory, eu-west-1)

Active CloudWatch namespaces by metric series: AWS/RDS 2949, AWS/ApplicationELB 1535, AWS/EC2 466, AWS/EBS 457, AWS/SQS 396, ECS/ContainerInsights 334, AWS/Lambda 290, AWS/Logs 133, AWS/ECS 46. One ECS cluster (`ecs-gigs-prod`, Container Insights on, many services), nine Aurora MySQL instances with Performance Insights, four ALBs, 97 alarms (many autoscaling target-tracking alarms), 120 log groups. Recent incidents handled with this owner: seller_api CPU spikes, Aurora CPU and TempTable errors, ALB 504s. Those pains set the priority.

## 2. Scope

In scope (all live reads, no storage):
1. **Overview** page: per selected connection and region, health summary cards (ECS services degraded, RDS instances hot, ALBs with 5xx, alarms firing) and an "Insights" list from automatic rules (§6).
2. **Containers** (ECS): clusters → services table (status, running/desired/pending tasks, CPU and memory utilization sparkline, last deployment state) → service detail (CPU/memory charts, running tasks with task definition revision and started time, recent service events, attached target groups with target health and ALB metrics for them, link to logs of the service's log group when the task definition uses awslogs).
3. **Databases** (RDS/Aurora): clusters and instances table (engine, class, role writer/reader, CPU, connections, freeable memory, replica lag sparkline) → instance detail (charts for CPUUtilization, DatabaseConnections, FreeableMemory, ReadIOPS/WriteIOPS, ReadLatency/WriteLatency, AuroraReplicaLag when relevant; Performance Insights top SQL by average active sessions for the time range when PI is enabled).
4. **Load balancers** (ALB): list with request count, HTTP 5xx (ELB and target), target response time p95, healthy/unhealthy hosts → detail with charts per target group.
5. **Alarms**: list of CloudWatch alarms with state, filterable, hiding autoscaling target-tracking alarms (`TargetTracking-*`) by default with a toggle.
6. **Logs**: log group picker (search by prefix), CloudWatch Logs Insights query editor with a default query (`fields @timestamp, @message | sort @timestamp desc | limit 100`), time range, run/stop, results table, and saved example queries (errors, 5xx, slow requests). Limit: at most 24 hours range and 1000 rows per query; the query is stopped when the user leaves or after 60 s.

Out of scope (later stages): SQS, Lambda, EC2/EBS dashboards (need new IAM actions and a template version bump); history storage and on-demand snapshots; notifications; multi-account overview; Google Cloud.

The IAM catalogue (TEMPLATE_VERSION 1) already contains every action needed: ECS describe/list, ELB describe, RDS describe, PI GetResourceMetrics/DescribeDimensionKeys, CloudWatch GetMetricData/ListMetrics/DescribeAlarms, Logs DescribeLogGroups/StartQuery/GetQueryResults/StopQuery. No template change.

## 3. Navigation and selection

- Sidebar: Overview, Containers, Databases, Load balancers, Alarms, Logs become enabled (remove "coming soon"); Getting started and Accounts stay.
- The top-bar connection switcher selects the connection; a region selector lists the connection's regions. Selection lives in the URL: `/<locale>/c/<connectionId>/<region>/overview`, `/containers`, `/containers/<cluster>/<service>`, `/databases`, `/databases/<instance>`, `/load-balancers`, `/load-balancers/<name>`, `/alarms`, `/logs`. Visiting `/<locale>/overview` without a selection redirects to the first connection with status ok/degraded and its first region, or to Accounts when none is usable.
- Time range selector on every data page: 1h, 3h (default), 12h, 24h, 7d, in the query string (`?range=3h`). Charts auto-refresh every 60 s when the tab is visible (client timer calling `router.refresh()`), with a pause toggle.

## 4. Architecture

- `src/lib/monitoring/` (server-only), one module per domain: `metrics.ts` (GetMetricData batching: up to 500 queries per call, period chosen from range: 1h→60 s, 3h→60 s, 12h→300 s, 24h→300 s, 7d→3600 s; returns `{ id, label, timestamps, values }` series), `ecs.ts`, `rds.ts`, `pi.ts`, `elb.ts`, `alarms.ts`, `logs.ts`, `insights.ts` (rules). Each function takes `{ credentials, region }` plus params, uses the shared `clientConfig`, the existing 5 s timeout helper for describe calls (10 s for GetMetricData), and maps AWS errors to typed results: `{ ok: true, data } | { ok: false, reason: 'denied' | 'throttled' | 'error', code }`.
- Credentials come from the existing credential resolver for the selected connection (`credentialsInputFor` + `credentialResolver.resolve`). Every page and server action checks `requireAdmin` first (Step 1 A1 rule).
- Caching: in-memory LRU per process keyed by connection id + region + call + params, TTL 60 s for metrics and describe calls, 5 minutes for PI top SQL, no cache for Logs Insights. Protects AWS API costs (GetMetricData is billed per metric) and rate limits. Cache size bounded (e.g. 500 entries).
- Pages are server components that fetch in parallel with `Promise.all` and stream with Suspense boundaries per card so one slow call does not block the page; `loading.tsx` skeletons.
- Charts: `recharts` 3.10.1 (latest) in small client components receiving serialized series; sparklines as tiny inline SVG components (no library) for tables. Units formatted with `Intl.NumberFormat` in the active locale.
- Logs Insights runs through a route handler pair: `POST /api/connections/:id/logs/query` (starts, returns queryId; Origin check + session) and `GET /api/connections/:id/logs/query/:queryId` (polls results), `DELETE` to stop. Client polls every 1 s until Complete/Failed/Cancelled or 60 s.
- Permissions: when a call is denied, the card shows "OpsWatch cannot read this (missing <action>)" with a link to the connection's permission checklist; the rest of the page still renders.

## 5. Data details

- ECS: `ListClusters`/`DescribeClusters`; `ListServices` (paginate, max 100 services shown with search) + `DescribeServices` in batches of 10; metrics from `AWS/ECS` `CPUUtilization`/`MemoryUtilization` (dimensions ClusterName, ServiceName), and when Container Insights is enabled `ECS/ContainerInsights` `RunningTaskCount`, `DesiredTaskCount`. Service events: the latest 20 from DescribeServices. Tasks: `ListTasks` + `DescribeTasks` for the service. Target groups: from service `loadBalancers[].targetGroupArn`, `DescribeTargetHealth`, and `AWS/ApplicationELB` metrics with TargetGroup + LoadBalancer dimensions.
- RDS: `DescribeDBClusters` and `DescribeDBInstances`; metrics from `AWS/RDS` per `DBInstanceIdentifier`. PI: `DescribeDimensionKeys` with `db.sql_tokenized` grouped, `db.load.avg`, top 10, for instances with PI enabled (`DbiResourceId`).
- ELB: `DescribeLoadBalancers` (type application), `DescribeTargetGroups`, metrics `RequestCount`, `HTTPCode_ELB_5XX_Count`, `HTTPCode_Target_5XX_Count`, `TargetResponseTime` (p95 via `ExtendedStatistics` equivalent `p95` stat in GetMetricData), `HealthyHostCount`/`UnHealthyHostCount`.
- Alarms: `DescribeAlarms` (metric and composite), paginated.

## 6. Automatic analyses (Insights, rule-based, computed on the Overview)

Each rule yields `{ severity: 'critical'|'warning'|'info', kind, resource, messageKey, values, href }`:
- ECS service running tasks < desired for the last 10 minutes → critical.
- ECS service CPU or memory average > 85 % over the last 15 minutes → warning; > 95 % → critical.
- ECS service last deployment `rolloutState` FAILED → critical; IN_PROGRESS for > 30 minutes → warning.
- RDS instance CPU average > 80 % over 15 minutes → warning (> 95 % critical); FreeableMemory < 5 % of instance memory → warning (instance memory from a small class→GiB table for common classes, skip unknown classes); AuroraReplicaLag > 1000 ms → warning.
- ALB 5xx rate (ELB + target 5xx / RequestCount) > 1 % over 15 minutes with at least 100 requests → warning (> 5 % critical); UnHealthyHostCount > 0 → warning.
- CloudWatch alarms in ALARM state excluding `TargetTracking-*` → one insight per alarm, severity critical.
Rules are pure functions over already-fetched data, unit-tested with fixtures. Messages are localized (en, fr) with ICU placeholders.

## 7. Testing

- Unit (Vitest + aws-sdk-client-mock): every monitoring module (pagination, batching, error mapping, period selection), cache TTL with injected clock, every insight rule with boundary fixtures, formatting helpers.
- End-to-end (Playwright + moto): a global setup seeds moto through the AWS SDK (ECS cluster + service + task definition, RDS DB instance, ALB + target group, CloudWatch `PutMetricData` datapoints for the ECS and RDS metrics, one alarm in ALARM, a log group with events). Tests: overview shows the seeded alarm insight; containers table lists the service and its detail page renders charts; databases list shows the instance; alarms page filters target-tracking alarms; logs page runs a query and shows rows (if moto's Logs Insights support is too limited, test the query flow up to "running" and cover results in unit tests; say so).
- Existing Step 1 tests keep passing; i18n parity test covers new namespaces.

## 8. Definition of done

- With the owner's real connection, the Overview, Containers, Databases, Load balancers, Alarms and Logs pages render real data for eu-west-1 without errors (manual check by the owner in the morning; the controller does not use the owner's credentials through the UI).
- All unit and e2e tests pass in CI; lint, typecheck and build clean.
- README EN/FR and the getting-started guide mention the new pages; no template change needed.

## 9. Amendments after peer review (binding; they override earlier sections where they conflict)

1. **Streaming (§4).** Pages must not await a shared `Promise.all`. Each card is its own async server component wrapped in its own `<Suspense>` with a skeleton, so the page shell and fast cards render while slow cards stream. Tables that need several calls do those calls inside their card.
2. **Refresh and cost (§3, §4).** Auto-refresh interval is 120 s (not 60 s), user can pause it and it stops when the tab is hidden. The in-memory cache TTL stays 60 s and exists to share results between viewers and between cards requesting the same series. README EN/FR states the cost model: GetMetricData is billed per metric requested (about USD 0.01 per 1,000 metrics); a Containers page with 30 services refreshing every 2 minutes for 8 hours is roughly 30,000 metrics (about USD 0.30). Mark `cloudwatch:GetMetricData` as a billed action in the IAM catalogue (`billedActions`) without changing TEMPLATE_VERSION (the action list is unchanged).
3. **Cut line and order.** Phase A (must ship): shared monitoring foundation (metrics batching, cache, error mapping, connection/region loader, time range, charts), Overview with insights, Containers, Databases, Load balancers, Alarms, plus the moto e2e seeding harness, which is built first because it is the highest-risk part. Phase B (only after Phase A is reviewed clean): Logs page with Logs Insights. Performance Insights top SQL is part of Phase A but only unit-tested (moto has no PI backend).
4. **Region validation (§3).** A shared loader validates the URL region against `connection.regions` and the connection status; a region not configured for the connection returns notFound(); an unusable connection redirects to its connection page.
5. **Logs Insights binding (§4, Phase B).** Routes carry the region: `POST /api/connections/:id/regions/:region/logs/query`. The server keeps a short-lived map (10 minutes) `queryId → { connectionId, region, adminSessionId }` created at StartQuery; GET and DELETE check it and return 404 otherwise. Poller stop states: `Complete`, `Failed`, `Cancelled`, `Timeout`, `Unknown`. `StopQuery` failures are ignored in the UI; moto 5.2.3 does not implement `stop_query`, so e2e does not assert a stop round-trip.
6. **Stat names (§5).** Percentiles are requested with `MetricStat.Stat: "p95"` in GetMetricData (no ExtendedStatistics).
7. **ALB rule (§6).** Two checks: (a) rate check: (ELB 5xx + target 5xx) / RequestCount > 1 % over 15 minutes with RequestCount ≥ 100 → warning, > 5 % → critical; (b) absolute check independent of RequestCount: `HTTPCode_ELB_5XX_Count` sum ≥ 10 over 15 minutes → warning, ≥ 100 → critical.
8. **Insight grouping and hysteresis (§6).** Group per resource family: one insight per Aurora cluster for replica lag ("3 of 8 readers lag > 1 s"), one per ECS cluster when more than 3 services breach the same rule ("5 services above 85 % CPU", expandable list). Hysteresis: a threshold rule fires only when the breach holds for at least 3 consecutive datapoints of the evaluation window, and a warning threshold must fall 5 points below before clearing within the same window (computed from the fetched series, no stored state).
9. **moto limits (§7).** No PI backend: PI covered by unit tests only. ECS rollout FAILED and service events cannot be produced by moto: covered by unit fixtures only. E2e seeds only what moto supports (ECS cluster/service/task definition, RDS instance, ELBv2 ALB/target group, CloudWatch PutMetricData, alarms, log group and events) and the report must list each e2e gap explicitly.
