# OpsWatch — full roadmap status

**Reconciled against `main` = `origin/main` = `5a494b9` on 2026-09-22, then updated as work landed.** Verified by reading the code, running
the gates, and walking the signed-in application in the running Docker instance — not by trusting what earlier
documents claim was finished.

This file is the durable source of truth for implementation status. A fresh session should be able to open it
and know what OpsWatch is meant to become, what genuinely works, and what to do next, without this
conversation.

## How to read a status

| Status | Means |
|---|---|
| `DONE` | The end-to-end behaviour exists: real data, reachable by a signed-in user, tested, seen in a browser |
| `PARTIAL` | Some of the journey works; a named piece is missing |
| `FOUNDATION_ONLY` | Schema, contract, store or job exists; no user can reach it |
| `NOT_STARTED` | Nothing beyond, at most, a contract schema |
| `BLOCKED_EXTERNAL` | Needs a credential, account or device nobody here has |
| `INTENTIONALLY_DEFERRED` | Decided against for this mission, with a reason |

A schema, a migration, a placeholder page, a demo fixture or an unused service is **not** `DONE`.

## Counts

| Status | Count |
|---|---|
| `DONE` | 70 |
| `PARTIAL` | 10 |
| `FOUNDATION_ONLY` | 3 |
| `NOT_STARTED` | 7 |
| `BLOCKED_EXTERNAL` | 4 |
| `INTENTIONALLY_DEFERRED` | 3 |
| **Total audited** | **97** |

Verification columns: **B**ackend · **A**PI · **C**ontract · **W**eb · **M**obile · **R**eal data · **T**ests ·
**V**erified in a browser. `·` means not applicable.


## Integrations and connections — the product-level view

**Added 2026-09-23, because the requirement counts were hiding a gap.** Sixty-odd small requirements being
`DONE` made OpsWatch look close to finished while it was still, in practice, an AWS-only product. A product
area is not `DONE` because its schema, its contract or its settings card exists — it is `DONE` when an
operator can connect the thing, see that it is healthy, use what it unlocks, and disconnect it again.

Read this table first. The detailed requirement tables below it are the implementation view of the same work.

| Integration | Connect | Credentials | Discovery | What it unlocks | Disconnect | Status |
|---|---|---|---|---|---|---|
| **AWS** | ✓ IAM role, ambient, access keys | ✓ encrypted, CloudFormation onboarding | ✓ regions, permission test | Every monitoring surface | ✓ | `DONE` |
| **GitHub / Repository** | ✓ token in Settings → Repositories | ✓ encrypted, write-only | ✗ no org/installation discovery | Stack frame → file link, service → repository mapping | ✓ | `PARTIAL` |
| **AI provider** | ✓ Settings → AI provider | ✓ encrypted, own derivation, never returned | · one connection, no discovery | Ask OpsWatch: `POST /ai/ask` and `overview/ask`, answered from bounded evidence | ✓ deletes the key | `DONE` (live provider acceptance `BLOCKED_EXTERNAL`) |
| **Cloudflare** | ✓ Settings → Cloudflare | ✓ encrypted, own derivation, never returned | ✓ zones discovered and chosen | Nothing yet — the analytics reads are CF-2 | ✓ deletes the token | `PARTIAL` |
| **Google sign-in** | ✓ environment-configured | · no stored secret: it lives in the environment | · | Sign-in, with an optional allowed domain | · unset the variables | `DONE` |

### What each one still needs

**AWS.** Nothing for V1. The only open item is the CloudFormation template v2 (AWS-5), which is the owner's
decision to deploy and must never be deployed automatically.

**GitHub / Repository.** The architecture is real and the deterministic half works without a credential:
repositories are stored, a service maps to one, and a stack frame resolves to a file link. What is missing
needs a token with `Contents: Read` — commits, changed files, diffs and the lines around a frame — plus
organisation and installation discovery, which needs a GitHub App. **`BLOCKED_EXTERNAL` for the live half
only**; everything that does not touch the network is buildable here and is tracked under REPO-*.

