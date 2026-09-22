# OpsWatch Intelligence — design for the four-day mission

- **Status:** design, 2026-09-19, branch `feature/opswatch-intelligence` (base 7c471fd)
- **Supersedes:** nothing. It continues Stage 1 (foundations), Stage 2 (live monitoring), Stage 3 (analysis, partly built) and absorbs the Stage 4 Cloudflare design, whose §13 and §14 amendments stay binding.
- **Companion:** `docs/superpowers/specs/2026-09-18-opswatch-mobile-design.md` on branch `feature/mobile` (worktree `/var/www/html/OpsWatch-mobile`). §12 of this document is the server side of that contract and overrides it where they disagree.

## 1. What changes, in one paragraph

Today OpsWatch reads AWS live and renders it. It stores no measurement, so it can compare nothing, remember nothing and tell nobody. This design adds three things and reorganises the product around them: a **store** (a background collector and a small time series), a **Problem** (one first-class object that says what deserves attention, with a score whose arithmetic is on screen) and an **API** (one contract for the web, the mobile app and a CLI). Everything else in the owner's list hangs off those three. The rule that governs every decision below: OpsWatch keeps reading customer infrastructure read-only, and it never becomes an agent, a tracer or a log pipeline.

## 2. Product rules

These settle arguments later, so they come first.

1. **The product says what is wrong.** A page that only renders numbers is unfinished. Every page states, from its own data, what stands out (Stage 3 §9.3 rule: message keys with placeholders, never generated prose).
2. **Deterministic first.** Grouping, severity, baselines and anomalies are computed by written formulas and unit-tested. AI ranks and narrates; it never decides.
3. **No capability exists only when AI is on.** Turning AI off removes narration, never a feature.
4. **Nothing is faked.** A missing measurement is `null` and renders as "not measured", never as `0`, never as "healthy".
5. **Read-only forever.** No code path issues a write verb against a customer's AWS, Cloudflare or GitHub. Tests enforce it.
6. **An empty page is a bug.** Either the page has data, or it has a card that names the integration it needs, or it is not in the menu.

## 3. Information architecture

The left rail becomes seven collapsible groups. The collapsed state is remembered per browser, as the rail already does.

| Group | Pages |
|---|---|
| **Overview** | Morning brief (default), Health, Problems, Activity |
| **Infrastructure** | Containers, Databases, Caches, Load balancers, Zones & DNS, Alarms |
| **Applications** | Services, Errors, Deployments, Repositories, Logs |
| **Reliability** | Incidents, Alerts, Synthetics, SLOs |
| **Analysis** | Investigations, Reports, Queries, Checkup, Ask OpsWatch |
| **Integrations** | one page: the provider list and their state |
| **Settings** | General, Users, Notifications, API tokens, Data & retention, Audit log, System status |

Decisions inside that table:

- Stage 3's **Audit** page is renamed **Checkup**. "Audit" now means the administrative audit log, and two things with one name is how a product gets confusing.
- **Cloudflare gets no group.** Zone inventory lives under Infrastructure → Zones & DNS; the analytics enrich Health, Problems, Services and Investigations (§20).
- **URLs.** Pages that read a provider keep `/c/<connectionId>/<scope>/<group>/<page>`, where `scope` is an AWS region or a Cloudflare zone id or the literal `account` (Stage 4 §13.2). Pages that belong to the instance — Incidents, Alerts, Synthetics, SLOs, Integrations, Settings — live at `/<page>` and carry an environment filter in the query string. `parseMonitoringPath` keeps working unchanged.
- **No page ships disabled.** `UNBUILT_SUBSECTIONS` stays as the mechanism, and it must be empty at the end of every phase.
- Stage 3's unbuilt work is not thrown away: the section dashboards become the Infrastructure pages, the reports become §19, the endpoints page becomes part of Log intelligence (§18), the audit catalogue becomes Checkup.

## 4. The domain model

Ten objects. Identity rules are the load-bearing part: two runs of the same detector on the same facts must produce the same id.

### 4.1 Resource

What OpsWatch found in a provider. Identity: the ARN when there is one, otherwise `provider:type:scope:name`.

`{ id, provider, type, name, scope, serviceId?, state, attributes (selected keys only), tags (selected), firstSeenAt, lastSeenAt }`

Stored so that "this instance appeared on Tuesday" and "this target group is gone" are answerable. Attributes are a small allowlist per type, never the whole describe payload.

### 4.2 Service

The join key of the whole product. A service belongs to one connection and may span scopes inside it; a service spanning two AWS accounts is out of scope and the interface says so.

`{ id, slug, name, kind: 'ecs'|'lambda'|'other', connectionId, tier: 'user_facing'|'internal', resourceIds[], logSourceIds[], repositoryId?, owner?, origin: 'auto'|'user', aliases[] }`

Identity: `slug` = `<cluster>/<service>` for ECS, auto-created on first collection. A user may rename, merge or retier; **auto-discovery never overwrites a user edit** — a merge is stored as an alias and the discovered slug resolves through it.

### 4.3 Problem

The object the owner asked for. One row per distinct thing that is wrong.

`{ id, key, connectionId, scope, kind, subjectType, subjectId, serviceId?, source, titleKey, values, severity, score, scoreTerms, status, firstSeenAt, lastSeenAt, occurrences, flapCount, acknowledgedBy?, acknowledgedAt?, resolvedAt?, evidence[], investigationId?, incidentId?, previousProblemId? }`

**Grouping (deterministic).** `key = sha256(connectionId + '|' + scope + '|' + kind + '|' + subjectId)` truncated to 32 hex characters, with the four parts also stored in plain columns so a human can read why two things grouped. `kind` is the detector id (`ecs_cpu_high`, `error_group_new`, `synthetic_down`, `cert_expiring`, `metric_anomaly`, `slo_fast_burn`, `alarm_firing`, `cloudflare_origin_5xx`, …). `subjectId` is a Service id, a Resource id, an error group fingerprint or a synthetic id. Nothing else enters the key — not the value, not the timestamp, not the message — so the same problem stays one row for its whole life.

**Lifecycle.** `open → acknowledged → resolved → closed`. A detector that stops firing for three consecutive evaluations *and* at least 15 minutes resolves the problem. A key that fires again within 2 hours of resolution reopens the same row and increments `flapCount`; after 2 hours a new row is created carrying `previousProblemId`. This is what stops a flapping service from producing forty rows a day.

**Evidence.** An array of typed items, each with its source and timestamp: `{ kind: 'metric'|'event'|'log'|'check'|'inventory', label, value, unit, at, seriesRef?, href }`. Evidence is what the detector actually read. A problem with no evidence cannot be created; the type makes the field required.

**Severity score (written down, so it can be argued with).**

```
score = round( 40·S + 20·B + 15·T + 15·U + 10·D )        clamped to 0…100
```

| Term | Meaning | Value |
|---|---|---|
| `S` | the detector's own level | critical 1.0, warning 0.55, info 0.2 |
| `B` | blast radius | affected members ÷ members of the subject's family (tasks of a service, instances of a cluster, targets of a group). A subject with no family: 0.34 |
| `T` | persistence | `min(1, minutesBreaching / 60)` |
| `U` | user-facing | 1.0 when the subject is a user-facing service or carries observed 5xx or a failing synthetic; 0.5 when it is a dependency of one (§17); 0 otherwise |
| `D` | deviation | `min(1, |robustZ| / 6)` from §8; 0 when there is no baseline |

The label is derived from the score — `≥ 70` critical, `40…69` warning, `< 40` info — except that a detector may declare a floor (zero healthy targets, a synthetic down, a certificate expiring in under 7 days all floor at critical). `scoreTerms` stores the five numbers, and the problem page renders the arithmetic under a "Why this score" disclosure. Weights live in one exported constant; changing them is a one-line change and a test fixture update.

### 4.4 Error group

`{ id, fingerprint, fingerprintVersion, connectionId, scope, serviceId?, logSourceId, exceptionType, sampleMessage, normalizedMessage, topFrames[], firstSeenAt, lastSeenAt, status, lastDeploymentId?, occurrences (rollup table) }`

**Fingerprint (deterministic, version 1).**

1. Parse the event through the log source's field map into `{ level, type, message, stack }`.
2. Normalise the message, in this order: collapse whitespace; replace UUIDs with `<uuid>`, IPv4/IPv6 with `<ip>`, URLs with `<url>`, e-mail addresses with `<email>`, quoted strings with `<str>`, hex runs of 8+ characters with `<hex>`, any remaining digit run with `0`; trim; truncate at 300 characters.
3. Take the stack frames, drop those whose path matches `node_modules|vendor|site-packages|/usr/lib|<internal>`, keep the top 5, reduce each to `file:function` — **line numbers are dropped**, because they move with every edit and would split a group on a whitespace commit.
4. `fingerprint = sha256(type + '\n' + normalizedMessage + '\n' + frames.join('\n')).slice(0, 32)`.
5. No stack: step 4 over `type`, the normalised message and the log group name.

`fingerprintVersion` is stored on every group. Changing the algorithm bumps the version and produces new groups; it never silently re-merges history, and the group page says "regrouped in version N" when both exist.

**Status.** `new` (first seen inside the current comparison window), `regressed` (no occurrence for ≥ 24 h, then occurrences again), `ongoing`, `resolved` (no occurrence for 7 days), `muted` (a user decision, with a reason).

**"What's new".** Two windows of equal length, `[t−w, t)` and `[t, now]`, where `t` defaults to the user's last visit (a `user_marks` row) and falls back to 24 hours. Three computed sets: **new** (`firstSeenAt ≥ t`), **regressed** (as above), **spiking** (`occurrences ≥ max(10, 3 × baselineForThisHourOfWeek)`). The morning brief renders exactly those three sets and nothing else.

### 4.5 Deployment

`{ id, serviceId, provider, externalId, revision, image, imageDigest?, commitSha?, repositoryId?, status, startedAt, finishedAt?, previousRevision }`

Source: ECS `DescribeServices` deployments plus `DescribeTaskDefinition` for the image. A new row when the deployment id or the task definition revision changes. **`commitSha` is only known when the image tag is a commit sha or a tag the GitHub integration can resolve.** Without that, deployment correlation still works (the event exists and is timestamped), but code correlation does not, and the page says which of the two it has.

### 4.6 Investigation

`{ id, problemId, window, facts[], correlations[], hypotheses[], generatedAt, aiNarrative? }` — built by §7, stored so a postmortem can quote it months later.

### 4.7 Alert

