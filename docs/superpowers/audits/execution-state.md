# Execution state

**Mode: continuous autonomous execution**, for approximately three days from 2026-09-25 or until the owner
sends `STOP`. A checkpoint is an internal synchronisation boundary, never a conversation boundary. This
file is the durable journal: a session that loses its context resumes from here without the mission being
restated.

## Where things stand

| | |
|---|---|
| Integrated main | `6b734b0` (`origin/main`), plus the checkpoint below in flight |
| Current checkpoint | Host charts: the last day, with the gaps left as gaps |
| Last green gates | tsc 0 · eslint 0 · **2414 unit** · **412 e2e** · `roadmap:check` 0 |
| Schema | drizzle **0031** — `hosts.services` and `hosts.redis`; 0030 added `hosts` and `host_samples`. 0029 added `notify_destinations.connection_id`, nullable, so a single-account installation behaves exactly as before |
| CloudFormation | base template v1; collection template v1. **AWS-5 (v2) is prepared and tested here, never deployed** |

## The standing loop

For each checkpoint: `git fetch origin` → pick the highest-value dependency-ready task → implement →
unit and adversarial tests (break the code, prove the test fails) → build the test image → full e2e →
**look at the screenshots** → update the roadmap and this file → `npm run roadmap:check` → commit →
`git fetch origin` → reconcile → push `origin/main` → start the next task immediately. No pause between
the last step and the first.

## On resuming (after a pause, a crash, a compaction or any interruption)

An interruption is never a request to wait, and never a reason to ask whether to continue. Recover and
carry on, in this order:

1. Read this file.
2. `git fetch origin`, then compare the working branch with `origin/main`.
3. Work out the last **fully integrated** checkpoint from the log, not from memory.
4. Look for a **partially finished** one in the worktree: uncommitted changes, a new test that does not
   run yet, a route with no entry in `src/lib/api/v1/routes.ts`, a capability flag ahead of its endpoint.
5. **Verify rather than assume.** Run the gates before believing anything was finished.
6. Finish that checkpoint, or take the next dependency-ready task, and continue the loop.

Never restart or discard partial work without inspecting it first. Keep this file current enough that
losing the whole conversation loses no plan.

## Gate discipline

- Never pipe a build, a typecheck or a test run through `head`: closing the pipe can kill the process and
  a truncated log hides real errors. Write to a log, report the exit code, then grep the file.
- `docker compose -p opswatch-test -f docker-compose.test.yml build opswatch` **and** `up -d
  --force-recreate --wait` before `npm run e2e`. A `--force-recreate` wipes the database, so the whole
  suite must run (01-setup seeds the admin) before any single spec can.