**AI provider.** Complete. Three providers behind one abstraction, an encrypted key that never returns to
the browser, a connection test, four honest states, and disconnect that deletes rather than flags. Ask
OpsWatch answers from a pack bounded by construction — eight worst problems, five deployments, five error
groups, a day, 32 KB — and an environment nobody has read is **refused** rather than answered. `features.ai`
is implemented and gated on `aiConfigured`, which is a *tested* connection rather than a stored key.
**`BLOCKED_EXTERNAL`: live acceptance against a real provider.** There is no API key here, so every test
runs against an injected transport. What that leaves unproven is one round trip, not the architecture.

**Cloudflare.** The connection is real: a token stored encrypted under its own derivation, verified through
`/user/tokens/verify`, zones **discovered and then chosen**. That last step is the one that matters — a token
can usually see every zone in an account, and reading all of them by default would put somebody else's
traffic on a page nobody asked for it on. A verified token watching no zone is `degraded`, not connected,
because it reads nothing.

What remains is CF-2: traffic, cache and security events, which is the GraphQL analytics API. **Only the
live acceptance is `BLOCKED_EXTERNAL`** — there is no Cloudflare account here, so every test runs against an
injected transport, which leaves one round trip unproven rather than the architecture. CF-3, Zero Trust,
additionally needs an account with Zero Trust enabled.

**Google sign-in.** Complete and in use: `openid-client`, a signed flow cookie with a ten-minute TTL, the
`hd` hosted-domain claim enforced when configured, three named failure codes on the login page, and password
sign-in unaffected. Its secrets live in the environment on purpose — a sign-in provider reconfigurable from
inside the application is a way to take the application over.

### The rule these are judged by

A credential must be encrypted at rest, must never be returned by a read path, must never appear in HTML, in
a log line, in an error message or in the canonical contract, and must be deletable. `npm run roadmap:check`
enforces the structural half: every available integration has somewhere to configure it, every unavailable
one links nowhere, and `.credentialCiphertext` is read in exactly one file.

---

## Core / AWS

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AWS-1 | Account connection | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-2 | Role / ambient / keys | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-3 | Permission testing, stored result | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Feeds Checkup's first finding |
| AWS-4 | CloudFormation template v1 | ✓ | ✓ | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-5 | CloudFormation template v2 | ✗ | ✗ | · | ✗ | · | ✗ | ✗ | ✗ | `NOT_STARTED` | §22: two new actions for ElastiCache + alarm history. Prepare and test; **never deploy automatically** |
| AWS-6 | Environments (connection × region) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-7 | ECS | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-8 | RDS | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-9 | ALB / ELB | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-10 | Alarms | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-11 | CloudWatch metrics | ✓ | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | `DONE` | — |
| AWS-12 | ElastiCache / Redis | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | Depends on AWS-5. Until the stack is updated the page must show "update your stack", not an empty grid |
| AWS-13 | CloudTrail | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `INTENTIONALLY_DEFERRED` | Not in any spec section; no IAM action requested |
| AWS-14 | CloudFront | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | Mobile's `family.unavailable` example names it; no collector reads it |

