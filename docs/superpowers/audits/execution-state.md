# Execution state

**Mode: continuous autonomous execution**, for approximately three days from 2026-09-25 or until the owner
sends `STOP`. A checkpoint is an internal synchronisation boundary, never a conversation boundary. This
file is the durable journal: a session that loses its context resumes from here without the mission being
restated.

## Where things stand

| | |
|---|---|
| Integrated main | `d77f1d2` (`origin/main`), plus the checkpoint below in flight |
| Current checkpoint | Why a Google problem cannot open an incident nobody could read |
| Last green gates | tsc 0 · eslint 0 · **2658 unit** · **458 e2e, 2 skipped** · `roadmap:check` 0 |
| Schema | drizzle **0038** — `connections.do_token_ciphertext` and `do_last_test`; 0037 added `connections` gains a provider and Google columns, and `aws_account_id` becomes nullable; 0035 added `aws_collection_stacks`, keyed by `(connection, region)`; 0034 added `hosts.region`, beside `hosts.connection_id`; 0033 added `audit_log.connection_id`, nullable, for an installation-wide action; 0032 keyed `logs_usage` by `(day, connection_id)`; 0031 added `hosts.services` and `hosts.redis`; 0030 added `hosts` and `host_samples`. 0029 added `notify_destinations.connection_id`, nullable, so a single-account installation behaves exactly as before |
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

## The multi-cloud seam (§G), and what is still AWS-shaped behind it

**The seam is `loadFamily`, and nothing downstream moves.** The detect cycle reads each family; after
that, `outcomesFromInsights`, the problem lifecycle, `family_snapshots`, the alert cycle, incidents,
history and reports all work on `Insight` and problem rows with no AWS type in them, and
`family_snapshots.family` is a plain string. A second provider is therefore a second set of families
and a loader for them — the same shape as the host agent's findings becoming a second producer into
the alert cycle — **not** a second monitoring application.

Verified against the code, and confirmed by review. What is *not* yet moved, and will bite the moment
a non-AWS family is added — in the order it will bite:

| Left | Why it matters |
|---|---|
| ~~`resolveTarget` is `sts:AssumeRole` for every cloud~~ | **Done.** Each provider has its own `resolveTarget` in the registry; `ProviderTarget` is a tagged union of three genuinely unalike things, and the cycle asks the provider |
| ~~The family list exists in four places~~ | **Done.** `monitoring/shared/families.ts` is the leaf all three reach; Health derives its rows from the connection's provider |
| ~~`InsightKind` is a closed union, `SUBJECT_OF` exhaustive over it~~ | **Decided.** Per-provider unions and per-provider exhaustive records, merged. Nothing lost: a kind without a subject type still fails to compile. `detect/subjects.ts` |
| ~~`ScopeRef = { connectionId, region }`~~ | **Decided.** A scope is the unit the provider scopes by: a region for AWS, a **project** for Google, the account for DigitalOcean. `monitoring/shared/scopes.ts` |

### What the second checkpoint changed

**A target is per-cloud, because the three are not alike.** AWS's is assumed role credentials for one
region, Google's is a signing key plus the pool that will exchange it, DigitalOcean's is an account-wide
token with no region in it at all. Forcing them into one `credentials` field each fills differently is
exactly how the AWS model gets cloned under generic names, so `ProviderTarget` is tagged and each arm
says what that cloud needs. The AWS resolver itself is untouched — ninety-odd pages call it and it is
correct; the fix was to stop calling it for clouds it knows nothing about.

Resolving Google's target properly turned up an older bug it was worth stopping: the instances page
turned each of five nullable columns into `?? ''`, which builds `projects//locations/global/...`, sends
it, and shows the rejection as though Google had refused an access grant. `isValidTarget` had existed
since federation was built and nothing called it. "This connection was never finished" and "Google
refused you" are different sentences with different fixes, and both pages now say which.

**One family list where there were three.** `INSIGHT_FAMILIES`, `HEALTH_FAMILIES` and `PROBLEM_FAMILIES`
declared the same four strings in three modules, separately and for a real reason — the read layer must
not import the collector, the detect layer must not import the AWS stack. The consequence was that a
fifth family added in the obvious place would have been read by the cycle and absent from Health and
from the report: not wrong, not unknown, just missing. `monitoring/shared/families.ts` is the leaf all
three can reach, keyed by provider, and the registry takes its list from there too.

Which made a second thing possible and necessary: **Health iterates the connection's own families.**
It iterated AWS's four regardless, so a Google project would have shown Containers, Databases, Load
balancers and Alarms, each `unknown` — OpsWatch appearing to fail at reading four things nobody ever
said were there. Unreachable today because the rail is gated on `supports(provider, 'health')`, and
wrong the moment that gate opens.

