# Execution state

**Mode: continuous autonomous execution**, for approximately three days from 2026-09-25 or until the owner
sends `STOP`. A checkpoint is an internal synchronisation boundary, never a conversation boundary. This
file is the durable journal: a session that loses its context resumes from here without the mission being
restated.

## Where things stand

| | |
|---|---|
| Integrated main | `434c2f7` (`origin/main`), plus the checkpoint below in flight |
| Current checkpoint | Redis on the box, judged from what it reports about itself |
| Last green gates | tsc 0 · eslint 0 · **2435 unit** · **413 e2e, 2 skipped** · `roadmap:check` 0 |
| Schema | drizzle **0037** — `connections` gains a provider and Google columns, and `aws_account_id` becomes nullable; 0035 added `aws_collection_stacks`, keyed by `(connection, region)`; 0034 added `hosts.region`, beside `hosts.connection_id`; 0033 added `audit_log.connection_id`, nullable, for an installation-wide action; 0032 keyed `logs_usage` by `(day, connection_id)`; 0031 added `hosts.services` and `hosts.redis`; 0030 added `hosts` and `host_samples`. 0029 added `notify_destinations.connection_id`, nullable, so a single-account installation behaves exactly as before |
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
  (every key a report *composes at run time* has a message), `message-namespaces.test.ts` (every
  literal `t('…')` resolves **in the namespace its component binds**, which is the one a correctly
  spelled key filed in the wrong place slips past) and the browser sweep in `40-visual-qa`.
- **A detector has no locale**, so it stores ids (`metricKey`, `subjectKind`, `subjectName`) and
  `expandValues` turns them into words at render. Writing a sentence into the database would freeze one
  language into every row a French reader ever sees.
- **Application Insights alarms are metric-math alarms**: `MetricName`, `Namespace`, `Dimensions`,
  `Period` and `Statistic` are null at the top level, and `Dimensions: []` must not win over the
  dimensions inside `Metrics[].MetricStat`.
- `values` is a SQLite reserved word; raw SQL referencing it fails to parse.
- **A table rebuild during a migration deletes that table's cascading children**, unless foreign keys
  are off *around the migrator*. drizzle-kit writes `PRAGMA foreign_keys=OFF` into every rebuild it
  generates and it has never done anything: the migrator runs each file inside a transaction, and
  SQLite ignores that pragma inside one. `createDb` sets it where it takes effect;
  `migration-foreign-keys.test.ts` owns no migration and holds the property directly.
- **drizzle-kit generates a table rebuild by selecting every new column out of the old table**, including
  the column being added — which fails on any database that already has rows. Read the generated SQL
  before trusting it. `migration-logs-usage.test.ts` runs 0032 against a real pre-0032 database.
- **A region that scrolls sideways needs `tabIndex={0}`** or columns past the edge exist only for a
  mouse (axe `scrollable-region-focusable`, WCAG 2.1 A). `components/ui/table.tsx` does it; four
  hand-rolled containers did not. `scrollable-regions.test.ts` holds it statically, with a written list
  of the regions axe exempts because their focusable children are unconditional.
- **The same AWS account may be connected twice.** `createConnection` has no uniqueness check on
  `awsAccountId`, at the schema level or in code, and the rest of the product treats two connections
  over one account as a supported configuration. Anything that matches on what an account *contains* —
  an instance id, a log group — must therefore be deterministic about which connection wins.
- **A `select … .all()` is a page that stops loading in two years**, not one that is broken today.
  `store-bounded-reads.test.ts` holds every one of them to being limited, windowed, or listed with the
  reason it cannot grow.
- **A connection id is twelve random hex characters**, so a test asserting "no timestamp in this URL"
  with `\d{10,}` over the whole href fails on the day an id happens to hold ten digits in a row
  (`f2956924662e` did). Assert against the part of the URL the claim is about.