## Intelligence

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-1 | Collector runtime, scheduling | ✓ | ✓ | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Visible on System status |
| INT-2 | Single-writer lock (§33.4) | ✓ | ✓ | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Conditional UPDATE; refresh carries `AND owner = ?` |
| INT-3 | Job catalogue | ✓ | ✓ | · | ✓ | · | ✓ | ✓ | ✓ | `PARTIAL` | **11 jobs declared, 7 implemented** (`detect`, `errors`, `metrics`, `compact`, `deployments`, `synthetics`, `baselines`). `inventory`, `queries`, `logvolume` remain; `slo` is no longer needed, since the metrics job stores what §19 reads |
| INT-4 | Detector execution, isolation (§33.5) | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Fired / clear / not_evaluated |
| INT-5 | Problem identity (§33.2) | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Length-prefixed key; digest pinned |
| INT-6 | Lifecycle, reopen, flap | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| INT-7 | Severity and score (§33.7) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Fresh subjects rescale rather than zero-fill |
| INT-8 | Evidence bundle | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| INT-9 | Fleet collapse (§33.8) | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Lifecycle transition, hysteresis of 2 |
| INT-10 | Problems list | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Now filterable |
| INT-11 | Problem detail + "Why this score" | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| INT-12 | Health | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Distinguishes "healthy" from "cannot tell" |
| INT-13 | Morning brief | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| INT-14 | Checkup | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | `GET /api/v1/checkup` carries coverage as a required field. 6 checks read data OpsWatch does not collect and say so |
| INT-15 | System status | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |

## Errors

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ERR-1 | Fingerprints (§33.13) | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Survives a rebuild; mutation-verified |
| ERR-2 | Groups, hourly occurrences | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| ERR-3 | Collection job | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | — |
| ERR-4 | Logs Insights budget hard stop (§9.5) | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Stated on Errors, Log sources and Checkup |
| ERR-5 | Log sources: choose what is read | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Web only by design; mobile does not configure |
| ERR-6 | Errors list | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| ERR-7 | Error detail, stack, trend | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| ERR-8 | new / regressed / resolved | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| ERR-9 | Problem ↔ error correlation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | §4.4's detectors run in the errors cycle, on the same lifecycle as every other detector, and the group carries the id of the worse problem opened for it |
| ERR-10 | Pattern discovery (`pattern` command) | ✗ | ✗ | · | ✗ | · | ✗ | ✗ | ✗ | `NOT_STARTED` | §18/§29: availability unverified; must fall back to own fingerprinting |

## Logs

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| LOG-1 | Search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Non-v1 route; `features.logs` still false |
| LOG-2 | Volume and retention | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Costs nothing against the budget, and says so |
| LOG-3 | Endpoints / slow routes | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Runs on a button, not on load; field names validated, never escaped; shows real lines when the mapping matches nothing |
| LOG-4 | Single log entry endpoint | ✗ | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | Mobile asks for `GET /logs/{id}`; deep links currently open the surrounding search |
| LOG-5 | `features.logs` on `/api/v1` | ✗ | ✗ | ✓ | · | ✗ | ✗ | ✗ | ✗ | `FOUNDATION_ONLY` | Logs are served by the older non-v1 route; no v1 endpoint exists |

## Historical data

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| HIS-1 | `HistoricalStorageProvider` + conformance suite | ✓ | · | · | · | · | ✓ | ✓ | · | `DONE` | Five guarantees, each checked |
| HIS-2 | OpsWatch DB provider | ✓ | · | · | · | · | ✓ | ✓ | · | `DONE` | Passes the suite |
| HIS-3 | History switch, off by default (§31.1) | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Enforced at the schema default and before `resolveTarget` |
| HIS-4 | Intervals and retention settings | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | — |
| HIS-5 | Cost estimate per billing unit (§33.12) | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Never one blended number |
| HIS-6 | Retention purge actually running | ✓ | · | · | · | · | ✓ | ✓ | · | `DONE` | `compact` runs it daily at the operator's chosen retention. The dispatcher discarded every instance-scoped job, so this had never run |
| HIS-7 | Filesystem / export provider | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | The interface allows it; nobody wrote one |
| HIS-8 | Elasticsearch / OpenSearch provider | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `INTENTIONALLY_DEFERRED` | §C: a basic install must not require one |
| HIS-9 | Vector / semantic provider | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `INTENTIONALLY_DEFERRED` | Same reason; §Q says semantic *may* improve matching, deterministic first |
| HIS-10 | Backup / restore / export / migration | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | §F lists Backup/Export as a settings area |