A rule firing. `{ id, ruleId, dedupeKey, status: 'firing'|'acknowledged'|'resolved', problemId?, firstFiredAt, lastFiredAt, suppressedCount, acknowledgedBy?, resolvedAt?, deliveries[] }`. `dedupeKey = ruleId + '|' + (problemKey ?? conditionSubject)`: one open alert per key, always.

### 4.8 Incident

`{ id, title, status: 'investigating'|'identified'|'monitoring'|'resolved', severity, startedAt, resolvedAt?, serviceIds[], problemIds[], origin: 'auto'|'user', timeline[], postmortem?, dismissedAt? }`

### 4.9 Synthetic

`{ id, name, url, method: 'GET'|'HEAD', headers (secret values encrypted), intervalSeconds ∈ {60,300,900,3600}, timeoutMs ≤ 10000, expectedStatus[], followRedirects, maxRedirects = 5, assertions[], latencyThresholdMs?, serviceId?, enabled }` with runs `{ at, ok, status, dnsMs, connectMs, tlsMs, ttfbMs, totalMs, redirectChain[], bodyBytes, assertionResults[], tls{ issuer, subject, notAfter, daysRemaining, chainOk }, errorCode? }`.

### 4.10 SLO

`{ id, name, serviceId, type: 'availability'|'latency', objective (e.g. 99.5), window: '7d'|'30d', source, thresholdMs? }` — computed only from stored rollups (§9), which is why the collector exists.

### 4.11 How they relate

```
Service ──< Resource            Service ──< Deployment ──> Repository
   │                               │
   ├──< ErrorGroup                 └──< Synthetic ──< SyntheticRun
   ├──< SLO
   └──< Problem ──> Investigation ──< Fact
             │
             ├──> Alert ──< NotificationDelivery
             └──> Incident
```

Everything that happens is also appended to one **events** table (§9.3), which is the single source for the Activity feed, investigation facts, incident timelines and reports.

## 5. Detectors

A detector is a pure function over fetched or stored data that returns problems. The Stage 2 insight rules become detectors unchanged — same thresholds, same hysteresis (`evaluate.ts`, three consecutive datapoints, clearing margin) — and gain persistence. New detectors: `metric_anomaly` (§8), `error_group_new` / `error_group_spike`, `synthetic_down` / `synthetic_slow` / `cert_expiring`, `slo_fast_burn` / `slo_slow_burn`, `deployment_failed`, `cloudflare_origin_5xx`, `cloudflare_security_spike`, `log_volume_jump`, `integration_broken` (a connection that started failing), `delivery_failed` (a notifier that cannot deliver — a broken webhook must be visible, not silent).

Grouping across a fleet keeps the Stage 2 rule (amendment 8): more than three services of one cluster breaching the same detector collapse into one problem whose `subjectId` is the cluster and whose members are listed.

## 6. What is not achievable read-only

Written here once so no later page promises it.

1. **Per-endpoint latency and error rate.** ALB metrics carry no path dimension. Only the customer's own logs can answer it, through a declared field mapping (§18).
2. **Which commit is deployed.** Not in ECS unless the image tag carries a sha.
3. **Time spent in ALARM.** Needs `cloudwatch:DescribeAlarmHistory`, which is not in template version 1 (§22).
4. **Cache metrics.** ElastiCache needs new IAM actions (§22).
5. **Real user monitoring, browser timings, distributed traces.** Impossible without code in the customer's application. Out of scope forever (§25).
6. **Service-to-service calls.** Not observable without tracing. The dependency map only draws edges it can prove or that a user declared (§17).
7. **A database's maximum connections.** It lives in a parameter group and, on Aurora, is a formula. Peak connections only, as Stage 3 already ruled.
8. **A guaranteed fleet-wide SQL ranking.** Performance Insights returns per-instance top lists (Stage 3 amendment 2).
9. **Cloudflare adaptive datasets are sampled estimates** and every tile built on one says so (Stage 4).
10. **Synthetics measure from the OpsWatch host**, not from users' networks. The page says where the check ran.
11. **Task-level memory without Container Insights.**
12. **Anything older than CloudWatch keeps** (§9.1) for a connection added today.

## 7. The investigation engine

Runs automatically for every critical problem and on demand from any problem. Output is one timeline with three visually separate bands, in this order.

**Window.** `problem.firstSeenAt − 30 min` to `min(now, problem.resolvedAt + 15 min)`, capped at 6 hours.

**Observed facts.** Rows pulled from the events table and from bounded live reads, each with a source, a timestamp and a value: metric excursions (the series and the threshold crossed), alarm state transitions, deployments, ECS service events, RDS events (failover, reboot), target health changes, error groups that appeared or spiked, synthetic failures, log volume jumps, Cloudflare traffic and security changes, integration failures. A fact is never inferred.

**Correlations.** Pairs of facts within `Δt ≤ 15 min` that also have a declared relation: same service, service → dependency edge (§17), resource → service, zone → service. Each correlation states the measured Δt and the relation, in the form "the error rate rose 8 minutes after this deployment". It never says "because".

**Hypotheses.** A fixed, ordered catalogue. Each has preconditions over facts and correlations, a confidence, and one line saying what would confirm it.

| Hypothesis | Preconditions | Confidence |
|---|---|---|
| `deploy_regression` | a deployment on the subject service ≤ 30 min before the start, and (a new/spiking error group **or** error rate ≥ 3× the previous hour) | both → high, one → medium |
| `dependency_saturation` | a dependency has an open saturation problem overlapping the window | edge `observed` → high, `declared` → medium |
| `traffic_surge` | request count above baseline `z ≥ 3.5` at or before the start, resource metrics following | high when both, else low |
| `capacity_shortfall` | running tasks below desired, or unhealthy targets, without a deployment | high |
| `query_regression` | a Performance Insights digest whose load at least doubled against the same hour of the previous week | medium (per-instance top list only) |
| `upstream_edge` | Cloudflare origin 5xx rising with flat edge requests | medium |
| `certificate_or_dns` | a synthetic failing at the DNS or TLS phase | high |
| `noise` | the problem flapped ≥ 3 times in 24 h with no other fact | medium, and it proposes tuning the detector |

Hypotheses are ranked by confidence, then by how many facts support them. **AI, when enabled, may reorder them and write the narrative, and may not add a hypothesis that is not in this catalogue nor a fact that is not in the timeline.** The AI paragraph is a separate, labelled block.

## 8. Baselines and anomaly detection

No AI, no training, no new dependency.

**Series key.** `metricKey = sha256(connectionId|scope|namespace|metricName|sortedDimensions|stat)`, stored with its parts.

**Buckets.** Hour of week, 0…167, computed in the instance's configured time zone (`OPSWATCH_TIMEZONE`, default UTC) — an application's Monday 09:00 is nothing like its Sunday 03:00, and a single global mean hides both.

**Samples.** The collector writes 5-minute rollups. A bucket therefore receives 12 samples per week; the baseline reads the trailing **6 weeks**, up to 72 samples.

**Statistic.** Median and median absolute deviation, and the modified z-score:

```
robustZ = 0.6745 · (x − median) / MAD
```

- `MAD = 0` → fall back to the mean absolute deviation: `robustZ = (x − median) / (1.253314 · meanAD)`.
- Both zero (a constant series) → no verdict unless `x ≠ median`, in which case the verdict is `changed_from_constant` with `|z|` capped at 6.
- Thresholds: `|robustZ| ≥ 3.5` is an anomaly (the Iglewicz–Hoaglin cut), `≥ 5.0` is a strong anomaly and is a critical candidate.
- Direction is declared per metric: CPU, memory, latency, errors and lag are `above` only; request count and task count are two-sided.
- Sustained: three consecutive 5-minute points past the threshold, through the existing `breachActive`.
- Contaminated history is **not** excluded. MAD tolerates up to half the samples being bad, and excluding "known bad" windows would need state we would then have to trust.

**Minimum history.** A verdict needs **≥ 3 distinct weeks** of data for the metric and **≥ 24 samples in the bucket**. Below that the verdict is `insufficient_history` and renders as a chip reading "Baseline: 2 of 3 weeks — learning", with the number of weeks collected. It never renders as "normal", and it never produces a problem.

**Coarse fallback.** A metric with ≥ 3 weeks overall but a thin bucket falls back to eight day-part buckets (weekday/weekend × 00–06, 06–12, 12–18, 18–24) and the verdict is labelled `coarse`.

**Storage.** Baselines are recomputed hourly, incrementally, into `metric_baselines(metricKey, bucket, median, mad, meanAd, sampleCount, weeks, computedAt)` — 168 rows per metric, rewritten in one transaction.

Every anomaly problem carries its evidence: the value, the median, the MAD, the z, the bucket and the number of weeks behind it.

## 9. What is stored, how it is collected, what it costs

### 9.1 Why storing is unavoidable

CloudWatch keeps 1-minute data for 15 days, 5-minute for 63 days and 1-hour for 455 days, and data older than those cuts is only retrievable at the coarser period (verified on the AWS "Metrics concepts" page, §29). So a *metric* baseline could in principle be read from CloudWatch. It is not, for two reasons: `GetMetricData` is billed per metric requested, so recomputing six weeks of baseline for 250 series on every page load is both slow and expensive; and everything else the product promises — error groups, "what's new", deployments, synthetics, SLOs, incidents, the activity feed — has no AWS-side history at all. The store is the product.

### 9.2 The collector

`src/lib/collector/`, started from `instrumentation-node.ts`, in the application process.

- **One runner.** A `collector_lock(id=1, owner, heartbeatAt)` row. A process takes the lock when the heartbeat is older than 90 s and refreshes it every 30 s. This survives Next's double registration in development and a second container.
- **Jobs and schedule**, per usable connection × scope:

| Job | Every | What |
|---|---|---|
| `metrics` | 5 min | the core metric set, written as 5-minute rollups |
| `detect` | 5 min | run detectors over the fresh rollups, open/close problems, append events |
| `deployments` | 5 min | ECS deployments and task definition revisions |
| `inventory` | 30 min | clusters, services, instances, load balancers, target groups, alarms, log groups |
| `queries` | 30 min | Performance Insights top 25 digests per instance, stored hourly |
| `errors` | 15 min | one bounded Logs Insights query per opted-in log source |
| `logvolume` | 60 min | `AWS/Logs IncomingBytes` per group |
| `baselines` | 60 min | incremental recompute |
| `slo` | 60 min | SLO rollups and burn rates |
| `compact` | 24 h | rollup compaction, retention, database backup |
| `synthetics` | per check | 60 / 300 / 900 / 3600 s, independent of connections |