- **`npm run e2e` needs a fresh instance.** `docker compose -p opswatch-test -f docker-compose.test.yml
  up -d --force-recreate --wait` first, always — `/data` is a tmpfs, so recreating the container is what
  wipes it. Running the suite against a database a previous run seeded fails `01-setup` ("an admin
  already exists") and cascades into a dozen unrelated specs.
- **Never run two e2e suites at once.** They share one instance: the second run's `--force-recreate`
  wipes the tmpfs under the first, and 26 unrelated specs fail with "an admin already exists". Check
  `pgrep -f "playwright test"` before starting one.
- A mutating `/api/v1` call from a test needs `headers: { origin: baseURL }`: an ambient credential
  requires an Origin, which is the whole of CSRF.

## Decisions that must not be re-derived

- **next-intl does not throw for a missing message — it renders the key path.** A dot inside a key is a
  path separator, so a flat key `"opened.critical"` is unreachable. Three guards hold this now:
  `message-keys.test.ts` (no dotted keys, EN/FR parity, no empty strings), `report-message-keys.test.ts`
  (every key a report *composes at run time* has a message) and the browser sweep in `40-visual-qa`.
- **A detector has no locale**, so it stores ids (`metricKey`, `subjectKind`, `subjectName`) and
  `expandValues` turns them into words at render. Writing a sentence into the database would freeze one
  language into every row a French reader ever sees.
- **Application Insights alarms are metric-math alarms**: `MetricName`, `Namespace`, `Dimensions`,
  `Period` and `Statistic` are null at the top level, and `Dimensions: []` must not win over the
  dimensions inside `Metrics[].MetricStat`.
- `values` is a SQLite reserved word; raw SQL referencing it fails to parse.
- Only `lib/db/**` and `lib/store/**` may import drizzle; `lib/monitoring/shared/**` must stay
  client-safe (no `node:crypto`).
- §33.1: the contract is **additive-only**. New exports go in `PROMISED_VALUES`.
- `null` is "not measured", never `0`. "Healthy" and "cannot tell" must never look the same.

## Completed

- [x] Problem comprehension, visual evidence, recommended investigation per detector family
- [x] Cloudflare dashboard · Accounts as one card language · navigation collapsed by default
- [x] INF-1..6 evaluated health, primitives, ECS estate, EC2 host map, Redis, EKS
- [x] DOC-1 categorised documentation — 17 guides, 6 categories, EN and FR, searchable
- [x] ALE-4 webhook delivery · REP-6/REP-7 reports and the weekly send · HIS-10 backup and restore
- [x] AWS push collection: two stacks, three capability switches, HMAC ingestion, clean uninstall
- [x] **Alarms, reports and Logs rebuilt** after the owner rejected the first attempt on the running
      instance. Root cause was a *reading* bug, not a presentation one; see `6b734b0`
- [x] **INT-3 job catalogue honesty.** `inventory`, `queries`, `logvolume` and `slo` were declared and
      never written; `inventory` ran every 30 minutes on a fresh install, fell through the runner's
      `default` and reported it had covered 0 of 0, which System status showed as a job going its rounds
- [x] **LOG-5** `/api/v1/logs`: sources, start, poll, stop
- [x] **INV-1** `/api/v1/investigations/{id}`: §7's three bands, derived from the problem
- [x] **UX-6** axe over 24 routes × 2 widths × 2 locales × 2 themes, zero WCAG 2.1 A/AA violations
- [x] **UX-7** dark mode verified, including the failure no accessibility rule names
- [x] **Host charts.** CPU, memory and load over the last day, under the latest reading rather than
      instead of it. The line breaks wherever the agent went quiet: recharts draws straight between the
      points it is given, so silence would otherwise be drawn as a measurement. `ChartSeries.values` is
      `(number | null)[]` now, which every other chart inherits
- [x] **Host findings.** A full disk, memory nearly exhausted, a machine that stopped reporting — each
      with the figure behind it, sorted to the top of the list, and outranking the reporting state. They
      are deliberately **not** Problems: that pipeline is scoped to an AWS connection and a host has
      none, and making `problems.connection_id` nullable would silently exclude them from every scoped
      read. Recorded as the next step for hosts rather than smuggled in
- [x] **Service discovery, and Redis on Ubuntu** — the owner's concrete case. Services come from the
      listening ports and the processes holding them, each with the sentence the agent wrote explaining
      how it concluded that. Redis is read with `INFO` and an allow-list: no key, no value, never
      `KEYS`. Verified against a real Redis 7.4.11 before it was wired to a page
- [x] **Linux hosts, first vertical slice.** An agent the operator installs, not SSH: it runs where the
      data is and reports out, so a machine behind NAT works and OpsWatch holds no credential that could
      log in. Same signature scheme as the AWS forwarder. A host is instance-wide, not inside an AWS
      connection, because a machine is not an attribute of a cloud account. Three states — waiting,
      reporting, stopped — and every figure nullable
- [x] **Settings → Storage.** One page for "where is my data and will I lose it", which took three
      before. No migration button, and the page says why: migrations run at startup after the database
      is copied. One storage backend, because there is one — the others would be claims
- [x] **AWS safe disconnect.** The card separates what OpsWatch does from what stays in AWS, names the
      stacks with the documented `delete-stack` commands, links the console for the right region, and
      lists the collection stack first because it holds the subscription filters. The history deletion
      is said **before** the button, because the purge added in `cd78688` changed what the button means
- [x] **AWS onboarding.** The role ARN is worked out from the account, the region and the connection
      instead of being fetched with a CLI query and pasted back; the quick-create URL is written to the
      documented format; the one-click path explains what it needs instead of vanishing; the 28-checkbox
      region grid on the connection page is one line with a disclosure; the account card says which
      connections are forwarding logs, because connected and forwarding are different things
- [x] **Multiple AWS connections, MC-1..MC-8.** The audit is a table in `full-roadmap-status.md`; the
      three that matter most were a cross-account delete (`deleteCheck` took an id alone), silent
      cross-connection data loss (the forwarded-record id did not name the connection, so two
      connections on one AWS account meant the second's records were swallowed as duplicates) and an
      unearned green (System status printed the first matching job run as the job's status)

## Provider references (verified, not remembered)

| What | Source |
|---|---|
| CloudFormation quick-create links | `docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html` — `templateURL` **must** be an Amazon S3 URL in one of three regional forms; the path is `#/stacks/create/review`; `param_<Name>` pre-fills non-`NoEcho` parameters; the console host is regional |

The consequence for a self-hosted product, and the reason the one-click path needs a bucket: the
CloudFormation console will not fetch a template from anywhere but S3, so OpsWatch cannot serve its own.
The page now says that instead of hiding the button.

## Next, in priority order (the owner's marathon queue)

1. ~~Multiple AWS accounts~~ — MC-1..MC-8 and MC-11 done; MC-9 is honest but still one region per
   connection. **MC-9 (per-region collection stacks), MC-10 (per-connection logs budget) and MC-12
   (a connection on the audit log) remain**
2. ~~One-click CloudFormation onboarding~~ — the documented URL format and an honest explanation of what
   the button needs. It cannot be made bucket-free: the console fetches templates only from S3
3. ~~Safe disconnect~~ — done. **Stack identity is still not tracked for the base stack**: the collection
   row stores `stackId`, the connection does not, so "update available" is inferred from a template
   version rather than read from the stack
4. ~~Storage and database setup~~ — done, with the migration button deliberately absent. An external
   PostgreSQL backend is the next real step there, and it is a build rather than a setting
5. ~~Linux host architecture, MVP, service discovery, Redis, findings~~ — done. **Next for hosts, in
   order: host↔EC2 correlation on `cloudInstanceId` (`hosts.connection_id` exists for it); host
   findings as first-class Problems, which needs `problems` to admit instance-wide rows**
6. Unified host/cloud identity (an agent on EC2 must not duplicate the discovered instance)
7. Google Cloud, then DigitalOcean — against current official documentation, never from memory

P0 correctness, security and data-integrity defects override this order. Serious UX defects override new
features.

## External blockers

| Item | What is missing |
|---|---|
| ALE-5 push end to end | An EAS project and APNs/FCM credentials |
| ALE-3 notification preferences UI | Nothing for it to change until ALE-5 exists: a webhook destination carries its own severity and belongs to the installation, not to a person |
| CF-3 Cloudflare Zero Trust | A Cloudflare account with Zero Trust |
| AWS-5 stack v2 deployment | The owner's decision. Prepared and tested here, **never deployed automatically** |
| REPO-4/REPO-5 live commit reads | A GitHub fine-grained token with Contents: Read |
| LOG-4 single log record | `logs:GetLogRecord`, which the read-only role does not grant; belongs with AWS-5's template version |
| ERR-10 pattern discovery | CloudWatch `pattern` availability is unverified against a real account |

## Standing constraints

- The running instance holds **real user data**: an AWS connection, a **real verified Cloudflare token**
  with `gigsberg.com` selected, and real problems. Never `docker compose down -v`, never delete the
  volume, never revoke that connection.
- Secrets are never returned to a browser, never logged, never in the contract, never in a screenshot.
- Never deploy, never modify production infrastructure, never push to a customer repository.
- Never force-push, never rewrite shared history, never touch the Mobile worktree or `feature/mobile`.
- Capability flags move only when the end-to-end behaviour genuinely exists.
- Correlation is never rendered as cause: Observed → Correlated → Possible cause → AI hypothesis.