## Reports

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| REP-1 | Section reports ×4 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | — |
| REP-2 | Previous-period comparison | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Half-open windows; mutation-verified |
| REP-3 | Markdown export | ✓ | ✓ | · | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Escaped; downloads with `nosniff` |
| REP-4 | Availability / SLO in a report | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Request-level availability and error budget from stored rollups, alongside the bucket share which still says what it is |
| REP-5 | Deployments and synthetics in a report | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Both are real. With nothing configured each says `not_collected`, which is a sharper answer than `not_measured` |
| REP-6 | Overview / logs reports | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | Only the four section reports exist |
| REP-7 | Weekly send when a notifier exists | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | Depends on ALE-4 |

## Investigation / correlation

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INV-1 | Investigation timeline | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `PARTIAL` | Rendered on Problem detail. No standalone investigation object or `/api/v1` route yet |
| INV-2 | Cross-signal correlation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Any two facts in the events spine sharing a subject or service, within §7's window, with the measured Δt |
| INV-3 | Observed fact vs correlation vs hypothesis | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Three headed groups, not badges on one list. Only a hypothesis carries a confidence, and five catalogue entries are declared unevaluated |
| INV-4 | Probable-cause evidence chain | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `PARTIAL` | Four of §5's eight hypotheses evaluated. `traffic_surge` joined them with §8's baselines; the rest need PI digests, Cloudflare or the dependency map, and are named in `NOT_EVALUATED` rather than omitted |
| INV-5 | Investigation workspace (§R) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | — |

## Deployments

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DEP-1 | Deployment collection | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Records ECS deployments and their outcome; visible in section reports |
| DEP-2 | Deployment ↔ problem correlation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Same service, within 30 min before, with the measured Δt. The card says it is a gap in time and not a cause |
| DEP-3 | Deployment history surface | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | `containers/deployments` and `GET /deployments`, `GET /deployments/{id}`. The detail names the problems that started after a deployment as a correlation, never a cause |

## Repository / GitHub

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| REPO-1 | GitHub connection | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `PARTIAL` | Settings → Repositories stores a write-only encrypted token. Live calls need a real token, which is the external blocker |
| REPO-2 | Repository storage | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | An operator can add, list and remove a repository with no credential at all |
| REPO-3 | Service → repository mapping | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Offered on Error detail where the question arises, with the suggestion stated as a guess and never applied |
| REPO-4 | Commits, metadata, diffs, files | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | `FOUNDATION_ONLY` | `commitSchema` exists |
| REPO-5 | Line-level code evidence | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | `PARTIAL` | Frame → file link on Error detail. The lines *around* a frame need a GitHub token (external) |
| REPO-6 | Deterministic code correlation (§J) | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Frame → repository path → link on Error detail, declining dependencies and unknown roots, and saying how many it placed |
| REPO-7 | Proposed fix + patch preview (§L, §O) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | Read-only against the customer repository |

## Alerts / Notifications

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALE-1 | Alert model and rules | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Rules and alerts, §15.1's install set created visibly, `/api/v1/alerts` and a page |
| ALE-2 | Alert lifecycle, acknowledge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Fire, suppress, refire, acknowledge and resolve, with rules that can be turned off — every change audited |
| ALE-3 | Notification preferences | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | `PARTIAL` | Stored per user and served on `/api/v1/me/preferences`. No web UI, because the web has no notifications to prefer yet |
| ALE-4 | Delivery (email / Slack / webhook) | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ | ✗ | `NOT_STARTED` | Deliberately last: §15 promises nothing leaves the instance until a notifier exists, and email needs a new runtime dependency |
| ALE-5 | Push notifications | ✗ | ✗ | ✓ | · | ✓ | ✗ | ✗ | ✗ | `BLOCKED_EXTERNAL` | Needs an EAS project and APNs/FCM credentials |
| ALE-6 | Deduplication / noise control | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | One alert per rule and subject, a 30-minute cooldown, and the suppressed count shown so the quiet is visible |