Mutation testing caught one of my own here. The Health change passed every test I had just written —
substituting `AWS_FAMILIES` back in broke nothing — because the rulings were all about the *list* and
none about *who asks*. The ruling that pins it lives in `read-health.test.ts` and is the thing that
actually fails.

`Insight.href` and `subject_type` turned out **not** to be AWS-shaped: `href` is built by `subsectionPath`
and the subject kinds (`resource`, `service`, `cluster`) describe a droplet or a Cloud Run service
without strain. Two things I expected to be problems and are not.

## The first non-AWS capability (§G), and what it cost

**Google CPU, agentless, direct.** `compute.googleapis.com/instance/cpu/utilization` is written by the
hypervisor, so it exists for every running instance with nothing installed — which is exactly what lets
a self-hosted OpsWatch read a Google project with no forwarder, no agent and no account with us. One
`timeSeries.list` call for every instance on the page, shown as a percentage and a sparkline beside the
list that was already there.

Verified against the current reference before a line was written, per Part O — the parameter names
(`interval.startTime`, `aggregation.alignmentPeriod`, `aggregation.perSeriesAligner`, `view`), the rule
that a filter must name **exactly one** metric type, that `AND` is upper case, and that the OAuth scope
is inside what `roles/monitoring.viewer` grants. That role was already in the connection wizard,
described as "the metrics Google already collects"; it is now true rather than aspirational.

Deliberately **not** shipped: network and disk counters. The docs pages are too large to fetch whole and
the best a search returned was that the metric kind is "likely DELTA" — and whether a counter is DELTA
or CUMULATIVE decides whether you subtract consecutive points or not. A bandwidth chart wrong by that
difference looks perfectly plausible. It waits for the descriptor, read from Google or from the
reference, rather than being guessed at.

**Memory is not available and the page says so.** On Google, memory, disk usage and process counts come
from `agent.googleapis.com/…` — the Ops Agent — not from the hypervisor. An absent column tells an
operator nothing about whether OpsWatch failed or Google never measured it, so the page states which
in a sentence, in both languages, and names the agent OpsWatch does not install.

### DigitalOcean, which is not Google with different names

The mission's instruction was not to invent parity DigitalOcean does not provide, and the first place
that bites is the most obvious metric there is. **DigitalOcean's CPU needs `do-agent`.** Bandwidth,
disk I/O and disk usage are measured from outside the droplet; CPU, load average and memory are
measured inside it. Google is close to the opposite. So a second provider slice that mirrored the
first — a CPU column, the same sparkline, the same sentence underneath — would have been a page that
looked complete and was wrong about what it measured.

What shipped is therefore deliberately narrower than the Google one: **public bandwidth**, in and out,
in Mbps, for up to twelve droplets. Twelve because each droplet costs *two* requests — `inbound` and
`outbound` are separate calls — and DigitalOcean allows 250 a minute; past the cap the rest of the
list is shown without a figure and the page says which cap it hit. The values arrive as decimal
**strings**, where `Number('')` is 0, so parsing them is a check and not a coercion.

Both pages now carry a sentence naming what the provider measures without an agent and what it does
not, and the two sentences are different because the two clouds are. An e2e ruling holds exactly that:
DigitalOcean's page says CPU needs the metrics agent, Google's says CPU needs nothing and memory needs
the Ops Agent, and neither page carries the other's caveat.

### The overview, and a bug that only a second cloud could reveal

`/accounts` drew **every** connection with `integration="aws"` and the label `t('provider.aws')`. A
Google project and a DigitalOcean account were both presented as AWS accounts — on the one screen
whose entire job is to say what this installation is connected to. Invisible until a second cloud
existed, and then wrong on every card.

Fixed, and then found to be only half fixed: the provider name renders `sr-only`. That is right for an
integration card, whose *title* is the provider's name, and leaves a connection card showing nothing
but a glyph, because its title is whatever the operator called it. AWS's glyph is a plain cloud and
Google's is a cloud with a cog. Identity that rests on telling those apart at 16px is identity erased,
so a connection card now carries its cloud in writing under the name, and the hidden copy is scoped to
the cards that have no visible one.

Beside it, counts by cloud and a filter. Links rather than a client-side control, so a filtered view
has a URL that can be sent to a colleague and works before any JavaScript does. Two things held by
test: the **counts are of everything**, never of the filtered list — a count that changed when you
filtered would be answering a different question from the one it appears to answer — and filtering to
one cloud shows one cloud, with GitHub and the other integrations out of the way rather than left on
screen answering something nobody asked.

A note on method: `git checkout messages/fr.json` during a mutation run silently discarded this
checkpoint's uncommitted French keys. Same trap as the earlier `git checkout` on an untracked file,
and the same lesson — after reverting anything, check what else was in that file.