- **Bounded.** Every job has a cap (`metrics`: 500 series per cycle, `inventory`: 60 describe calls, `errors`: one query per source per cycle). A job that hits its cap records "covered N of M" exactly as the Stage 3 reports do, and the System status page shows it.
- **It must not block rendering.** better-sqlite3 is synchronous, so a long transaction stops the event loop. Writes go in transactions of at most 1,000 rows with a yield between batches, and no transaction may exceed 50 ms of work.
- **Off switch.** `OPSWATCH_COLLECTOR=off` disables it; a second container from the same image with `OPSWATCH_ROLE=collector` runs it alone. Both processes on one host share the WAL file safely; two hosts do not, and the documentation says so.

### 9.3 Tables

All additive. No existing table is rebuilt (Stage 4 amendment 13.1), and a WAL-safe backup runs before any schema migration (Stage 4 amendment 14.6).

| Table | Purpose |
|---|---|
| `users`, `user_marks` | accounts and per-user "last seen" marks |
| `api_tokens` | personal tokens for CLI and CI |
| `integrations` | non-AWS providers and their encrypted config (this is Stage 4's `provider_connections`, renamed and generalised) |
| `services`, `service_aliases`, `service_resources`, `service_dependencies`, `service_repositories` | the service model and its evidence-backed edges |
| `resources` | inventory with first/last seen |
| `metric_series`, `metric_rollups_5m`, `metric_rollups_1h`, `metric_baselines` | the time series and its baselines |
| `problems`, `problem_evidence` | §4.3 |
| `events` | the append-only spine: activity, investigation facts, incident timelines, reports |
| `error_groups`, `error_occurrences`, `log_sources` | §4.4 and §18 |
| `deployments` | §4.5 |
| `investigations`, `investigation_facts` | §7 |
| `alert_rules`, `alerts`, `notification_providers`, `notification_deliveries` | §15 |
| `incidents`, `incident_timeline` | §16 |
| `synthetics`, `synthetic_runs`, `synthetic_rollups_1h` | §14 |
| `slos`, `slo_rollups_1h` | §4.10 |
| `repositories` | §13 |
| `audit_log` | §21 |
| `search_index` | §21 |
| `collector_lock`, `collector_runs` | §9.2 and the System status page |

`events(id, at, connectionId?, scope?, kind, subjectType, subjectId, serviceId?, severity?, source, payload, dedupeKey?)`, indexed on `(at)`, `(serviceId, at)`, `(subjectId, at)`, unique on `dedupeKey` where not null.

### 9.4 Retention

| Data | Kept |
|---|---|
| 5-minute rollups | 14 days |
| 1-hour rollups | 13 months |
| observation events | 90 days |
| lifecycle events (problems, deployments, incidents, alerts) | 13 months |
| error occurrences | hourly 90 days, then daily 13 months |
| error groups, problems, incidents, deployments | kept, with an admin purge |
| investigation facts | 90 days |
| synthetic runs | raw 30 days, hourly 13 months |
| audit log | 13 months |
| AI transcripts | not kept, unless an admin turns it on; then 30 days |

Retention is configurable per family in Settings → Data & retention, with the resulting database size estimated on the page.

### 9.5 What it costs

The owner's account, as inventoried in the Stage 2 spec: about 30 ECS services, 9 Aurora instances, 4 ALBs, about 20 target groups.

Core metric set: ECS service 4 (CPU, memory, running, desired), RDS instance 6, ALB 6, target group 3 → `30·4 + 9·6 + 4·6 + 20·3 = 258` metrics per 5-minute cycle, 288 cycles a day → **74,300 metrics a day**. At the published USD 0.01 per 1,000 metrics for `GetMetricData`, that is **about USD 0.74 a day, USD 22 a month**, on top of what the pages already cost. Describe calls are not billed but are throttled; the cycle is capped at 60 of them per scope and reuses the existing 60-second cache.

Logs Insights is billed per gigabyte scanned and is the one that can surprise. Error collection is **opt-in per log group**, the page shows the group's `IncomingBytes` and the estimated daily scan before the switch is turned on, and `OPSWATCH_LOGS_BUDGET_GB_PER_DAY` (default 1) is a hard stop that disables the job for the day and raises a problem.

The Settings page shows yesterday's estimate and lets the admin set the metrics cycle to 5, 10 or 15 minutes. At 15 minutes the bill is a third and the baseline needs three times as long to become trustworthy; the page says exactly that.

### 9.6 SQLite, and when it stops being enough

Rows: 258 series × 288 buckets = 74k rows a day of 5-minute rollups, about 10 MB a day with indexes, so 14 days is roughly 140 MB. Hourly rollups are 6.2k rows a day, about 200 MB over 13 months. Everything else is small. **This account fits in well under 1 GB, and SQLite in WAL mode is the right choice.**

Move to PostgreSQL when any of these is true, and not before:

- more than about 5,000 metric series per instance (writes above one million rows a day),
- more than one OpsWatch replica, or replicas on different hosts — SQLite has one writer and the WAL is host-local,
- the data directory passes about 20 GB,
- read queries and the collector start contending: the System status page shows write-lock waits, and a sustained wait above 50 ms is the signal.

To keep that door open at near-zero cost: every query lives behind a repository in `src/lib/store/`, and the only SQLite-specific SQL allowed is `INSERT … ON CONFLICT` and `json_extract`, both of which PostgreSQL also has. No `better-sqlite3` type may appear above the store layer. A test enforces the second rule the way `module-boundaries.test.ts` enforces the client/server split. **PostgreSQL support is not built in this mission.**

## 10. Users, roles and authorization

### 10.1 Roles

| | Viewer | Member | Admin |
|---|---|---|---|
| Read pages, problems, errors, services, metrics, logs search | ✓ | ✓ | ✓ |
| Acknowledge and resolve problems and alerts | | ✓ | ✓ |
| Open, update and close incidents, write postmortems | | ✓ | ✓ |
| Create and edit synthetics, alert rules, SLOs, service mappings, log sources | | ✓ | ✓ |
| Run an investigation, ask AI, export a report | | ✓ | ✓ |
| Connections and integrations, credentials, test-connection | | | ✓ |
| Users, roles, API tokens of others, settings, retention, demo mode | | | ✓ |
| Audit log, system status | | | ✓ |

A viewer never sees a secret, a redacted config, an external id or the audit log. There is no per-service scoping in this mission; it is recorded as a later decision.

### 10.2 Where the check lives

Two entry points, one rule each, and a test that no file bypasses them.

- **Pages and server actions:** `requireUser(locale, permission)` in `src/lib/authz/`, replacing `requireAdmin`, called as the first statement — the Stage 1 A1 rule, unchanged in spirit.
- **API routes:** every handler is built by `apiRoute({ permission, schema, handler })` in `src/lib/api/route.ts`. The wrapper authenticates (cookie + Origin, or bearer), authorizes, validates, rate-limits and serialises errors. **A route handler cannot read the database before the wrapper has run, because the handler only receives its `{ actor, input, store }` after it has.**
- **Permissions are data.** One exported matrix `PERMISSIONS: Record<Permission, Role[]>`. Every check names a permission, never a role.
- **The boundary test** walks `src/app/api/**/route.ts` and `src/app/[locale]/(app)/**/{page,actions}.ts(x)` and fails on any file that does not call the wrapper or `requireUser`. This is the same technique that already keeps AWS out of client bundles, and it is the answer to "so it cannot be bypassed".

### 10.3 Migration from the single admin

Additive, and nobody is locked out.

1. Create `users` and copy the single `admin_user` row into it with `role = 'admin'`, same id, same password hash.
2. Add `user_id` to `sessions` and backfill it from `admin_user_id`. Existing cookies keep working — that is the point.
3. `admin_user` is left in place, unread, and removed in a later release, so a rollback loses nothing.
4. A first-run instance creates its admin as before; the setup page is unchanged.
5. New users are created by an admin and get a one-time invitation link, valid 72 hours, shown once on screen. It is mailed only if an e-mail notifier is configured. **Nothing about user management requires a mail server.**
6. The last remaining admin cannot be demoted or disabled; the interface says why.

## 11. Integrations

### 11.1 The abstraction

One registry in `src/lib/integrations/`. A provider declares:

```ts
{
  id: 'cloudflare' | 'github' | 'notify.email' | 'notify.slack' | 'notify.webhook' | 'ai',
  kind: 'source' | 'notifier' | 'assistant',
  configSchema: ZodType,           // zod 4
  secretFields: readonly string[], // never leaves the server
  capabilities: () => Capability[],
  test: (config) => Promise<CapabilityCheck[]>,
  redact: (config) => PublicConfig,
}
```

`CapabilityCheck` is the shape Stage 4 defined (`capability`, `scope`, `permission`, `status`, `errorCode`, `checkedAt`). AWS connections stay in `connections` with their own checklist component (Stage 4 amendment 14.2); every other provider is a row in `integrations`.

### 11.2 Credentials

- One encrypted blob per integration, AES-256-GCM with HKDF, crypto purpose `'integration-config'`. AWS access keys keep purpose `'access-keys'` and are never re-encrypted.
- A blob that does not decrypt marks the integration `unreadable` with an explicit message, exactly as `keysUnreadable` already does. It is never retried with a wrong key.
- **Redaction is a function, not a habit.** `redact()` returns only the fields the schema declares public. Three tests per provider: the redacted output contains no `secretFields`; a config seeded with a canary string never emits the canary through any API response, page prop or log line; and the provider module contains no write verb.
- Rotation: an admin may replace a secret; the field is write-only after saving, like the AWS secret key, and the change is audited.

Stage 4's amendment 14.5 still applies to provider error messages: identifiers are replaced before storage (`<zone>`, `<account>`), and a token-shaped string is never stored at all.

### 11.3 A missing integration in the interface

Three states, three renderings, no fourth:

- **Not configured** — a single card: what the integration is, the two or three things it would add to *this* page, and a link to Integrations. Never a blank page, never a hidden menu entry.
- **Configured but denied** — the capability checklist row, naming the exact permission and what is lost, as the AWS checklist already does.
- **Configured and broken** — a problem of kind `integration_broken` with the provider's normalised error code, so it appears where problems appear instead of only on a settings page.

`GET /api/v1/server` mirrors the same three states as feature flags for the mobile app.

## 12. The API

One API. The web keeps server components and server actions for pages; **the API and the pages read the same modules**, so nothing is implemented twice.

```
route handler ─┐
server action  ├─→ src/lib/read/*  (queries)  ─→ src/lib/store/*  (repositories) ─→ SQLite
server component ─┘   src/lib/write/* (commands)
```

A page never fetches its own API. A route handler never contains a rule. This is checked by the same boundary test: nothing under `src/app/api/` may import a provider client directly.

### 12.1 Authentication

- **Browser:** the existing session cookie, plus the existing `Origin` check on every mutating request. Unchanged.
- **Mobile and CLI:** `Authorization: Bearer <token>`, and no Origin check — a native client sends no Origin, and a bearer token is not attached automatically by a browser, so there is no CSRF path to close.
- Two token kinds, both rows in `sessions` / `api_tokens`, both stored as an HMAC, both revocable:
  - **Session token** from `POST /api/v1/auth/login` (same argon2id, same login throttle), `kind = 'bearer'`, 30-day rolling expiry, listed in Settings → Devices with last-used time.
  - **Personal API token** `opsw_<id>_<secret>`, created by a user, never exceeding that user's role, optionally read-only, optional expiry, shown once.
- Google sign-in for non-browser clients uses the PKCE + one-time-code flow the mobile design specified; the redirect URI is the app scheme, and the code is single-use with a 60-second life.

### 12.2 Shape

- JSON, camelCase, epoch milliseconds for every time.
- Lists: `{ items: T[], nextCursor: string | null }`. Details: the object itself. This is what the mobile contract already assumes; it is frozen here.
- Pagination is cursor-only: `?cursor=<opaque>&limit=<1…100, default 50>`, cursor = base64url of `{ k: sortKey, id }`, sort always `(sortKey, id)` so it is stable. No offsets.
- Filtering: documented per resource; repeated parameters are OR, different parameters are AND; `since` and `until` in epoch ms.
- Errors: `{ error: <snake_case code>, message?, details? }` with the existing status map — the current envelope, extended, not replaced.
- Every object carries `allowedActions: string[]`, computed from the caller's role. A client renders an action only when the server listed it. This is convenience, not security: the server checks again on the call.
- Localisation: every human-readable label is returned twice — `titleKey` + `values` for a client with the catalogue, and `title` already rendered in the locale from `?locale=` or `Accept-Language`. Mobile can do either.

### 12.3 Versioning

`/api/v1`. Inside v1 only additive changes: new endpoints, new fields, new optional parameters. Clients must ignore unknown fields, and the shared schemas are non-strict so they do. A breaking change ships `/api/v2`; v1 then keeps working for two minor releases and answers with `Deprecation` and `Sunset` headers. `GET /api/v1/server` reports `apiVersion` and the feature flags, so a client never has to guess.

### 12.4 Rate limits

Per token, then per IP, using the existing in-memory limiter: reads 600 per 5 minutes, mutations 60 per 5 minutes, `ai/ask` 10 per 5 minutes and 20 per hour per user, `logs/search` 20 per 5 minutes, login 5 per minute per IP (unchanged). Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; a 429 carries `retry_after` in seconds.

### 12.5 Frozen contract — the first endpoints

The mobile design put these at `/api/mobile/v1`. **The path is `/api/v1`**; the same handlers are also mounted at `/api/mobile/v1` until the mobile app's first release, then the alias is removed. That is one routing line, and it is the only concession.

`env` is the environment id, `"<connectionId>:<scope>"` where scope is an AWS region, a Cloudflare zone id, or `account`.

```
GET /api/v1/server                       — unauthenticated
{ product: "opswatch", version, apiVersion: 1, name?, demo: boolean,
  auth: { password: true, google: boolean },
  features: { health, brief, problems, errors, services, infrastructure, logs,
              alerts, incidents, synthetics, slos, deployments, investigations,
              repository, ai, search, favorites, environments, push } }

POST /api/v1/auth/login   { email, password } → { token, expiresAt, user }
POST /api/v1/auth/logout                      → 204
GET  /api/v1/me                               → { id, email, role, locale, allowedActions }

GET /api/v1/environments
{ items: [{ id, connectionId, scope, provider, label, kind: 'production'|'other',
            status: 'ok'|'degraded'|'failed' }], nextCursor: null }

GET /api/v1/health?env=
{ env, at, status: 'critical'|'warning'|'healthy'|'unknown',
  counts: { critical, warning, info },
  families: [{ family: 'ecs'|'rds'|'alb'|'alarms'|'synthetics'|'errors',
               status, affected, total,
               unavailable?: { reason: 'denied'|'throttled'|'error', code } }],
  topProblemId: string | null }

GET /api/v1/problems?env&status&severity&service&kind&since&cursor&limit
{ items: [Problem], nextCursor }
Problem = { id, key, kind, source, severity, score, status,
            titleKey, values, title, subject: { type, id, name },
            serviceId?, serviceName?, firstSeenAt, lastSeenAt, occurrences,
            acknowledgedBy?, acknowledgedAt?, resolvedAt?,
            hasInvestigation: boolean, allowedActions }

GET  /api/v1/problems/:id  → Problem & { scoreTerms: { s, b, t, u, d, weights },
                                         evidence: Evidence[], relatedIds: string[] }
POST /api/v1/problems/:id/acknowledge  { note? } → Problem

GET /api/v1/brief?env
{ env, since, generatedAt,
  newProblems: Problem[], resolvedProblems: Problem[],
  errors: { new: ErrorGroup[], regressed: ErrorGroup[], spiking: ErrorGroup[] },
  deployments: Deployment[], synthetics: { failing, total },
  sentences: [{ key, values }] }

GET /api/v1/errors?env&status&service&since&cursor&limit
ErrorGroup = { id, fingerprint, fingerprintVersion, exceptionType,
               sampleMessage, status, serviceId?, serviceName?,
               firstSeenAt, lastSeenAt, occurrences24h, trend: number[],
               allowedActions }
GET /api/v1/errors/:id → ErrorGroup & { topFrames: [{ file, function, inApp }],
                                        occurrencesByHour: [[atMs, count]],
                                        lastDeployment?: Deployment,
                                        code?: { repository, path, ref, lines } }
```

Those eight are frozen: field names and types do not change inside v1. Everything else on the mobile list (`services`, `infrastructure`, `logs/search`, `alerts`, `incidents`, `synthetics`, `slos`, `deployments`, `investigations/:id`, `repository/evidence/:id`, `ai/ask`, `search`, `me/favorites`, `me/devices`) ships in the phase that builds its feature, in the shapes of §4, and is advertised by a feature flag until then. **Push (`me/devices`) is declared `false` for this mission**: it needs FCM/APNs credentials and an account the owner has not created.

### 12.6 What belongs where, and what must never reach a client

- **Server only:** provider clients, credentials, the encryption key, the collector, detectors, the store, the AI tool implementations, `src/lib/read` and `src/lib/write`.
- **Shared package `packages/contract/`:** the zod schemas, the TypeScript types, the error-code union, the cursor helpers and the permission matrix. Source-only TypeScript, zod 4, no React, no Node built-ins, no `server-only`. It sits at the repository root, so the web app reaches it with a tsconfig path and the Expo app with a Metro `watchFolders` entry — **no npm workspace and no root `package.json` change**, which is what the mobile design asked for. The contract moves out of `apps/mobile/src/api/contract/` at the start of phase 3 and the server owns it from then on.
- **Never to any client, at any role:** a credential in any form, a decrypted config, an AI provider key, a token value after creation, another user's password hash, the SQLite path, the CloudFormation external id, and the audit log to anyone but an admin. There is also no endpoint that takes a caller-supplied region, URL or credential and calls a provider with it.
- **Repository hygiene for the shared tree:** the web `tsconfig.json`, `eslint.config.mjs`, `knip.json` and `.dockerignore` must exclude `apps/`, one line each, as the mobile merge note records.

## 13. GitHub

Read-only, one integration, no SDK: a `fetch` wrapper like the Cloudflare one, so the base URL can be redirected at a stub in tests and the "no write verb" test is a grep over one small file.

- **Credential:** a fine-grained personal access token with *Contents: Read* and *Metadata: Read* (and *Pull requests: Read* if the user wants PR links). Encrypted, write-only field, redacted everywhere.
- **Calls:** `GET /repos/{owner}/{repo}`, `/commits`, `/compare/{base}...{head}`, `/contents/{path}?ref=`. Nothing else, ever.
- **Limits:** 5,000 requests an hour for a token, and at most 100 concurrent requests shared with GraphQL (verified, §29). The budget is 60 calls an hour with a 1-hour cache; exceeding it degrades the panel, it does not retry.
- **Mapping:** `service_repositories(serviceId, repositoryId, pathPrefix?)`, declared by a user. OpsWatch *suggests* a match from the image name or the repository name and **never applies it automatically**.
- **Code correlation:** a stack frame `src/lib/foo.ts` resolves to `repository@ref` where `ref` is the deployment's commit when known, otherwise the default branch. The panel shows the file around the frame (±10 lines) and says which ref it came from — "shown from `main`, which may have moved since this error" — because a frame without a commit is a guess about line numbers.
- **Repository analysis never modifies anything.** No branch, no issue, no comment, no commit. The token has no permission to, the wrapper has no verb for it, and a test asserts both.

## 14. Synthetic monitoring

Checks run from the OpsWatch host, on the collector's schedule, using `node:dns`, `node:tls` and `fetch`. No new dependency.

Measured per run: DNS resolution time, TCP connect, TLS handshake, time to first byte, total, final status, the redirect chain, the body size, each assertion's result, and the certificate's issuer, subject, expiry and chain validity.

Rules:

- A check is `down` after **two consecutive failures** and `up` after one success — one blip is not an outage.
- Certificate expiry: a warning problem at 21 days, critical at 7. The certificate of every hop of the redirect chain is checked.
- Latency: a `synthetic_slow` problem when the median total time of the last five runs exceeds the threshold.
- Assertions: status in a set or range, body contains / does not contain / matches a regular expression evaluated against at most the first 256 KB, with a 50 ms regex timeout and a length cap on the pattern.
- **SSRF guard, because users type these URLs.** Scheme `http`/`https` only; ports 80, 443, 8080, 8443; the resolved address must be public — loopback, RFC 1918, link-local, unique-local and metadata addresses are refused, and the check is re-applied after every redirect; at most 5 redirects; at most 1 MB read; 10-second hard timeout. `OPSWATCH_ALLOW_PRIVATE_TARGETS=1` lifts the address rule for a home-lab user and is documented as such. There is no option anywhere that disables certificate verification.
- Headers may carry a secret (an API key for a health endpoint); secret header values are stored in the encrypted blob and are redacted in every view and every API response.

## 15. Alerts and notifications

### 15.1 Rules

`alert_rules(id, name, enabled, scope, condition, minSeverity, channels[], cooldownSeconds, createdBy)`.

Conditions, all evaluated by the collector on the data it just wrote:

| Condition | Parameters |
|---|---|
| `problem` | kinds?, minSeverity, serviceIds?, subjectTypes? |
| `metric` | metricKey, comparator, threshold, forMinutes (uses `evaluate.ts` hysteresis) |
| `anomaly` | metricKey, minZ (default 3.5) |
| `synthetic` | checkIds?, `down` or `slow` |
| `slo` | sloId, `fast_burn` or `slow_burn` |

**Automatic rules** are created at install, visible and editable, never hidden: "critical problems → in-app", "a synthetic goes down → in-app", "a certificate expires within 7 days → in-app", "notification delivery failed → in-app". Nothing is sent outside the instance until a notifier exists, so installing OpsWatch never surprises anybody's inbox.

### 15.2 Deduplication, cooldown, acknowledgement

- `dedupeKey = ruleId + '|' + (problemKey ?? conditionSubject)`. One open alert per key. A second fire updates `lastFiredAt`.
- Cooldown per rule, default 30 minutes. A fire inside the cooldown increments `suppressedCount` and sends nothing; the alert page shows how many were suppressed, so the silence is visible.
- Acknowledging stops notifications for that alert until it resolves and fires again. It records who and when.
- A resolution notice is sent once, and only if the firing notice was sent.

### 15.3 Providers

| Provider | Transport | Config |
|---|---|---|
| `notify.email` | SMTP through **nodemailer 10.0.10** — the only new runtime dependency in this mission | host, port, secure, user, password (secret), from, to[] |
| `notify.slack` | incoming webhook, `fetch`, Block Kit built server-side | webhookUrl (secret), channel label |
| `notify.webhook` | `fetch` POST | url, optional shared secret, custom headers (secret values) |

Delivery: 10-second timeout, no redirects, the same SSRF guard as synthetics, three attempts at 30 s / 2 min / 10 min, then the alert is marked `delivery_failed` and an `delivery_failed` problem is raised.

The webhook body is a stable versioned document:

```json
{ "schema": "opswatch.alert.v1", "event": "fired|resolved", "at": 0,
  "alert": { "id": "", "ruleName": "", "dedupeKey": "" },
  "problem": { "id": "", "kind": "", "severity": "", "score": 0,
               "title": "", "subject": { "type": "", "id": "", "name": "" },
               "serviceName": null, "firstSeenAt": 0, "evidence": [] },
  "url": "https://<instance>/en/problems/<id>" }
```

Signed with `X-OpsWatch-Signature: t=<unix>,v1=<hex>` over `t + "." + body` using HMAC-SHA256 and the shared secret, so a receiver can verify it. It never contains a credential, and never a raw log line beyond a 200-character redacted sample.

## 16. Incidents

- **Automatic creation:** two or more critical problems on one service within 15 minutes, or one critical problem lasting more than 15 minutes on a user-facing service. The incident links the problems and inherits the worst severity.
- An auto-created incident can be dismissed; dismissal suppresses auto-creation for that service for 2 hours and is recorded.
- **Timeline** = the events of the window (problems opening and resolving, deployments, alarm transitions, synthetic failures, notifications sent) plus status changes plus human notes, all timestamped, newest last.
- **Postmortem** is a Markdown document generated from the timeline: summary, impact with the measured numbers, timeline table, contributing factors (the investigation's hypotheses, still labelled as hypotheses), detection, resolution, follow-ups. It is editable, exportable as a file, and never published anywhere. With AI on, the prose is drafted and labelled; with AI off, the skeleton is filled with the facts and the headings stay.
- Markdown is rendered through the existing escaper (`src/lib/analysis/markdown.ts`), which already handles resource names and error text; raw HTML is never rendered.

## 17. Services, health and the dependency map

**Service Health page.** One service, one page: current status and its problems; availability and latency over the window from stored rollups; error groups with what is new; recent deployments with the change against the previous window; dependencies with their own status; synthetics and SLOs; the log groups mapped to it. It is the page the morning brief and every problem link into.

**The dependency map draws only edges it can prove.**

| Edge | Evidence | Confidence |
|---|---|---|
| ALB listener rule → target group → ECS service | `DescribeRules`, `DescribeTargetGroups`, service `loadBalancers` | observed |
| Cloudflare zone → service | a hostname in a listener rule matching a zone name | observed |
| ECS service → RDS instance | a Performance Insights `db.host` value matching an ENI address of the service's tasks, or a `db.user` the user mapped | observed (needs Performance Insights and `awsvpc`) |
| service → service | **only** when a synthetic proves it or a user declares it | declared |

There is no inference from names, and none from log text. Without tracing, service-to-service calls are generally not observable, and the map says so where it is thin rather than drawing a plausible line. Each edge carries `firstSeenAt`/`lastSeenAt`; an edge not seen for 7 days is dimmed and dropped after 30.

## 18. Database, cache and log intelligence

**Databases** extend what exists: per-instance metrics, Performance Insights top 25 digests stored hourly (so "this query is new this week" becomes answerable, which is the whole point of storing them), wait events, peak connections (never a percentage of a maximum we cannot read), replica lag, and `rds:DescribeEvents` entries — failovers, reboots, storage events — as facts in the timeline.

**Caches** means ElastiCache: CPU, evictions, hit ratio from `CacheHits`/`CacheMisses`, current connections, memory usage percentage, swap, replication lag. **This needs new IAM actions and a stack update by the owner** (§22). Until the stack is updated the page shows the "update your stack" card, not an empty grid.

**Logs** without an ingestion pipeline:

- *Volume and retention* from `AWS/Logs IncomingBytes` and `DescribeLogGroups` — no query cost.
- *Error extraction* — one bounded Logs Insights query per opted-in `log_source` every 15 minutes, feeding §4.4. The field map is per source (`format: json|regex`, fields for level, type, message, stack, route, duration), with presets for JSON logs and for the owner's own API format, stored in the database — **the mapping is stored, the log content is not**.
- *Slow endpoints* — Stage 3's endpoints page, now driven by the same `log_source` mapping, with p95 and error rate per route.
- *Pattern discovery* — CloudWatch Logs Insights has a `pattern` command; whether it is available and how it is billed on the owner's account is **unverified** (§29). The job tries it once per source, and falls back to OpsWatch's own fingerprinting when the query is refused. Either way the result is the same shape.

Every query states its estimated scanned bytes before it runs, the daily budget is a hard stop, and the Logs pages keep the existing 24-hour window limit.

## 19. SLOs and reports

**SLO arithmetic**, from stored rollups only:

- *Availability, ALB source:* good = `requests − (elb5xx + target5xx)`, total = `requests`, per 5-minute bucket.
- *Availability, synthetic source:* good = successful runs, total = runs.
- *Latency:* the share of 5-minute buckets whose p95 is at or below the threshold. This is a bucket-based approximation, not a per-request one, **because a read-only ALB gives no request histogram**, and the page says so in one sentence.
- Error budget = `(1 − objective) × window`. Burn rate = observed bad ratio ÷ `(1 − objective)`. Alerts at the standard multi-window rates: 14.4× over 1 hour (fast) and 6× over 6 hours (slow).
- An SLO whose window is less than a quarter collected shows "not enough history" with the share collected. It never shows a number it cannot stand behind.

**Reports** cover 24 hours, 7 days, 30 days or "since the last report", and read stored rollups, not AWS, so they are cheap, repeatable and comparable. Contents: availability and SLO status per service, problems opened and closed by severity, top error groups and what is new, deployments, synthetics, the worst resources, and every figure compared with the previous period of the same length. Rendered in-app, exportable as Markdown, and — when a notifier exists — sendable weekly.

## 20. Cloudflare, as enrichment

The Stage 4 connection work ships as designed (its `provider_connections` table becomes `integrations`). What changes is where the data goes:

- **Health:** a zone's request volume, error rate and cache ratio appear on the Service Health page of the service its hostname routes to.
- **Problems:** `cloudflare_origin_5xx` (origin 5xx rising while edge requests are flat) and `cloudflare_security_spike` are detectors like any other, with Cloudflare evidence.
- **Investigations:** Cloudflare facts — traffic drop, security event spike, cache ratio change — are timeline facts, so "the outage starts at the edge" becomes visible next to the AWS facts.
- **Dependency map:** zone → service edges.
- **Infrastructure → Zones & DNS** keeps a plain inventory page: zones, plan, the dataset limits discovered from the `settings` node, and the capability checklist.

Every tile built on an adaptive dataset carries the "estimated" marker Stage 4 requires, and window limits come from the `settings` node, never from a table in a document.

## 21. Audit log, search, demo mode, system status

**Audit log.** `audit_log(id, at, actorUserId|'system', actorKind, action, subjectType, subjectId, result, ip, userAgentHash, details)`. Written for sign-in and sign-out (including failures), user creation and role changes, integration create/update/delete/test, credential rotation, API token creation and revocation, alert rule and synthetic changes, settings and retention changes, demo mode toggles, purges, exports and downloads, and every AI question (who, provider, model, tool calls, token counts — not the content). Append-only: no code path updates or deletes a row; the retention purge writes its own entry. Admin-only, filterable, exportable.

**Global search.** One `search_index(entityType, entityId, title, keywords, scope, updatedAt)` table maintained by the collector and by every write path, queried with prefix matching. It covers services, resources, problems, error groups, incidents, synthetics, log groups, repositories, alert rules and static pages, and it filters by the caller's permissions. `/` and `Ctrl`/`Cmd`+`K` open it. FTS5 is noted as an optimisation for an instance above about 50,000 indexed rows; at this product's volumes the plain index is faster to build and easier to verify.

**Demo mode.** `OPSWATCH_DEMO=1`, or an admin toggle on an instance with no connection. A deterministic seeded dataset in a **separate SQLite file**, timestamps relative to now, a persistent "Demo data" bar on every page, `demo: true` in `GET /api/v1/server`. In demo mode the AWS, Cloudflare, GitHub, SMTP and AI clients are replaced by fixture clients that throw on any network call, and a test asserts it. Leaving demo mode never touches the real database.

**System status** (`/settings/status`, admin, and `GET /api/v1/system/status`): per job, the last run, its duration, what it covered, what a cap truncated and the next run; the lock owner; provider call counts and failures in the last hour; today's estimated AWS spend; database size and row counts per family; the migration version and the last backup; notification delivery failures; AI usage against its budget; version and build. Separately, `GET /api/health` returns `{ status, version }` and nothing else, for a reverse proxy.

## 22. AWS permissions: template version 2

New actions, and only these:

| Action | Unlocks |
|---|---|
| `cloudwatch:DescribeAlarmHistory` | time spent in ALARM, alarm transitions as investigation facts |
| `elasticache:DescribeCacheClusters`, `elasticache:DescribeReplicationGroups` | the Caches pages |

`TEMPLATE_VERSION` becomes 2. The mechanism already exists: connections on version 1 keep working, the accounts page shows "Update stack", and the two features above render their "update your stack" card instead of an empty page. Nothing else in the mission needs a new permission. `rds:DescribeDBParameters` was considered for connection saturation and **rejected**: on Aurora the maximum is a formula, so the check would be wrong more often than right.

## 23. AI

Off by default. When off, there is no AI menu entry, `features.ai` is `false`, investigations render their three bands without narration, postmortems use the skeleton, and repository analysis is the code excerpt alone.

**Provider abstraction.** `src/lib/ai/providers/`: `anthropic` and `openai-compatible` (which covers OpenAI, a local Ollama or vLLM, and any gateway that speaks the same shape). Plain `fetch`, one adapter each, **no SDK** — the same reasoning as Cloudflare: base-URL redirection for tests, and a small surface to audit. Config: provider, base URL, model, API key (secret), max output tokens, request timeout 60 s, a monthly token budget and the price per million tokens the user enters themselves, because published prices move. The test-connection action sends a one-token completion and stores the result as a capability check.

**The assistant is a tool caller, not a prompt stuffer.** At most 6 tool calls per question, 60 seconds total, no tool result above 32 KB, total context below 100 KB. Every tool is server-implemented, read-only, and scoped to the asking user's role and environment:

| Tool | Returns |
|---|---|
| `list_problems({status, severity, serviceId, since, limit ≤ 20})` | problem summaries |
| `get_problem({id})` | the problem with its evidence and score terms |
| `list_errors`, `get_error({id})` | groups, normalised message, top frames — never raw log lines |
| `get_service({id})` | health, dependencies, recent deployments |
| `get_metric({seriesRef, range})` | at most 60 downsampled points plus the baseline verdict |
| `list_deployments({serviceId, since})` | deployments |
| `get_investigation({problemId})` | facts, correlations, hypotheses |
| `list_incidents`, `get_slo`, `list_synthetics` | small summaries |
| `search_logs({logSourceId, query, since, limit ≤ 20})` | log lines — **requires an explicit per-question opt-in**, because it leaves the instance and it is billed |
| `get_code({repositoryId, path, ref, startLine, endLine})` | at most 200 lines, only from a repository mapped to a service |

**What may leave the instance:** the output of those tools, after a redactor that replaces AWS account ids with `<account>`, e-mail addresses with `<email>`, and infrastructure identifiers (external ids, token-shaped strings, the account segment of an ARN) with placeholders, and refuses to serialise any field marked secret. A canary test asserts that a credential planted in the store never appears in a prompt. **What never leaves:** credentials, tokens, the encryption key, decrypted configs, arbitrary provider responses, and anything the user did not opt into.

Answers are labelled as AI-generated, cite the objects they used as links into the product, and are never written into a problem, an incident or a postmortem without a human pressing a button.

## 24. Quality, and how it is kept

- **i18n.** English and French at parity, enforced by the existing test. No user-facing string in code. New namespaces: `Problems`, `Errors`, `Services`, `Reliability`, `Integrations`, `Assistant`, `Admin`. Severities, statuses and detector kinds are enums rendered through key maps; a sentence is never concatenated.
- **States.** Every list and card has four: loading (skeleton, as today), empty (what would fill it), error (what failed and what is still true), and partial (covered N of M, the Stage 3 pattern).
- **Navigation.** Breadcrumbs everywhere; every filter, range, sort and cursor in the URL, so a page is shareable; `?env=` persists across pages.
- **Accessibility.** Keyboard reachable, visible focus, WCAG AA contrast, colour never the only signal, `prefers-reduced-motion` respected, live regions for the auto-refresh, a check at 360 px for every new page.
- **Performance budgets**, measured, not hoped: a page served from the store renders in under 800 ms at p95; an API list answers in under 300 ms at p95; no page issues more than 40 SQL queries (asserted by a counting store wrapper in tests); a collector cycle finishes in under 60 s per connection × scope; no new client-side library.
- **Security review** at the end, covering: authorization on every new route and action, the SSRF guards, secret redaction and its canary tests, the append-only audit log, token hashing and revocation, Markdown rendering, rate limits, demo mode's network refusal, and the dependency delta (one package).
- **Repository rescan:** lint, typecheck, build, knip, duplication, the module-boundaries test, the client-messages test, the i18n parity test, and the new authorization-boundary test, all green.

**Tests.** Unit (Vitest): the problem key and lifecycle, the score with fixtures at each boundary, the error fingerprint (normalisation cases, frame filtering, version bump), the baseline maths (MAD, the zero-MAD fallbacks, the minimum-history verdicts), the detectors at and around every threshold, cursor pagination, the authorization matrix, redaction canaries, the webhook signature, the SSRF guard, the SLO arithmetic, the collector's caps. End-to-end (Playwright against moto, plus the Cloudflare and GitHub stubs and a local SMTP sink): a seeded problem appears, is acknowledged and resolves; an error group appears and shows "new"; a synthetic fails and raises a problem; an alert deduplicates and respects its cooldown; a viewer cannot acknowledge; a bearer token works and a revoked one does not; demo mode makes no network call.

## 25. What OpsWatch will not do

- No agent, SDK or library installed in a customer application. No real user monitoring.
- No distributed tracing, and no pretence of it: the dependency map draws only proven or declared edges.
- No log ingestion pipeline. OpsWatch queries the customer's CloudWatch under a budget; logs never move into OpsWatch, only fingerprints, counts and bounded samples.
- **No write action on customer infrastructure, ever.** No restart, no scale, no rollback, no DNS change, no GitHub write, no Cloudflare write. The IAM catalogue contains no write action and a test keeps it that way.
- No hosted multi-tenant SaaS, no billing, no per-service role scoping in this mission.
- No on-call rotation, no paging, no SMS or telephone.
- No machine-learned anomaly detection, no model training, no GPU.
- No auto-remediation, and no AI that acts.

## 26. Sequencing

Every phase ends with the product working, its tests green, its strings at parity and its pages responsive. Quality is not a phase at the end; the repository-wide passes are.

| Phase | What ships | Visible value |
|---|---|---|
| **1. Problems** | users and roles migration, WAL-safe backup, the store and the collector (metrics, detect, inventory, deployments), the Problem object with score and evidence, Problems list and detail, Overview → Health and Problems, acknowledgement, System status | Day one: OpsWatch stops showing dashboards and starts saying what deserves attention, with the arithmetic on screen |
| **2. Errors and Services** | services from ECS, log sources and field maps, error groups and fingerprints, what's new, Service Health, Morning brief, Activity | "What broke since yesterday" is answerable |
| **3. API and baselines** | `/api/v1` with the frozen endpoints, bearer and personal tokens, `packages/contract`, rate limits, baselines turned on (they have been collecting since phase 1), anomaly detector | The mobile agent is unblocked; the product notices unusual behaviour |
| **4. Alerts and synthetics** | alert rules, dedup, cooldown, acknowledgement, e-mail, Slack, webhook, synthetics with DNS, TLS and certificate expiry | OpsWatch tells you without you looking |
| **5. Investigations and incidents** | the investigation engine, deployment correlation, GitHub integration and code correlation, incidents and postmortems | "Why is it wrong" answered in one screen |
| **6. Reliability and depth** | SLOs, reports, Cloudflare enrichment, dependency map, database/cache/log intelligence, template version 2 | The long tail of the owner's list |
| **7. Assistant and polish** | AI provider abstraction, Ask OpsWatch, global search, demo mode | Optional by construction |
| **8. Passes** | performance audit, responsive pass, security review, repository-wide best-practice rescan, documentation, self-hosting guide | Ready to publish |

**Cut order, last cut first:** AI and Ask OpsWatch → Cloudflare enrichment → the dependency map → SLOs and reports → cache intelligence → GitHub code correlation → synthetics. **Never cut:** the store, the Problem engine, error intelligence, the API and its contract, roles, and the security work. If the mission stops after phase 2, OpsWatch is already a better product than it is today; if it stops after phase 4, it is a complete small one.

## 27. Configuration

New environment variables, all optional, all documented in `.env.example` with the same tone as the existing ones:

| Variable | Default | Purpose |
|---|---|---|
| `OPSWATCH_COLLECTOR` | `on` | `off` disables the background collector in this process |
| `OPSWATCH_ROLE` | `app` | `collector` runs the jobs and serves nothing |
| `OPSWATCH_TIMEZONE` | `UTC` | the time zone of the hour-of-week baselines and the morning brief |
| `OPSWATCH_LOGS_BUDGET_GB_PER_DAY` | `1` | hard stop on Logs Insights scanning |
| `OPSWATCH_METRICS_INTERVAL_MINUTES` | `5` | 5, 10 or 15 |
| `OPSWATCH_ALLOW_PRIVATE_TARGETS` | unset | lets synthetics and webhooks reach private addresses |
| `OPSWATCH_DEMO` | unset | demo mode |
| `OPSWATCH_GITHUB_API_URL`, `OPSWATCH_AI_BASE_URL` | official | test stubs only, like the AWS and Cloudflare ones |

Self-hosting: `docker compose up` still works with one container; the compose file gains a commented second service for a dedicated collector, and the README states the one-host rule for SQLite.

## 28. Definition of done

- A problem opened by a detector survives a restart, keeps its identity, shows its evidence and its score arithmetic, and can be acknowledged by a member and not by a viewer.
- An error group has a stable fingerprint across restarts and across a whitespace-only deployment, and the morning brief separates new, regressed and spiking.
- A baseline refuses to give a verdict before three weeks and says how far along it is.
- The eight frozen endpoints answer with the documented fields, under bearer authentication, with cursor pagination and the documented error envelope, and the mobile app runs against them.
- Roles are enforced by the wrapper and the boundary test fails when a new route forgets it.
- A synthetic detects a certificate expiring in six days and raises a critical problem; the same check refuses a URL resolving to a private address.
- An alert deduplicates, cools down, acknowledges and delivers to Slack, with a visible failure when it cannot.
- With AI off, every page listed in §3 still answers its question.
- Lint, typecheck, build, knip, unit and end-to-end suites are green; English and French are at parity; every new page is usable at 360 px and by keyboard.

## 29. What could not be verified

1. **CloudWatch Logs Insights `pattern`** — availability across accounts and its billing behaviour were not checked against the documentation. §18 tries it once and falls back to OpsWatch's own fingerprinting, so nothing depends on it.
2. **CloudWatch Logs Insights price per gigabyte scanned** — the figure varies by region and was not read from the pricing page during this design. The budget mechanism does not depend on the number; the documentation must carry the correct one before publication.
3. **`GetMetricData` at USD 0.01 per 1,000 metrics** — carried over from the Stage 2 spec, not re-verified here. Every cost figure in §9.5 scales linearly from it.
4. **ElastiCache metric names** for the hit ratio and memory usage were written from memory and must be checked against the AWS namespace documentation before the Caches page is built.
5. **`better-sqlite3` FTS5 availability** in the shipped build — untested, which is why §21 uses a plain index and treats FTS5 as a later optimisation.
6. **Expo Metro resolving `packages/contract` without a workspace** — the mechanism (`watchFolders` plus a tsconfig path) is standard, but it was not run here. The mobile agent should confirm it on their first import; the fallback is a copied file with a parity test.
7. **nodemailer 10.0.10** — the version was confirmed with `npm view`; its licence and transitive dependencies were not reviewed and must be before it is added.
8. **Everything Stage 4 listed as unverified about Cloudflare** stays unverified and is inherited unchanged.
9. **The owner's real account** — none of the new detectors, budgets or baselines has been run against it. The figures in §9.5 come from the Stage 2 inventory, not from a measured run.
10. **The mobile design's assumptions** were read from its document, not from running code; `apps/mobile` currently contains a bare Expo scaffold.

## 30. Decisions the owner should confirm

1. Publishing the repository is still blocked: `git push` was refused by the session's permission classifier and nothing has been pushed. The owner pushes or grants the permission.
2. Template version 2 means a stack update in their account. Caches and alarm history stay dark until they do it.
3. About USD 22 a month of `GetMetricData` for the collector at a 5-minute interval, before any Logs Insights spending. A 15-minute interval costs a third and learns three times slower.
4. Which log groups may be queried for errors, and with what daily budget.
5. Whether they want a second container for the collector, or one process doing both.
6. Whether e-mail notifications are wanted at all — it is the only new dependency in the mission.

## 31. Owner decisions and the mobile contract (binding; override everything above where they conflict)

### 31.1 History is off by default, and storage is pluggable

The owner's ruling: a fresh installation must never add AWS polling cost without an explicit action, and no single storage technology may be baked into the product.

- **Settings → Data & History.** Historical collection is **disabled by default**. While it is off there is no recurring polling, and every live page keeps working exactly as today. The page states plainly which capabilities stay limited without history: baselines and anomaly detection, "what's new", SLOs, incident timelines, long-term reports and cross-provider correlation.
- **Interval**, when enabled: 1, 5, 10, 15, 30 or 60 minutes, or a custom value. No hardcoded default beyond the form's initial suggestion. Each choice shows its consequence in one line, on both axes: precision gained, AWS requests added.
- **Estimate before enabling.** From the discovered resources, the selected categories and the chosen interval, show the cycles per month, the metrics requested per cycle and the resulting CloudWatch cost, labelled as an estimate and never as a bill.
- **Categories.** Collection is granular: infrastructure metrics, application metrics, database metrics, cache, logs, errors, synthetic results, deployments, problems, incidents, alert history. Presets Minimal, Standard, Detailed and Custom.
- **Storage abstraction.** Collectors write through one `HistoricalStorageProvider` interface; no business logic, page or API route may reference a concrete store. Implementation order, and it is a priority order, not a wish list: the interface itself, then an excellent default provider on the OpsWatch database, then local files, then Elasticsearch or OpenSearch, then the documented extension point, then the optional semantic layer. Anything beyond that only if time remains. A mediocre adapter is worse than none.
- **Local files** provider: a documented, compressed, rotated layout under a configured directory, with retention, never millions of small files.
- **PostgreSQL** is designed for but implemented only if the default provider and the local one are solid first; the schema is time-oriented from the start so it can be added without touching collectors.
- **Semantic indexing is optional and off by default**, never the primary store for metrics. It indexes text that benefits from similarity: errors, logs, problems, incidents, postmortems, repository context. Everything else must work with it off.
- **Different data may live in different providers.** The first interface offers presets; an advanced section allows per-category routing.
- **Retention and downsampling** are configured per provider: 24 hours to one year, unlimited or custom, with recent data at full resolution, older data hourly, oldest daily, keeping minimum, maximum, average, count and error count. Cleanup is a visible job; nothing is deleted outside the configured rule.
- **Prefer CloudWatch on demand.** Persist only what OpsWatch genuinely needs of its own: baselines, anomaly history, problems, incident timelines, SLO calculations, cross-provider correlation, long-term reports and anything beyond provider retention. Do not duplicate AWS data for its own sake.
- **Storage health belongs in System Status**: provider, connection, size where known, oldest and newest record, ingestion state, failed writes, retention job, semantic index.
- **Portability**: export, backup, restore and migration between providers, with the on-disk formats documented. No lock-in.
- **Security**: provider credentials stay server-side, encrypted at rest, never logged, never returned by the API, never reachable by a mobile client. External endpoints are validated against SSRF and TLS verification stays on.
- The API and both applications are storage-agnostic: changing provider must never change a client.

### 31.2 CloudFormation template version 2: prepared, not deployed

- Version 2 adds only the least-privilege read-only actions for CloudWatch alarm history and ElastiCache discovery and metrics.
- OpsWatch **must not** deploy or update any stack, and must not touch any AWS resource. The owner updates their stack themselves, later.
- Version 1 installations keep working. Nothing that exists today may become dependent on the new permissions.
- When a permission is missing, the affected page says which feature is unavailable and how to upgrade, in the same style as the existing permission checklist.
- The difference between version 1 and version 2, and the upgrade procedure, are documented.

### 31.3 The API and the mobile contract

Agreed with the mobile agent, and binding for the server:

- **One API at `/api/v1`.** No mobile-specific path and no alias, since they are switching before their first release. Browsers keep the session cookie; other clients send `Authorization: Bearer`. CORS stays off.
- **Conventions**: times are epoch milliseconds; a value that could not be measured is `null`, never `0`; lists answer `{ items, nextCursor }` with opaque cursors keyed on a stable sort key and id pair, so a new row never makes a page skip or repeat; errors answer `{ error, message?, action?, code? }` in snake case, carrying the AWS action and code so a client can say which permission is missing; severity is `critical`, `warning` or `info`; every actionable object carries `allowedActions`; every data call takes `?env=<environment id>`, where an environment is a connection and region pair.
- **`GET /api/v1/server`** is unauthenticated and returns the product, version, API version, the enabled authentication methods and a feature flag per capability, so a client hides what the server cannot do. Push is `false` for this mission.
- **Versioning**: additive changes only inside v1; a breaking shape change means `/api/v2`.
- **Problem detail** embeds a summary of its evidence and also exposes `GET /api/v1/problems/:id/evidence` for the full set, so a client can choose.
- **Logs** gain `DELETE /api/v1/logs/search/:id` to release a running Logs Insights query, mirroring the web route.
- **`packages/contract`** is the single source of truth and exports the zod schemas themselves, not only types, because the mobile client validates every response at runtime. It imports nothing from Node, Next or any server-only module. The mobile agent keeps a local copy until the package lands on main, then switches and adds a parity test.
- **Security requirements accepted in full**: if Google sign-in is ever extended to mobile, `/auth/google/start` accepts only an exactly allow-listed redirect URI and the application receives a server-minted one-time code bound to its PKCE challenge, never Google's own code; bearer tokens carry an audience so a mobile token can never be replayed as a browser session cookie or the reverse; bearer tokens have an absolute lifetime ceiling above the rolling window, and sessions can be listed and revoked individually so a lost phone is cut off without rotating `OPSWATCH_SECRET`; the login route keeps the same throttle as the web form.
- **Root tooling**: the mobile agent lands the four one-line exclusions for `apps/**` in the TypeScript, ESLint, Docker and knip configurations on their branch; the server side does not duplicate them.

## 32. One contract for web, mobile and CLI (binding)

The owner restated it: no mobile API, one domain and one API, and stable contracts for health, morning brief, problems, errors, services, alerts, incidents, synthetics, SLOs, deployments, repository evidence, the AI assistant, notifications, user preferences, authentication and authorization.

1. **`packages/contract` is the single source of truth**, and it is seeded from the mobile agent's existing `apps/mobile/src/api/contract.ts`, which already covers all sixteen areas with zod 4 schemas. Adopting their file rather than writing a second one removes the only real risk here, which is two contracts drifting. The package exports the schemas themselves, not only the inferred types, since the mobile client validates every response at runtime. It imports nothing from Node, Next, the database or any server-only module, and a unit test enforces that.
2. **The server validates its own responses against the same schemas** in development and in tests, so a route cannot drift from the contract silently. A route handler that returns a shape the schema rejects fails the test suite rather than the client.
3. **OpenAPI is generated, never hand-written.** `zod-openapi` 6.0.2 (peer dependency zod 4, which is already installed) turns the same schemas into an OpenAPI document, served at `/api/v1/openapi.json` and rendered by a small documentation page. A test asserts every implemented route appears in the document, so documentation cannot rot.
4. **Business logic lives in domain services** under `src/lib/**`, called by both the API routes and the server components. A page may not hold logic a route cannot reach. When an existing page holds such logic, it moves into a service as that area is touched, not in one large refactor.
5. **Reading the mobile branch is part of the routine.** Before each phase checkpoint, read `feature/mobile` in its own worktree without merging or modifying it, compare its contract file with `packages/contract`, and record any mismatch in the ledger with a decision: serve what mobile expects, or tell them what changed and why. The same check runs once more before the mission is declared finished.
6. **Nothing that reaches a client may carry a credential**, and the contract package is the place where that rule is visible: no field in it holds a token, a key or a secret, and the review of every new endpoint checks that again.

---

## 33. Peer review rulings (binding, 2026-09-18)

A two-reviewer blind debate on this document returned thirteen findings and dismissed none; eleven were found independently by both reviewers. The owner is away and cannot arbitrate, so each finding is ruled on here. These rulings override anything earlier in the document that contradicts them.

### 33.1 The mobile contract wins, field by field

**Finding.** The shapes frozen in §12.5 and §31.3 do not match `apps/mobile/src/api/contract.ts`: health carries `generatedAt`, `status`, `counts.{critical,warning,healthyServices,totalServices}`, a full `topProblem`, `activeAlerts`, `synthetics` and `changes`, where §12.5 has a four-field summary; the mobile `problemSummary` has `title/category/service?/resource?/trend` and no `key` or `score`; `serverInfo` has no `demo`.

**Ruling.** The mobile file is the source of truth for every field it defines. §12.5's shapes are withdrawn and replaced by `packages/contract`, seeded verbatim from that file. Where the server must expose something the mobile contract lacks, it is **added** as an optional field, never as a rename or a removal, and the addition is written into `packages/contract` and announced to the mobile agent in the same commit. Three additions are already known and are approved here: `serverInfo.demo` (boolean, defaulting to false), `problemSummary.key` (the dedupe key, needed for deep links and for acknowledgement to be idempotent) and `problemSummary.score` (the integer severity behind `category`, needed so web and mobile sort a list the same way). A test parses a recorded response of every implemented endpoint against the contract schemas, so a drift breaks the build rather than the mobile app.

*Cost if wrong:* we carry a field mobile ignores. That is cheaper than a shape mobile rejects at runtime.

### 33.2 Live problem state is not historical data and is never off

**Finding.** §31.1 lists "problems" and "incidents" among the togglable history categories, while §4.3 and §16 make them persisted lifecycle state and §26 makes them the day-one headline.

**Ruling.** The switch is split in two, and §31.1 is read as covering only the second half.

- **Live problem state** — the open problem, its dedupe key, `firstSeenAt`, `lastSeenAt`, `acknowledgedAt`, `resolvedAt`, `flapCount`, `previousProblemId`, the current evidence bundle, and the same for incidents — lives in the OpsWatch database, is always on, is not a storage-provider concern, and costs nothing extra in AWS because it is written from data the page already fetched. Retention is bounded instead: resolved problems are kept 30 days, then deleted.
- **Historical retention** — problem timelines beyond that window, occurrence counts over months, trend charts — is a history category, off by default, and goes through the provider abstraction.

A fresh install therefore shows a populated Problems page on first load with history disabled, which is what product rule 6 requires.

*Cost if wrong:* a fresh instance holds a few megabytes of problem rows nobody asked for.

### 33.3 SSRF: pin the address, never let the client re-resolve

**Finding.** §14's guard validates a resolved address and then hands the URL to `fetch`, which resolves again at connect time. A low-TTL record that answers public once and `169.254.169.254` next passes the check and reaches the metadata service.

**Ruling.** Validation and connection must use the same address. Resolve the hostname once, reject every non-public answer, then connect to the pinned address through an undici agent whose `connect` uses a `lookup` that returns only that address, while the `Host` header and TLS SNI keep the original hostname so certificate validation still means something. Redirects are not followed by the client; each hop is re-validated and re-pinned by our own code, with a cap of three. This applies to every outbound call an operator can aim: storage providers (§31.1), webhooks and notification targets (§15.3), Cloudflare and GitHub endpoints when a base URL is configurable, and any AI endpoint override. Tests: a hostname whose second resolution is link-local must fail to connect, and a redirect to a private address must be refused.

*Cost if wrong:* none worth weighing. This is the finding with a real exploit behind it.

### 33.4 The collector lock is one atomic statement

**Finding.** §9.2 describes read-then-write lock acquisition, which two processes can both win.

**Ruling.** Acquisition is a single conditional update — `UPDATE collector_lock SET owner = ?, heartbeat_at = ? WHERE id = 1 AND (heartbeat_at < ? OR owner = ?)` — and the caller proceeds only if it changed exactly one row. The heartbeat refresh carries `AND owner = ?` so a process that lost the lock while paused cannot resurrect it; a refresh that changes no row aborts the cycle in progress. A test starts two claimers against the same database and asserts exactly one wins and the loser runs nothing.

*Cost if wrong:* duplicated rollups and a corrupted `flapCount`, which is exactly what this prevents.

### 33.5 Auto-resolve requires evaluated-and-clear, not silence

**Finding.** A problem whose subject was skipped by a capped cycle resolves itself after three cycles although the condition never cleared.

**Ruling.** Every detector cycle records, per subject, one of three outcomes: fired, evaluated-and-clear, or not-evaluated. Auto-resolve counts only evaluated-and-clear, three consecutive and at least fifteen minutes apart in wall-clock terms; not-evaluated resets nothing and counts toward nothing. A problem whose subject has not been evaluated for an hour is shown as stale in the interface rather than resolved, because a monitoring tool that quietly closes what it stopped looking at is worse than one that admits the gap.

*Cost if wrong:* a problem stays open longer than it should, which is the safe direction.

### 33.6 Cursors run on an immutable key

**Finding.** Paging by `lastSeenAt` or `score` skips rows whose key moves between pages.

**Ruling.** Every cursor axis must be immutable for the life of a row. Lists page on a monotonic `seq` (an autoincrement assigned at insert) with the row id as tiebreak, and `firstSeenAt` where a time axis must be shown. Severity and recency remain **sort options applied inside a page**, never cursor axes; a client that wants the worst problems asks for a bounded top-N endpoint, which returns a complete ranked set with no cursor at all. `§12.2` is amended accordingly, and the contract marks which endpoints are cursored and which are bounded.

*Cost if wrong:* a ranked list is capped at its top-N instead of scrolling forever. Acceptable: nobody scrolls page nine of a problem list.

### 33.7 Severity floors cover the newly discovered service

**Finding.** A user-facing service that fails minutes after its first deploy scores 51 — "warning" — because `U` and `D` default to zero and `B` to 0.34 before any dependency edge or baseline exists.

**Ruling.** Two changes. First, absence of evidence stops being scored as evidence of absence: when a subject has no dependency edge **and** was first seen less than two hours ago, `U` and `B` are not zero-filled; the score is computed over the known terms and rescaled by the weight actually available, so a fresh subject is judged on what we can measure rather than punished for what we cannot. Second, an explicit floor: a detector that reports critical on a subject whose failure is total — zero running tasks, zero healthy targets, every request failing — produces at least 70 regardless of the formula. The existing floors (zero healthy targets, synthetic down, certificate under seven days) stay. Each floor gets a test with the worked example that produced it.

*Cost if wrong:* an occasional over-loud critical on a service nobody depends on. The opposite error hides an outage during a deploy, which is when it matters most.

### 33.8 Fleet collapse has explicit transitions

**Finding.** §5's collapse rule introduces a cluster-shaped `subjectId` that §4.3 does not allow, and says nothing about the per-service problems already open at the boundary.

**Ruling.** `subjectId` gains a `cluster` kind, listed in §4.3. Collapse and expansion are lifecycle transitions, not rendering:

- On the fourth service breaching one detector in a cluster, a fleet problem opens with its own dedupe key, and the individual problems are **linked to it and marked grouped**, not resolved. They keep accruing evidence; the list shows the fleet problem and hides its children behind it.
- When the count falls to three, the fleet problem resolves and its children un-group; because they were never closed, their `firstSeenAt`, occurrence counts and acknowledgements survive intact.
- An acknowledgement on the fleet problem applies to its current children and to any that join while it is open; an acknowledgement on a child does not silence the fleet.
- Hysteresis: expansion needs two consecutive cycles at three or fewer, so a fleet that oscillates around the boundary does not flap.

*Cost if wrong:* a cluster-wide outage shows one row too many or one too few for one cycle.

### 33.9 §26 defers to §31.1 for storage sequencing

**Ruling.** §26's phase table is amended by one line: the storage work it schedules is the interface plus the OpsWatch-database provider and nothing else. Local files, OpenSearch and every further provider sit after the last phase-1 feature and are cut before any phase-2 feature. The priority order in §31.1 governs; §26 governs everything else.

### 33.10 The provider interface states its guarantees

**Ruling.** `HistoricalStorageProvider` is not just method names. A conforming provider must: accept writes keyed by an idempotency key — `(category, subjectId, intervalStart, resolution)` — such that writing the same batch twice leaves the same state, so a crash mid-batch is recovered by replay; make a batch visible all-or-nothing to readers; return, for any read, the watermark up to which data is complete, and never a partial interval without saying so; and tolerate a writer clock ahead or behind by rejecting timestamps outside a stated skew rather than storing them. Detectors read at or below the watermark, so an eventually-consistent backend can never open a problem from half a cycle. A provider conformance test suite runs against every provider, including the default one, and a provider that cannot pass it is not shipped.

### 33.11 The hypothesis catalogue is enforced in code

**Ruling.** The catalogue restriction becomes a validator, not a prompt sentence. Model output is parsed into a structured shape; a hypothesis whose identifier is not in the fixed enum is dropped, a cited fact whose id is not in the investigation's own timeline is dropped, and an investigation left with no valid hypothesis renders as "no hypothesis" rather than as prose. Dropped items are counted in System Status so silent degradation is visible. §24's test list gains a canary: an investigation whose input log lines contain an instruction-injection payload must produce the same hypotheses and cite the same facts as the same investigation with the payload removed.

### 33.12 The cost estimate branches by billing unit

**Ruling.** The pre-enable estimate never shows one blended number. Metric-billed categories are estimated from metric count at the `GetMetricData` rate; scan-billed categories (errors, logs) are estimated from bytes scanned at the Logs Insights rate, using the group's own recent ingestion to size the scan, and are labelled as such. A selection that mixes both shows two lines and a total, and states plainly which half is the volatile one.

### 33.13 Fingerprints survive a rebuild

**Ruling.** Before fingerprinting, each frame is normalised: a path segment that looks like a build hash is stripped, and a function name that matches a minifier pattern (one or two characters, or a bare digit sequence) is replaced by its position in the frame list rather than kept. When a source map is available the resolved symbol is preferred over both. The fingerprint is then hashed over the normalised frames. A test takes two builds of the same code with different content hashes and minified names and asserts one fingerprint, and a second test asserts two genuinely different errors with the same minified names do not collide.

*Cost if wrong:* two error groups that should have been one, which the interface already lets an operator merge.

### 33.14 Closed without change

The design flagged two figures as unverified — CloudWatch retention tiers and the `GetMetricData` rate. Both were checked against current public documentation during the review and both are accurate. They are no longer open questions and do not need the owner.