## Incidents

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INC-1 | Incident storage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Tables, store, producer, `/api/v1/incidents`, and a page in the Overview menu |
| INC-2 | Creation, lifecycle, resolution | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Raised automatically, moved along and dismissed from the detail page, every change audited |
| INC-3 | Related problems, timeline, evidence | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Detail page with the problems it links, the timeline, and notes kept as a separate list |

## Synthetics

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SYN-1 | Checks, status, history, failures | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Checks run from the host through the SSRF guard, with §14's status and latency rules, and `GET /synthetics` serves them. A check that has never run reports `unknown` with no figures |
| SYN-2 | Problem integration | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | The three detectors go through the same lifecycle as every other, so a failing check opens, flaps and resolves like a failing service |

## SLO

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SLO-1 | Definitions and measurement (§19) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Per-subject objectives are defined on `load-balancers/objectives`, measured from stored rollups, served at `GET /slos`, and used by reports in place of the default |
| SLO-2 | Error budget and burn rate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Budget and burn rate per objective, and §19's multi-window burn now raises an ordinary §15 alert under the `slo_burn` install rule |
| SLO-3 | "Not enough history" below a quarter | ✓ | ✓ | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Enforced in `evaluateSlo`; a sparse window yields no figure rather than a ratio over the fraction that exists |

## Cloudflare

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CF-1 | Account / zone integration | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Token stored encrypted, verified through `/user/tokens/verify`, zones discovered and **chosen**. Live acceptance against a real account is `BLOCKED_EXTERNAL` |
| CF-2 | Traffic, cache, security events | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `NOT_STARTED` | The connection and the zone selection exist (CF-1); the analytics reads do not. Every adaptive-dataset tile must carry the "estimated" marker when they land |
| CF-3 | Zero Trust sessions / identities | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `BLOCKED_EXTERNAL` | Needs a Cloudflare account with Zero Trust |

## AI / Ask OpsWatch

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AI-1 | Off by default | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | `DONE` | `features.ai` is false; no AI menu entry anywhere |
| AI-2 | Provider settings, encrypted credentials | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | Three providers behind one abstraction, key encrypted under its own derivation, never returned, deletable. Live acceptance against a real provider is `BLOCKED_EXTERNAL` |
| AI-3 | Provider connection test | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | One-token call, recorded as connected / invalid / unavailable. A provider's own error text never reaches the database or the page |
| AI-4 | Structured internal tools | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | `DONE` | The evidence pack is bounded by construction: eight worst problems, five deployments, five error groups, 24 hours, 32 KB. No SQL, no log lines, no credentials |
| AI-5 | Ask OpsWatch API + web UI | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | `POST /ai/ask` and `overview/ask`. The answer is rendered as a hypothesis beside its citations, and an environment nobody has read is refused rather than answered |
| AI-6 | No uncontrolled log/database dump | ✓ | · | · | · | · | ✓ | ✓ | · | `DONE` | Vacuously: nothing queries an AI. Must stay true when AI-4 lands |
| AI-7 | No automatic infrastructure/repo modification | ✓ | · | · | · | · | ✓ | ✓ | ✓ | `DONE` | No write path to AWS or a repository exists at all |

## API / Platform

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| API-1 | `/api/v1` with envelope and error model | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| API-2 | OpenAPI document | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | `DONE` | Path and query parameters both derived, never listed twice |
| API-3 | Canonical contract (§33.1 additive) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | `DONE` | Guard test fails if a name is removed |
| API-4 | Cursor pagination (§33.6) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Immutable `(seq, id)` |
| API-5 | List filtering | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | Honoured or 400; never silently dropped |
| API-6 | Capability flags | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| API-7 | Auth: cookie + bearer, audience-scoped | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | — |
| API-8 | Public API documentation | ✗ | ✗ | · | ✗ | · | ✗ | ✗ | ✗ | `NOT_STARTED` | The OpenAPI document is served; no prose guide (§Z) |

## UX