### Google alerts, and the most comfortable lie a monitoring tool can tell

Cloud Monitoring's open incidents, read directly. Every word on the page is Google's — its policy
names, its severities, its open times — because the instruction was to use the provider's evidence and
not manufacture health conclusions it never reached.

The design decision worth keeping: **the page reads policies as well as incidents, and it has to.** An
empty incident list means one of two completely different things — nothing is wrong, or nothing is
watching — and a project with no enabled alerting policies has not been found healthy, it has not been
looked at. So there are three answers where a naive version would have one:

  - open incidents, listed
  - *no* open incidents **and** at least one enabled policy → Google is asserting that nothing is wrong
  - *no* open incidents **and** nothing enabled → "there are no open incidents, and nothing is watching
    for them", which OpsWatch will not call healthy

`quietMeansSomething(policies)` is the whole distinction and it is one line, which is exactly why it
needed a ruling: mutating it to `true` breaks one test and nothing else would have noticed.

Two API facts worth not re-deriving: **there is no `projects.incidents`** — incidents are
`projects.alerts`, and an `Alert` carries a `PolicySnapshot` with the policy's display name and
severity, so an incident is self-describing. And a policy's `enabled` comes back **either as a bare
boolean or as `{ value }`**; read as truthy, a `{ value: false }` counts a switched-off policy as
watching, which turns "nothing is watching" into "nothing is wrong" — the exact failure above, through
a JSON quirk.

The connection page now offers each page behind the role that opens it: instances for
`roles/compute.viewer`, alerts for `roles/monitoring.viewer`. A connection with one grant and not the
other gets the page it can use rather than a dead end.

### A scope is whatever the provider scopes by

The open decision in the table above, made. `scope` has meant "AWS region" since there was only AWS,
and it is really the unit the provider's data is scoped to — which is a region for AWS, a **project**
for Google, and the account for DigitalOcean. Google's alerting policies and incidents are
project-scoped and a project spans regions, so a two-region Google connection collected once per
region would have opened the same incident twice, as two OpsWatch problems under two scopes, and
resolved neither when Google closed it. Nothing downstream would have noticed: both rows are valid.

The same mistake one layer up, and this one was already live. **Every environment-scoped job reads
CloudWatch, and every one of them ran for every connection whatever cloud it was to.** With history
switched on, `metrics` asked a Google project for CloudWatch every five minutes and threw
`connection_unavailable` every time — a permanent red mark on System status for a connection working
exactly as designed. `metrics`, `errors`, `synthetics`, `deployments` and `baselines` now declare
`providers: ['aws']`; `detect` declares none, because it asks the registry which families a cloud has
and answers honestly for one with none.

Two smaller consequences worth having written down. A `GcpTarget.region` is now `string | null`, and
the detect path passes **null** rather than the project id — carrying a project id in a field named
`region` and hoping nothing reads it is how `instancesInRegion`'s zone-prefix match starts silently
matching nothing. And a Google connection with no project set yet is collected under **no** scope
rather than under `''`: rows written under an empty string could never be found again and would show
on System status as a collected environment.

### What is wrong anywhere

The monitoring rail answers "what is wrong in this account and this region", which is the right
question once you know where to look. An operator with three AWS accounts and a Google project has to
know where to look *before* they can ask, so the answer depends on where they started. `/problems` is
the other question, instance-scoped beside Linux servers and Cloudflare for the same reason: "what is
wrong" is not an attribute of one AWS account and region.

**Provider identity is carried, never flattened.** Every row says which cloud produced the evidence,
which connection, and what its scope is — named as what it is, a *region* for AWS and a *project* for
Google, from `scopeKindOf`. "The payments database is at 98 % CPU" and "Google has an open incident on
checkout" are fixed in different places by different people, and a unified list that dropped the cloud
would be a list nobody could act on.

Two rules held by test rather than by care. The **counts are of everything**, so filtering empties the
list and does not move the numbers. And a **Google problem gets no link into the AWS rail**: `href` on
a problem row is a monitoring-rail path, and the rail is ten AWS services — following one for a Google
incident would open a page about a service that cloud does not have, which is the "clone the AWS UI
and change the names" failure arriving through a link.

An empty list says what it counted. "Nothing is open" is a statement about the database, not about the
clouds, and the page says so: a connection nothing has been read from contributes no rows, which is
not the same as it being well.

### A nav item that pushed Sign out off the screen

Adding one item to the rail broke `01-setup`: **Sign out** left the viewport, still in the DOM and
still "visible" to a query, so the click timed out. The cause is one class — a `flex-1` child of a
fixed-height column cannot shrink below its own content without `min-h-0`, so the list grew past its
share instead of scrolling. The list scrolls now and the two controls under it stay put, and
`sidebar-fits.test.ts` holds it, because this failure scales with the product: every section added
from here makes it likelier, and it shows up first on whichever screen is shortest rather than on the
one it was built on.