- **A test that skips itself is a test that is not run.** `45-hosts` read `main` straight after a
  navigation, got the Suspense fallback and skipped on "no instance found" for days. Prefer waiting and
  asserting over `test.skip` on a condition the page controls.
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
- [x] **One machine seen from both sides.** An agent that reports a `cloudInstanceId` is matched to the
      EC2 instance of that id, in one query for the whole table rather than one per row, and each side
      links to the other. On the id AWS gave it, never on the hostname: two machines can share one
- [x] **MC-10 the logs budget is per account.** `logs_usage` was keyed by the UTC day alone, so two
      connected accounts raced for one pot: whichever collection ran first could spend the whole day's
      cap before the other had scanned a byte, every day, with no page saying who spent it. The cap
      still belongs to the installation — connecting a second account must not double the operator's
      bill — but it is divided evenly between the accounts with an enabled log source, and an account
      stops at its own share **or** at the installation's cap, whichever comes first. The page says
      which of the two stopped it, because the remedy differs. The Checkup said "budget used up (0.00
      of 5 GB)" to the account that had spent nothing, which is a contradiction: it is a separate
      finding now
- [x] **Redis on the box is judged, not just displayed.** The agent has collected `INFO` since Redis
      support was added and nothing looked at the figures. Three findings, and the restraint is the
      work: **no `maxmemory` is only worth saying when Redis is already a quarter of the machine**,
      because on a box that exists to run Redis the machine's memory *is* the limit and somebody chose
      that; **eviction is never reported**, because `evicted_keys` counts since Redis started and
      OpsWatch keeps no previous value to make it a rate — a figure that looks like a problem and is
      not one is worse than no figure; and a **failed background save** is reported because Redis said
      so, with no figure invented to go beside it
- [x] **What to check, for a machine.** A finding said what was wrong and stopped there. The worst
      finding now carries an investigation — deterministic and written down, like the metric
      catalogue's, because a model paraphrasing "the disk is nearly full" differently on each render
      would be worse than the figure it replaced. It says what to **check**, never what is wrong:
      OpsWatch read one figure from one machine and knows no cause. And the steps are for *this*
      machine — the Redis step appears because the agent found Redis listening, and a step about
      Docker on a box without it teaches an operator to skim, which is how the step that mattered gets
      missed. The owner's own case, a filling disk on a Redis box, is the one it answers best
- [x] **§M every store read is bounded.** An audit of all 48 unlimited `.all()` reads and of every
      `await` inside a loop. The store turned out healthy — reads are windowed, capped where they are
      written (`MAX_COMMITS = 10`), or over sets an operator creates by hand; the provider loops are
      batched or deliberate polling. So the value is the guard, not the fixes: every unlimited read is
      now windowed, limited, or on a written list with the reason it cannot grow, and the forty-ninth
      fails until somebody decides which it is
- [x] **A connected Google project shows something.** Compute Engine instances, per region, on the
      connection's own page rather than in the monitoring rail — every section of that rail is an AWS
      service, and carrying a Google connection through it would offer Containers and Databases that
      can never hold anything. `aggregatedList` answers for a whole project keyed by zone, so the
      region is applied by matching the zone prefix **with its separator**: `us-central1` must not
      swallow `us-central12`. Paged, because a first page shown as though it were the whole project is
      worse than an error, and bounded, because a page render must not walk a hundred thousand
      instances
- [x] **Google Cloud, connected without a key.** Google's own guidance is to avoid service account
      keys — the risk it names is non-repudiation, "no reliable way to tell who used the key" — so
      OpsWatch stores no Google credential at all: each connection gets its own signing key, mints a
      five-minute token and exchanges it at the Security Token Service. The objection for a
      self-hosted product does not hold: `--jwk-json-path` uploads the key set to the provider, so an
      instance nobody can reach from the internet can still use the recommended method. Two audiences
      that look like one string are not (`https://iam.googleapis.com/…` in the JWT, `//iam.googleapis.com/…`
      in the exchange). **No monitoring pages yet**, and the roadmap says so