| ID | Requirement | B | A | C | W | M | R | T | V | Status | Missing / next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-1 | Navigation, section menus | · | · | · | ✓ | ✓ | · | ✓ | ✓ | `DONE` | `UNBUILT_SUBSECTIONS` is empty; no segment is disabled anywhere |
| UX-2 | EN / FR parity | · | · | · | ✓ | ✓ | · | ✓ | ✓ | `DONE` | Enforced by test |
| UX-3 | Responsive down to 360 px | · | · | · | ✓ | ✓ | · | ✓ | ✓ | `PARTIAL` | Every new page is tested at 360 px; §U's full pass across older pages is not done |
| UX-4 | Honest empty / unavailable / not-run states | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `DONE` | The product's central rule (§2.4, §2.6) |
| UX-5 | Loading and stale states | · | · | · | ✓ | ✓ | · | ✓ | ✓ | `DONE` | Suspense cards; problems mark staleness |
| UX-6 | Accessibility pass (§V) | · | · | · | ✗ | ✗ | · | ✗ | ✗ | `NOT_STARTED` | Severity is never colour-alone today, but no audit has been run |
| UX-7 | Dark mode | · | · | · | ✓ | ✓ | · | ✗ | ✗ | `PARTIAL` | Tokens exist throughout; never verified end to end |
| UX-8 | Onboarding wizard (§D) | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `PARTIAL` | Getting-started and setup exist; not the staged wizard §D describes |
| UX-9 | Integration centre (§E) | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `DONE` | `/settings/integrations` lists all five with measured state, what each enables and what access it asks for. An integration this build cannot complete says so and offers no link |
| UX-10 | Settings as a product (§F) | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | `PARTIAL` | General, Data & history, System status, and a link list. Users & Access, Security, Backup absent |
| UX-11 | Demo mode | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | `FOUNDATION_ONLY` | `serverInfo.demo` is hardcoded false |
| UX-12 | Global search | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | `NOT_STARTED` | §21's `search_index` |
| UX-13 | Audit log (§21) | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `DONE` | Append-only, admin-only, with sign-ins and every administrator write path recorded through one helper — including refusals and crashes |

## Mobile dependencies on this server

| ID | Mobile needs | Status here | What mobile does meanwhile |
|---|---|---|---|
| MOB-1 | Errors endpoints | `DONE` | Screens work against a real server |
| MOB-2 | System status | `DONE` | Screen built and shipping |
| MOB-3 | List filters | `DONE` | Was silently dropping them; fixed and declared in the contract |
| MOB-4 | Single log entry (`GET /logs/{id}`) | `NOT_STARTED` (LOG-4) | Deep links open the surrounding search |
| MOB-5 | Repository evidence | `FOUNDATION_ONLY` (REPO-5) | Gated by `features.repository` |
| MOB-6 | AI / Ask OpsWatch | `NOT_STARTED` (AI-5) | Entry points hidden by the capability gate |
| MOB-7 | Push devices + sender | `BLOCKED_EXTERNAL` (ALE-5) | Local notifications; screen says push is unavailable |
| MOB-8 | Session listing / revocation | `DONE` | `/me/sessions` exists |
| MOB-9 | `changeSchema.at` | `DONE` | Added; brief can place changes in time |
| MOB-10 | Contract package on `main` | `DONE` | `packages/contract` has been on `main` since 2026-09-20 |

---

## Remaining work queue, in dependency order

### DONE since this audit was written

**Checkpoint A — Logs → Endpoints (LOG-3).** Landed. `UNBUILT_SUBSECTIONS` is now **empty**: nothing anywhere
in the product says "Coming soon". An E2E walks every section menu and asserts no disabled entry remains.

### DONE

**Checkpoint B — the unimplemented collector jobs (INT-3).** `compact`, `deployments` and the availability
rollups are **done**, and with them HIS-6, DEP-1, REP-4, SLO-3 and half of REP-5. The `slo` job itself is no
longer needed for reports — the metrics job stores what §19 reads. Four remain: `inventory`, `queries`,
`logvolume` and `baselines`, none of which another requirement waits on. **So Checkpoint B is finished for
now**, and the queue moves to C.