### Google's incidents are problems now, and what that cost

The seam's claim, tested end to end: a Google incident goes through `outcomesFromInsights`, the
problem lifecycle, the alert cycle and onto `/problems` beside AWS's, and nothing between the family
loader and the stored row knows which cloud produced it.

**One Google kind, not four families with Google names on them.** OpsWatch does not read Google's
metrics and decide a project is unwell: the project's own alerting policies do that, an operator wrote
them, and relaying what they opened is using the provider's evidence. A parallel set of OpsWatch
thresholds would be a second opinion beside the one the project already has, and the two would
disagree in front of somebody at three in the morning.

**The `InsightKind` decision.** Per-provider unions, per-provider exhaustive records, merged. The
naive widening — one flat union and one `Record` over it — looks identical and throws the guarantee
away: a `Record<InsightKind, SubjectKind>` is satisfied by any map that happens to cover the union,
and nothing then ties a provider's kinds to a provider's map. Split, adding a Google kind without a
subject type fails to compile in `GCP_SUBJECT_OF` exactly as an AWS one does in `AWS_SUBJECT_OF`.

**What is shown and what is keyed on are not always the same string.** `Insight` gained an optional
`subjectId`. Google keys an incident by the **policy and the resource together**, and either alone is
wrong: two policies watching one instance are two problems, and one policy firing on two instances is
two problems. Keyed on the resource alone the first pair collapses into one row whose title flips
between them. Length-prefixed, for the same reason the dedupe key is. Not Google's incident id, which
changes when Google closes one and opens another for the same cause — a problem that started again is
the same problem returning, which the lifecycle's two-hour window exists to recognise.

**Severity: three of Google's become two of ours, upward.** `CRITICAL` and `ERROR` are both critical,
because Google's alerting is opt-in and somebody chose `ERROR` to mean a failure. `WARNING` and *no
severity* are warning, never `info`: Google opened an incident, which is a statement that something is
wrong. Google's own word is carried in the problem's values, so nothing the mapping loses is hidden.

**`problems: supported`, `health: not_built`, and that is not a contradiction.** Health is a
per-family verdict shown in the section rail, and the rail is ten AWS services — offering it for a
Google project would put Containers, Databases and Load balancers in front of somebody who has none of
them. The capability table keeps the two claims apart, `capabilityIsBacked` checks `problems` against
the family list, and an e2e ruling holds that the rail is still not offered.

Six mutations verified, including ranking `ERROR` down, letting an unranked incident become `info`,
keying on the resource alone, counting the estate as incidents rather than policies, and turning a
refused read into an empty family.

### DigitalOcean has policies and no firing state, and the product says so

`GET /v2/monitoring/alerts` lists alert **policies**. There is no endpoint anywhere in DigitalOcean's
Monitoring API that says which of them are currently firing — five CRUD operations on policies, sixty
metric endpoints, and nothing for open incidents. Google has `projects.alerts`; AWS has alarm state.
DigitalOcean has neither.

So the third cloud's alerts page is **configuration**, and the difference is stated on it rather than
left as an absence: "DigitalOcean has no API for which policies are currently firing, so OpsWatch
cannot show open incidents for this account the way it does for a Google Cloud project. This page is
your configuration, not the state of it." That sentence renders **whether or not the read succeeded**,
because it is a fact about DigitalOcean and not about the request — an operator whose token was
refused still needs to know why there are no DigitalOcean incidents anywhere in this product.

The same `alerts` capability therefore means something different on each cloud, which is what a
capability model is for. Three clouds, three genuinely different answers to "what does the provider
itself say is wrong", and not one of them is the AWS page with the names changed.

One thing worth stealing for later: an **enabled CPU or memory policy on a droplet without `do-agent`
never fires**, so "Enabled" alone tells an operator they are covered when they are not. Each row
carries the caveat, from the same agentless split the droplets page states.

### What a second reader found, and what the six had in common

Ten checkpoints of multi-cloud work, reviewed. Six defects, all verified against the code before
being acted on, all fixed, all pinned by a ruling that fails when reverted. Three were mine from this
week. Not one of them threw, failed a test, or looked wrong on a screen.

**A truncated read was recorded as a complete one.** The worst of them, and the most instructive.
Google's incidents are paged and the read stops at a cap; the family reported `ok` either way, so the
cycle treated it as fully read, saw no sign of a problem whose incident was past the cap, and
**resolved it while Google still reported it open**. §33.5 already says a problem nobody could look at
must not resolve itself — it just did not go a level finer, to a family looked at *in part*.
`FamilySummary` gained `truncated`, a partial read is no longer in the `read` set, and a partial read
with nothing wrong in what it saw records `unknown` rather than `healthy`.