- [x] **MC-9 a collection stack is a thing in a region.** `aws_collection` held one `forwarder_arn`
      for a whole account, and a subscription filter can only target a Lambda in its own region — so an
      account reading three regions could forward from one, and the other two would have pointed at a
      function that is not there. Split along what the two things actually are: the consent belongs to
      the account and was given once, the stack exists in a region and has its own answer from AWS.
      drizzle-kit generated the move as six `DROP COLUMN`s and nothing else, which on any installation
      with a forwarder would have thrown the stack away
- [x] **A machine that is in trouble tells somebody.** `machine` is a fourth alert condition beside
      `problem`, `synthetic` and `slo`, covering the four kinds an agent can find. The conditions
      partition the kinds, so a machine finding cannot also match a problem rule and be announced twice.
      Candidates come from the same pure `hostFindings` the page draws, so the alert and the page can
      never disagree. The alert has no problem row and points at the machine instead — without that
      branch the one alert most worth acting on landed the operator on a list of every alert there is.
      Found while wiring it: `alertLabels.title` stripped an `Insights.` prefix and rendered anything
      else as its own key path, and its `try/catch` never ran because next-intl does not throw — a
      title key outside that namespace would have printed `Hosts.findings.disk_full` onto the page
- [x] **A machine's trouble, where the operator asks.** The owner's case is Redis on an Ubuntu EC2
      instance, where a full disk is invisible to every AWS API there is — and the agent's figure lived
      only on the Machines page, so "what is wrong in production" answered about the account and not
      about the machines inside it. The Health page of the account and region a machine was placed in
      now lists it, worst first, each finding with the figure behind it. **Read at render, not written
      as a Problem**: that table is keyed to an AWS environment by a column that cannot be null, and
      making it nullable turns every scoped read into a tri-state where one missed predicate leaks or
      hides rows. The card says what it is not — nothing there is acknowledged, opens an incident or
      matches an alert rule — because one that looked like the Problems list would promise a
      notification that is not coming. **Alerting on a machine remains the next step**, and needs
      `alert_rules` to admit a rule that is not about one AWS environment
- [x] **Where a machine lives.** `hosts` recorded which account matched it and nowhere in it, though a
      connection may read several regions and an instance is in exactly one — and every scoped read in
      this product is keyed by the pair, so half an answer is unusable by all of them. `hosts.region`
      is written with the link. The link is **sticky** now: `createConnection` has no uniqueness check
      on the AWS account id, so one account can be connected twice, both connections list the same
      instance, and a link that overwrote whatever it found moved the machine to whichever instances
      page was rendered last. A placement that is wrong is undone from the host page rather than being
      permanent
- [x] **UX-3 the narrow pass, as a sweep.** 40 routes × 2 locales at 360 px, measuring two failures
      rather than one: the page scrolling sideways, and an element wider than the screen while an
      ancestor clips it — which looks like nothing is wrong at all. It found one: the "what changed"
      list put an unshrinkable timestamp beside a description that could not wrap, so on a narrow
      screen the time was simply off the edge. The same row exists on the brief and the incident
      timeline and had the same fault. The sweep shares one route list with the accessibility sweep,
      so a page added to one is never quietly missing from the other
- [x] **MC-12 the audit log names the account.** `connection_id` on the row, nullable because signing
      in and changing a setting belong to the installation rather than to an account; a column and a
      per-account filter on the page; and "this installation only" as its own question, since a single
      filter box would have hidden it. Found while wiring it: `connection_create`, `connection_update`,
      `connection_delete`, `connection_test` and `credential_rotate` were all in the log's closed
      vocabulary and **not one was ever written** — connecting an account, testing it with somebody's
      credential, replacing that credential and removing the account together with every problem, alert
      and log source it produced all left no trace. Also: `redirect()` throws, and an audited action
      that ended in one was being recorded as having *failed*