### DONE

**Checkpoint C — Checkup on the API (INT-14).** Landed. `checkupSchema` is in the contract and
`GET /api/v1/checkup` serves it, with `coverage` as a required field so a client cannot render "no findings"
without saying how much of the catalogue answered.

### DONE

**Checkpoint E — Deployments → correlation (DEP-2, INV-2).** DEP-1 now records deployments, so the question
"was there a deployment near this problem?" is answerable from stored rows alone. This is the first piece of
the investigation engine and the one with the shortest path to being useful. Acceptance: a problem's detail
names deployments within a window of its `firstSeenAt`, labelled as **correlation, not cause** — §J is
explicit that timestamps correlating is never a claim of causation, and the UI must say which it is. Tests:
window arithmetic, the ordering, and the wording. Browser: required. Mobile: `deploymentSummary` already
exists in the contract, so the field is additive.

**Checkpoint D1 — per-service SLO definitions (SLO-1). DONE.** An operator writes their own target on
`load-balancers/objectives`; it is measured from stored rollups, served at `GET /slos`, and a report row now
uses the objective defined for that subject instead of the hard-wired 99.9 %. The metrics job also stores
p95 now, in a request of its own, so a latency objective has something to measure.

**Checkpoint D2 — burn-rate alerting (SLO-2). DONE.** A burning budget is now a candidate like any other:
it goes through §15's rules, cooldown and acknowledgement rather than being a second alerting system. The
fast burn wins over the slow one, so an environment burning fast is not also told about the slow burn it
obviously has. Install rule `slo_burn`, at `warning` so the slow burn — the one that leaves time to act —
is not dropped by a critical floor.

The install set is versioned now: `install_rule_offers` records which names an environment has been offered,
so a rule a later release ships reaches an installation that has been running for weeks, and a rule somebody
deleted still stays deleted.

### LATER

**Checkpoint F — Repository intelligence (REPO-1..6).**

The largest remaining block, and the one §J insists is deterministic *before* any AI. Needs an `integrations`
table and a `services` table, neither of which exists.

**Checkpoint G — Investigation workspace (INV-1..5).** Depends on E and F.

**Checkpoint H — AI (AI-2..5).** Last by design (§M): deterministic first, AI second, over a bounded context.

**Checkpoint I — Alerts, incidents, synthetics (ALE-*, INC-*, SYN-*).** Contract and mobile UI exist; each
needs a producer.

**Checkpoint J — The finishing passes (UX-3, UX-6, UX-7, API-8, §Z).** Accessibility, responsive, dark mode,
documentation. Genuinely last: they audit surfaces that must exist first.

### EXTERNAL BLOCKERS

| Item | Needs |
|---|---|
| ALE-5 push end to end | An EAS project and APNs/FCM credentials |
| CF-3 Cloudflare Zero Trust | A Cloudflare account with Zero Trust |
| Mobile store release | macOS, Apple and Google developer accounts |
| AWS-5 stack v2 deployment | The owner's decision. May be prepared and tested here, **never deployed automatically** |
| REPO-4/REPO-5 file contents, commits and diffs | A GitHub fine-grained token with Contents: Read. The storage, the mapping and the links are built and work without one |

---

## Keeping this current

```sh
npm run roadmap:check
```

Structural drift only — a segment with no page, a page still marked unbuilt, a declared filter its route
ignores, a capability advertised without a route, a stub marker in shipped source, documentation pointing at a
route that no longer exists. It prints contract schemas nothing serves as **notes**, since the contract is
allowed to run ahead of the server.

It will never tell you a feature is complete. Whether a page tells the truth when it has no data, and whether
an operator can finish the journey it exists for, are judgements it prints as questions and leaves to a person.

When a capability is finished: update its row here, update what remains, run the checker, and commit the status
change **with** the implementation so the two cannot drift.