**The score's persistence term asked with a display name.** When I split "what is shown" from "what is
keyed on", I updated every use of the identifier in that hunk except one — `breachingMinutes`. For
every AWS rule the two are the same string, so nothing failed; for Google they differ, so the lookup
never matched and every Google problem scored as though it had just started, however long Google had
had the incident open.

**A notification about a Google incident linked to a 404.** `alertUrl` always built
`/c/{connection}/{scope}/…`, which resolves for AWS and for nothing else — at the one moment an
operator is following a link because something is actually wrong. It now takes the provider and the
problem's own link, and refuses a rail path offered for a non-AWS problem rather than passing it
through.

**Four places independently rebuilt "what environments exist" from `connection.regions`** — System
status (page and API), the digest job, and `resolveEnvironment`, which every data endpoint uses. For
DigitalOcean that list is empty, so its real scope was invisible; for Google it holds real region
strings, so the page invented an environment nothing was collected under: permanently "never read",
with the working one nowhere to be seen. On the screen whose entire purpose is saying when OpsWatch
cannot see something. All four ask `scopesOf` now, and a ruling greps for the old shape.

**A stale run made a job permanently red.** `collector_runs` is a log, and the worst-of was taken over
all of history — so an installation upgrading through the `providers: ['aws']` change keeps its old
failed Google `metrics` run for ever and reports `metrics` as failing, when `metrics` is now correctly
not run there at all. A status a job cannot recover from is worse than no status.

The common shape is worth more than the six fixes: **something written once when AWS was the only
cloud, still compiling, still passing, and quietly answering the wrong question.** None of them was a
design flaw in the seam — the seam held — and none would have been found by running the product,
because every one of them fails in a direction that looks like success.

Two the review flagged for awareness rather than as defects: `read/reports.ts` iterates AWS-only
`PROBLEM_FAMILIES`, so a Google family gets no report row; and if Google's `health` is ever turned on,
its `total`/`affected` are policies and incidents where the Health summary reads instances. Both are
recorded here rather than fixed, because both are gated shut today.

### `costs`, declared and not built