- [x] **Multiple AWS connections, MC-1..MC-8.** The audit is a table in `full-roadmap-status.md`; the
      three that matter most were a cross-account delete (`deleteCheck` took an id alone), silent
      cross-connection data loss (the forwarded-record id did not name the connection, so two
      connections on one AWS account meant the second's records were swallowed as duplicates) and an
      unearned green (System status printed the first matching job run as the job's status)

## Provider references (verified, not remembered)

| What | Source |
|---|---|
| Google Cloud, workload identity federation | `docs.cloud.google.com/iam/docs/workload-identity-federation` and `.../workload-identity-federation-with-other-providers` — an external workload exchanges a token from its own OIDC issuer for a short-lived Google access token, through a **workload identity pool** and a **provider**, optionally impersonating a service account. The issuer **does not have to be reachable by Google**: `gcloud iam workload-identity-pools providers create-oidc --jwk-json-path` uploads the JWK set directly (max 8 keys), "when the IdP's OIDC metadata endpoint URL isn't publicly accessible". The token needs `aud` = `https://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`, `exp` in the future, `iat` in the past, and `exp - iat` at most 24 hours |
| Google Cloud, service account keys | `docs.cloud.google.com/iam/docs/best-practices-service-accounts` — "We recommend that you avoid using service account keys whenever possible", in this order: workload identity federation, then impersonation with user credentials, then keys as a last resort. The named risk is **non-repudiation**: "if the service account is authenticated with a service account key, there is no reliable way to tell who used the key" |
| Google Cloud, read-only roles | `roles/monitoring.viewer` carries `monitoring.timeSeries.list`, which is what reading metrics needs (`docs.cloud.google.com/monitoring/access-control`); `roles/compute.viewer` for reading instances |
| CloudFormation quick-create links | `docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html` — `templateURL` **must** be an Amazon S3 URL in one of three regional forms; the path is `#/stacks/create/review`; `param_<Name>` pre-fills non-`NoEcho` parameters; the console host is regional |

The consequence for a self-hosted product, and the reason the one-click path needs a bucket: the
CloudFormation console will not fetch a template from anywhere but S3, so OpsWatch cannot serve its own.
The page now says that instead of hiding the button.

The consequence for Google Cloud, and it is the opposite one: the keyless path Google recommends **is**
available to a self-hosted instance that nobody can reach from the internet, because the JWK set is
uploaded to the provider rather than fetched from the issuer. Assuming otherwise would have shipped the
method Google explicitly discourages as the only one on offer.

## Next, in priority order (the owner's marathon queue)

1. ~~Multiple AWS accounts~~ — **MC-1..MC-12 all done.** The audit is the table in
   `full-roadmap-status.md`
2. ~~One-click CloudFormation onboarding~~ — the documented URL format and an honest explanation of what
   the button needs. It cannot be made bucket-free: the console fetches templates only from S3
3. ~~Safe disconnect~~ — done. **Stack identity is still not tracked for the base stack**: the collection
   row stores `stackId`, the connection does not, so "update available" is inferred from a template
   version rather than read from the stack
4. ~~Storage and database setup~~ — done, with the migration button deliberately absent. An external
   PostgreSQL backend is the next real step there, and it is a build rather than a setting
5. ~~Linux host architecture, MVP, service discovery, Redis, findings, host↔EC2 correlation~~ — done.
   **Next for hosts: host findings as first-class Problems, which needs `problems` to admit
   instance-wide rows**
6. ~~Unified host/cloud identity~~ — an agent on EC2 is matched to its instance and shown from both
   sides. Still open: the same for GCE and DigitalOcean, which have no discovery to match against yet
7. ~~Google Cloud~~ — connected keylessly, and its instances are readable. **Next for it: metrics,
   and a monitoring surface that is not AWS-shaped.** The rail's ten sections are ten AWS services; a
   unified model (§G) is what both this and DigitalOcean need, and it is a deliberate build rather
   than something to grow one page at a time
8. DigitalOcean — against current official documentation, never from memory

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