The capability list asked for was Resources, Health, Metrics, Problems, Errors, Alerts, Logs,
History, **Costs / usage** — and the enum had eight of the nine. Declaring the ninth is one row and it
is `not_built` on all three clouds, which is exactly why it is worth declaring: all three *do* expose
it (Cost Explorer, Cloud Billing, DigitalOcean's balance and billing history), so an operator asking
"can OpsWatch show me what this costs?" gets a straight *not yet* instead of silence, and knows their
cloud is not the obstacle.

Adding it failed to compile until the registry had a `costs` reader slot — the guard doing its job: a
capability cannot be declared without somewhere to name the code that will serve it. And a new ruling,
because the next one will not be so lucky: **every capability needs a name in both languages**.
next-intl renders `Capabilities.names.costs` rather than throwing, so a capability added without one
ships as that string on every connection page.

### A problem is understandable whichever cloud produced it

The mission's own sentence, and until now it was half true: the cross-cloud list showed a Google
problem and there was nowhere to open it. `/problems/{id}` is one route for every cloud.

**Deliberately a subset of the AWS section page.** That page has the diagnosis, the investigation and
the workspace, and all three read AWS-shaped rows; reproducing them under generic names for the sake
of symmetry is the exact failure this work exists to avoid. What is here is what a problem row and its
evidence actually carry whichever provider wrote them — enough for the four questions an operator asks
first: what happened, how bad, since when, and on what grounds. The AWS page is **offered** on AWS
problems rather than duplicated, and a Google problem is not offered one that resolves to nothing.

Two rulings, both mutation-verified: the section link is AWS's alone, and a rail path stored on a
non-AWS row is refused here as well as at the loader — belt and braces, because the cost of following
one is a 404 at the moment somebody is chasing a real problem.

The page also made an honest copy problem visible in the browser that no test would have caught: the
card was titled "Why this score" and the breakdown inside it carries its own disclosure with the same
words, so the heading appeared twice.

### One fix uncovering the next

The review listed `read/reports.ts` iterating AWS-only `PROBLEM_FAMILIES` as awareness-only, "double
gated behind the `resolveEnvironment` bug, so inert". **Fixing `resolveEnvironment` ungated it.** A
Google environment now resolves, so `GET /api/v1/reports` is reachable for one — and its families
section would have listed AWS's four at zero and left out `gcp_alerts`.

Worth reading the comment that was already there: "a family with nothing in either window is still
listed at zero — that is a measured zero, because `detect` ran over all of them." True of AWS and of
nothing else. For a Google project `detect` ran over `gcp_alerts` and none of AWS's four, so those
four zeroes would have been four *measured* claims about services the project does not have, made in a
report, beside the one family that actually was read being absent.

The lesson is about sequencing, not about reports: a defect listed as inert because something else is
broken stops being inert the moment that something else is fixed. Both were on the same list, one
marked critical and one marked awareness-only, and fixing the first is what armed the second.

`kindsOfFamily` and `familiesOf` widened to any cloud's family along the way; `SECTION_FAMILY` stayed
AWS's, because a monitoring *section* is an AWS service and that mapping is correctly not general.

### Two defects that only opening the page would show

Both found by looking at System status on a stack with three clouds on it, after every gate was green.

**`metrics` reported "not yet run in 22 environments".** It is AWS-only now, and those
twenty-two are the non-AWS ones it will never run in — so the figure read as a backlog and was really
"does not apply". A monitoring tool reporting itself as behind when it is not is the same class of
untruth as reporting an estate healthy when it is not; it just points the other way. `jobStatus` now
counts against the environments the job actually serves, and the same page reads "OK across all 10
environments".

**Every DigitalOcean account was a row saying `account`.** A scope stopped identifying an environment
the moment scopes became per-provider, so several accounts were several identical rows — on the page
whose entire job is telling an operator which of their environments OpsWatch cannot see. Each row now
carries the connection's name and says what kind of thing its scope is: *whole account*, *project
my-project-123*, *region eu-west-1*.

Neither would have been caught by a test, because neither is wrong in a way a test knows to ask about,
and neither is visible on an installation with one cloud. Part T's browser acceptance is not a
formality.

### Sweeping for the rest of one review finding

The review found `alertUrl` sending a Google notification into the AWS rail. One finding of that shape
is a reason to look for the others rather than to fix the one, and there were three more — every one
of them made reachable by fixing `resolveEnvironment`, which until this week could not resolve a
non-AWS environment at all:

  - **the weekly digest's `reportUrl`**, which is a 404 arriving by email once a week; and the digest
    was also calling `readReport` without a provider, so a Google summary would have counted AWS's
    four families
  - **search results for problems, alerts and incidents**, all built with `subsectionPath`
  - **the five "search in Containers / Instances / Redis / Kubernetes / Logs" rows**, offered for any
    environment — for a Google project, five rows proposing to search an estate that has none of them

`/c/{connection}/{scope}/…` resolves for an AWS connection and for nothing else. All four now branch
on the provider, and a single ruling walks every link a non-AWS search can produce and asserts none of
them starts `/c/`, so the next one is caught by shape rather than by somebody remembering.

### What is still only architecture

The CPU **cell** has never rendered with a number in it. There is no Google project behind the e2e
stack, so every read is refused and the column is exercised only by its own unit tests. The reader's
behaviour is pinned hard — five mutations, including reading a missing point as zero and trusting the
answer to have honoured the filter — but "a stopped instance shows *Not reported* rather than 0 %" has
been proven in a test and not seen on a screen. The roadmap already asks this question of every
integration; this is one of the ones whose answer is *architecture only*.

### A flake worth chasing to its cause

`09-settings` failed once in a full run: it saved a setting, navigated, and found the *previous*
value. The first save in that test waits for "Settings saved."; the second clicked and navigated
immediately, so the page could be rendered before the server action the click started had committed.

Not a product bug — the settings cache does drop its entry on save — but a test that intermittently
checked the state it meant to change, which is the same family as one that skips itself. Both are a
gate that is not guarding.

Worth writing down separately: **a single spec cannot be re-run against a used stack to reproduce
this.** `09-settings` asserts the fresh defaults, and the full run before it had already changed them,
so the solo run fails for a reason that has nothing to do with the flake. The only valid verification
is the whole suite on a `--force-recreate`d instance, which is what the gate discipline above says and
what it took three runs to remember.

### Retracting two DigitalOcean claims

Two things I shipped three checkpoints ago and could not actually support. Both were plausible, both
came from a real documentation page, and both were still wrong.

**Every droplet alert policy needs `do-agent`, not some of them.** I derived a per-metric split from
what a hypervisor can see, and put a badge on the rows I thought needed the agent. DigitalOcean's own
words about creating a policy are: *"Only Droplets with the DigitalOcean metrics agent installed are
available to select."* All twelve metrics, bandwidth included. So the guess was the wrong **shape** as
well as the wrong answer — the caveat belongs to the page once, not to each row, and an operator
reading "Enabled" needs to know it means enabled for the droplets that have the agent.

**Disk usage is not claimed to be agentless.** A graphs page lists "Disk Usage" as a default chart,
which is where the claim came from. But a hypervisor can count a guest's packets and its block-device
operations; how full a filesystem *inside* that guest is, it cannot see. The two do not reconcile, and
the honest position is to assert neither — the list is now bandwidth and disk I/O, which are
established, and the page says only that.

The pattern behind both, and behind the earlier backwards CPU/disk table: **a documentation page that
answers a nearby question is not an answer to yours.** The graphs page is about graphs, the alerts
page is about alerts, and reasoning across them is how three separate wrong claims got written down
with confidence.

### Cloud Logging, and the one place content enters

The mission hedged this one — "Cloud Logging where appropriate" — and the hedge is the design. **This
is the only part of a Google connection that reads content rather than figures.** Everything else
OpsWatch reads from Google is a count, a status or a number; a log line is whatever somebody's code
wrote, and it may contain anything at all. So:

  - it is behind a **third role, granted separately**, and the connection is complete without it
  - the role is `roles/logging.viewer` and deliberately **not** `roles/logging.privateLogViewer` —
    the narrower one excludes Data Access logs, which are the record of *which person read which
    record*. "What was my application saying" does not require an audit trail of people, and taking
    one because it is one role instead of two would be taking it by accident
  - the page explains the grant **before** it is asked for, with the command to copy
  - nothing read is stored, and nothing reaches an AI provider — checked, not asserted: the reader has
    exactly two callers, this page and the registry

**No operator text reaches the query.** Google's query language can address any field of any log, so a
free-text box wired into it is a way to ask a project questions this product never meant to offer.
What the operator chooses is a severity floor, checked against Google's own enum; the window is
computed here and every query is bounded by it.

The check list gained `logging` and the verdict did not: `gcpStatusOf` judges a connection on the
**required** checks alone. Counted in, a perfectly working project would show as degraded for
declining something optional — and a status that goes yellow for a deliberate choice teaches an
operator to ignore the colour on the one screen where it has to mean something.

Four mutations verified, including concatenating an unchecked severity into the filter, counting the
optional role in the verdict, and asking for the wide logging role instead of the narrow one.

### A raw key on the connections page, found by looking in French

A sweep of every new page at 360px in French turned up `Settings.integrations.detail.gcpFailing` and
`…doFailing` rendered **as those strings** on `/accounts`. Present since Google connections were
built, and visible only when a connection is *failing* — which is exactly when somebody is reading
that page.

Four pages render `` t(`detail.${key}`) `` against **four different namespaces**, and the keys had
been filed in three of them. `message-namespaces.test.ts` exists for precisely this mistake and could
not see it: it reads literal `t('…')` calls, and this key is composed at run time.

The guard that replaces it derives the key list from `integrations/status.ts` and the page-to-namespace
mapping from `INTEGRATION_SPECS.connectable`, so neither is a list kept by hand beside the real one.
Two things it does *not* do, both tempting and both wrong: assume the three blocks should be identical
(they are three audiences — `google` is sign-in, not connectable, and two of the pages never ask for
its sentences), and treat every quoted string on a `detailKey:` line as a key (`status === 'configured'`
sits on those lines, and taking it for a key is how a guard invents work).

### The logging slice, adversarially reviewed

Seven questions asked of the most security-sensitive thing in this mission — can operator input reach
Google's query language, does log content leak into the database or the AI feature or a URL or
unescaped HTML, is a refusal distinguishable from silence. **All seven came back clean**, and the
reasons are worth keeping: `gcpProjectId` is validated against Google's own project-id grammar at the
one place it is written; the severity is checked twice, independently; `recentLogEntries` has exactly
two callers and neither is anywhere near the AI path; log text is plain JSX children, which React
escapes.

Three findings, all verified here before acting:

**`gcpStatusOf` returned `ok` for a required check that was missing entirely** — as opposed to present
and denied. It *filtered* the array for required checks, so an absent `monitoring` contributed to
neither side of the comparison and one-of-one came out `ok`, indistinguishable from both passing. Not
reachable from the one caller, which always passes all three or none — but **"ok" arrived at by not
asking is the shape of an unearned green**, and an exported function should not rest on caller
discipline for it. Each required check is looked up by name now.

**"One entry cannot make this page enormous" held for `text` and nothing else.** A log id is chosen by
whatever wrote to the log, and the resource labels come from the same place, so an entry carrying a
50 kB `logName` walked onto the page. Both are capped now, and the fields render with `break-all`.

**A structured payload was stringified whole and then cut** — the expensive half first, on something
whose size Google chose. Fields are taken until the line is full instead.

The pattern in the first: a claim in a comment is a claim. "Cannot make the page enormous" was written
about the field in front of me and quietly generalised to the entry.

### The assistant did not know which cloud it was looking at

Checked "Ask OpsWatch" for the AWS-shaped assumption that has been everywhere else in this mission,
and mostly it is clean: the system prompt never says AWS, and `buildEvidence` reads generic store
functions, so a Google environment already produced correct evidence. `resolveEnvironment`'s fix even
made the endpoint reachable for one.

What was missing is smaller and worse than a broken link. The evidence said `Family gcp_alerts: 1 of 2
affected` and **never said whose estate it was**. A model that does not know which cloud it is looking
at will suggest a CloudWatch alarm for a Google project — confidently wrong advice, in the one part of
this product that has already admitted it is guessing, and the part a reader is least equipped to
check.

One line fixes it, and it is a *measured* line: the provider is on the connection, and the scope is
named in that cloud's own words through `scopeKindOf` — "a Google Cloud project (my-project)", "a
DigitalOcean account (account)", "an AWS region (eu-west-1)".

Both callers look the provider up rather than taking the default. The rail's action is AWS-only today
and would have been right by accident, which is the thing that stops being right without anyone
noticing.

### An incident with nowhere to be read — checked, and safe by construction

`runIncidentCycle` runs for every provider now, and an incident is visible only in the AWS section
rail. An incident opened for a Google problem would therefore exist, be notified, and have nowhere to
be read — the same shape as the notification link that 404s.

It cannot happen, and the reason is worth writing down rather than leaving as luck: §16 groups
**critical problems on one service**, a Google incident's subject is a `resource`, and
`outcomesFromInsights` sets `serviceId` only for service subjects. Null, so the rule skips it — two
critical Google problems in one cycle produce no candidate at all.

Pinned, because it is load-bearing and invisible: the day somebody gives Google a service-typed kind,
that test is what tells them the surface to read the incident on does not exist yet. Mutating
`gcp_incident_open` to `'service'` fails it.

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
- **What each provider measures without an agent is different, and I had it backwards.** An earlier
  version of this entry said DigitalOcean collects CPU from the hypervisor and needs `do-agent` for
  disk usage. **The opposite is true**, and the current documentation says so plainly:

  | | Without an agent | Needs the provider's agent |
  |---|---|---|
  | **Google Cloud** | CPU, disk, network, uptime (`compute.googleapis.com/…`) | memory, processes (Ops Agent, `agent.googleapis.com/…`) |
  | **DigitalOcean** | public/private bandwidth, disk I/O | **CPU**, load average, memory (`do-agent`). *Disk usage is not claimed either way* |

  So there is **no metric both clouds give agentlessly**, and CPU — the obvious first thing to reach
  for — is agentless on one and not the other. Any page that shows "CPU" for both without saying which
  is measured and which is missing would be inventing parity DigitalOcean does not offer. This is
  exactly what Part O is for: the wrong version above was plausible, consistent, and written from
  memory.
- **DigitalOcean's metric values are `[unixSeconds, "decimal string"]` pairs** under
  `data.result[].values`, with the labels on `data.result[].metric`. Bandwidth is in **Mbps**, and its
  endpoint needs `interface` (`public`/`private`) **and** `direction` (`inbound`/`outbound`) — so one
  droplet's public traffic is two requests, which is what bounds how many droplets a page can show.
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
- [x] **A section is only offered to the provider it is about.** Adding two providers left a live
      defect behind: every section under `/c/{id}/{region}` is a page about an AWS service, and a
      Google or DigitalOcean connection has regions and a usable status like any other — so it passed
      every check, appeared in the switcher with regions to click, and could be picked as the default
      environment a section link opens. The page then asked AWS about an account that does not exist,
      which an operator reads as "OpsWatch cannot see my project" rather than "this page is not about
      it". A section that is not about a provider is a 404 now, the switcher offers those connections
      as connections to open, and `preferredSelection` will not land anybody on one
- [x] **DigitalOcean, with the narrowest scope it offers.** A personal access token scoped to
      `droplet:read`, not the `api:read` alias — DigitalOcean's custom scopes make least privilege
      available, and asking for read-everything when the product reads one resource is asking for
      access with no plan for it. The token is encrypted, never returned to a page, and never put back
      into a field after an error, which is where a token ends up in a page's HTML. The paging
      constructs its own page numbers rather than following `links.pages.next`: fetching a URL out of
      a response body is an outbound request somebody else chose
- [x] **The journey, as one thing.** Connect the account, enrol the machine, the agent reports a
      filling disk and a Redis with no ceiling, the machine is matched to its EC2 instance, the
      account's Health page names it, the rule that would notify exists, and nothing leaves the
      instance because nobody configured anywhere for it to go. Every piece had tests; none of them
      said whether the *product* worked. `47-journey.spec.ts` walks it, and a product assembled from
      parts that each pass is exactly the product that does not
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
8. ~~DigitalOcean~~ — connected with `droplet:read`, droplets readable. **The owner's numbered queue
   is now complete.** What both new providers need next is the same thing: a monitoring surface whose
   sections are not ten AWS services (§G). That is a deliberate build, not something to grow one page
   at a time

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
