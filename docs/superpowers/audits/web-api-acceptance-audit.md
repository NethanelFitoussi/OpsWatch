# Web/API acceptance audit — 2026-09-22

**Verdict: the Web/API mission is a long way from acceptance.** The engine underneath is real and tested;
almost none of it has reached a page. A user signing in today can manage AWS accounts, change two settings,
and look at six monitoring pages. Everything the intelligence mission promised — Problems, Health, the Morning
brief, Errors, Investigations, Repository evidence, Reports, AI — returns **404**.

This document is written from the repository and from a browser walk of the running application, not from
memory of what was built.

## How this was verified

The application was built from `main`, started under Docker against a seeded AWS (moto) environment, an admin
was created through the real setup form, and a signed-in browser visited every navigation entry and every
route the mission asks for. What follows is what the browser actually rendered.

```
tests/audit/nav-walk.spec.ts          the walk
/tmp/nav-audit.json                   its raw output
```

### What the browser saw

| Route | Result |
|---|---|
| `/accounts`, `/settings` | real page, real data |
| `/overview/insights` | real page |
| `/containers/services`, `/databases/instances`, `/databases/queries`, `/load-balancers/list`, `/alarms/list`, `/logs/search` | real pages |
| `/c/<id>/<region>` (bare) | **404** — no redirect to the section default |
| `/overview/audit` | **404**, menu entry disabled "Coming soon" |
| `/containers/report`, `/databases/report`, `/load-balancers/report`, `/alarms/report` | **404**, menu entries disabled "Coming soon" |
| `/logs/volume`, `/logs/endpoints` | **404**, menu entries disabled "Coming soon" |
| `/overview/problems`, `/overview/health`, `/overview/brief` | **404**, no menu entry at all |
| `/errors`, `/services`, `/incidents`, `/synthetics`, `/alerts`, `/slos`, `/deployments`, `/repository`, `/ai`, `/system` | **404**, no menu entry at all |

## The unfinished-UI inventory

`Coming soon` appears in exactly one mechanism: `UNBUILT_SUBSECTIONS` in
`src/lib/monitoring/shared/sections.ts`, rendered as a disabled menu entry by `section-panel.tsx`. There are
**no** `TODO`, `FIXME`, `HACK`, stub or mock markers anywhere in `src/`, and no fabricated production data.

| Occurrence | Classification |
|---|---|
| `overview/audit` | **missing required feature** — §21's Checkup/Audit page |
| `containers/report`, `databases/report`, `load-balancers/report`, `alarms/report` | **missing required feature** — §19's reports |
| `logs/volume`, `logs/endpoints` | **missing required feature** — §18's log intelligence |

Nothing here is an obsolete placeholder, and nothing is a temporary implementation. All seven are features the
mission asked for that have not been built. The far larger gap is the set of surfaces that do not even have a
`Coming soon` entry, because no route exists for them at all.

## Area-by-area

`COMPLETE` means a real user can use the intended feature end to end. Backend, contract and tests do not earn
it.

| Area | Backend | API | UI | Real data | Tested | Status |
|---|---|---|---|---|---|---|
| Overview / Production Health | no | no | no | no | no | **NOT STARTED** |
| Morning Brief | no | no | no | no | no | **NOT STARTED** |
| Problems / Issues | store + engine | no | no | no | unit | **FOUNDATION ONLY** |
| Automatic problem detection | detectors exist, nothing runs them | no | no | no | unit | **FOUNDATION ONLY** |
| Severity / scoring | yes (§4.3 + §33.7) | no | no | no | unit | **FOUNDATION ONLY** |
| Evidence | stored, required by type | no | no | no | unit | **FOUNDATION ONLY** |
| Correlations | no | no | no | no | no | **NOT STARTED** |
| Automatic Investigation | no | no | no | no | no | **NOT STARTED** |
| Investigation timeline | incident timeline store only | no | no | no | unit | **FOUNDATION ONLY** |
| Errors / grouping / new-regressed-resolved | contract only | no | no | no | no | **FOUNDATION ONLY** |
| Stack traces | contract only | no | no | no | no | **FOUNDATION ONLY** |
| Services (domain) | no | no | no | no | no | **NOT STARTED** |
| Infrastructure | no | no | no | no | no | **NOT STARTED** |
| Logs (search) | yes | internal route | yes | yes | e2e | **COMPLETE** |
| Logs (volume, endpoints) | no | no | 404 | no | no | **NOT STARTED** |
| Databases (instances, queries) | yes | — | yes | yes | e2e | **COMPLETE** |
| Redis / ElastiCache | no | no | no | no | no | **NOT STARTED** |
| Cross-instance queries | yes | — | yes | yes | e2e | **COMPLETE** |
| Deployments / change correlation | contract only | no | no | no | no | **FOUNDATION ONLY** |
| Repository / GitHub | contract only | no | no | no | no | **FOUNDATION ONLY** |
| Service → repository mapping | no | no | no | no | no | **NOT STARTED** |
| Commit / diff / source evidence | contract only | no | no | no | no | **FOUNDATION ONLY** |
| Code file/line correlation | no | no | no | no | no | **NOT STARTED** |
| Synthetics | contract + safe-fetch guard | no | no | no | unit | **FOUNDATION ONLY** |
| Alerts (rules) | contract only | no | no | no | no | **FOUNDATION ONLY** |
| Notifications | no | no | no | no | no | **NOT STARTED** |
| Incidents | store + timeline | no | no | no | unit | **FOUNDATION ONLY** |
| SLOs | contract only | no | no | no | no | **FOUNDATION ONLY** |
| Reports | no | no | 404 ×4 | no | no | **NOT STARTED** |
| Historical collection | no | no | no | no | no | **NOT STARTED** |
| Historical storage provider | no | no | no | no | no | **NOT STARTED** |
| Retention | yes | no | no | n/a | unit | **FOUNDATION ONLY** |
| Collector runtime | lock + runs store only; **nothing runs** | no | no | no | unit | **FOUNDATION ONLY** |
| Cloudflare | no | no | no | no | no | **NOT STARTED** |
| AI configuration | no | no | no | no | no | **NOT STARTED** |
| Ask OpsWatch | no | no | no | no | no | **NOT STARTED** |
| AI contextual investigation | no | no | no | no | no | **NOT STARTED** |
| Settings | refresh + range only | no | partial | yes | unit+e2e | **PARTIAL** |
| Users / authentication | yes | yes | yes | yes | unit+e2e | **COMPLETE** |
| Integrations (centre) | AWS only, via Accounts | no | partial | yes | e2e | **PARTIAL** |
| Credentials persistence | yes, encrypted | — | yes | yes | unit+e2e | **COMPLETE** |
| Docker / self-hosting | yes | — | — | yes | persistence suite | **COMPLETE** |
| Backup foundations | documented procedure | — | no UI | — | manual | **PARTIAL** |
| API v1 | 8 routes | yes | n/a | yes | unit+e2e | **PARTIAL** (only `/environments` carries domain data) |
| OpenAPI | generated from contract | yes | n/a | yes | unit+e2e | **COMPLETE** |
| Shared contract | canonical, consumed by Mobile | n/a | n/a | n/a | unit | **COMPLETE** |
| EN/FR parity | enforced by test | — | yes | — | unit | **COMPLETE** |
| Responsive UI | existing pages only | — | partial | — | manual | **PARTIAL** |
| Demo mode | `serverInfo.demo` hardcoded false | no | no | no | no | **NOT STARTED** |
| System Status | `collector_runs` store only | no | 404 | no | unit | **FOUNDATION ONLY** |

## Reports — why they say "Coming soon"

Traced end to end:

```
UI       section menu renders `containers/report` disabled, because it is in UNBUILT_SUBSECTIONS
page     no route file exists -> a direct URL is a 404
service  none. There is no src/lib/read/reports.ts and no report domain service
API      none. /api/v1 has no reports route and the contract has no report schema
storage  none. Reports need §19's SLO rollups and the historical provider of §33.9/§33.10, neither built
source   nothing. Historical collection is off by default and the collector does not run at all
```

Reports are **not** blocked on a missing UI. They are the top of a column with nothing underneath it: a report
summarises history, history needs the collector running and a storage provider retaining rollups, and neither
exists. Making them real requires, in order: the collector runtime (Task 9), the metrics job behind the
history switch (Task 24), the `HistoricalStorageProvider` (Tasks 22–23), then a report service, contract
schema, API route and page. This is why they are P2/P3 rather than a quick win — a "Reports" page built now
could only show fabricated data, which §2.6 forbids.

## GitHub / repository intelligence — precisely what exists

**FOUNDATION ONLY, and the foundation is a contract schema alone.** Answering the specific questions:

| Can a user… | No, because |
|---|---|
| connect GitHub/repository access | there is no GitHub integration, no OAuth or PAT flow, no `integrations` table |
| configure a repository | nothing stores a repository |
| map a service to a repository | no `service_repositories` mapping, and no `services` table at all |
| see repository status | nothing to show |
| correlate an error with source | error groups are not collected; fingerprinting (Task 18) is not built |
| identify file/line | no stack-frame parsing |
| see commit/diff evidence | `repositoryEvidenceSchema` and `commitSchema` exist in the contract and are served by nothing |
| use repository evidence in an investigation | the investigation engine (§7) does not exist |
| have AI explain code evidence | no AI provider can be configured |

What exists is exactly: `packages/contract/repository.ts` (the wire shape, including the `commit.url` and
`fileUrl` permalinks added on 2026-09-20) and `problemDetail.repository` / `errorDetail.repository` fields that
no server code populates. That is the whole of it.

## Optional AI — explicitly not usable

**NOT STARTED.** A user cannot configure an AI provider anywhere: Settings offers only the refresh interval
and the default range. There is no provider record, no encrypted credential for one, no model or endpoint
field, no test-connection, no Ask OpsWatch UI, and no context builder.

The half that *is* honoured is the important architectural one: OpsWatch is fully functional without AI,
nothing calls a model, and `features.ai` correctly reports `false`. The evidence-kind separation the safety
model depends on exists in the contract (`evidence.kind` is `fact | correlation | hypothesis`) and in the
engine (phase 1 emits only observed facts). So the guardrails are in place before the capability — which is
the right order — but the capability is absent.

## Plan versus reality

Verified against code, not against the checkboxes.

| Task | Plan says | Reality |
|---|---|---|
| 1–4 (the store) | done | **implemented**, unit-tested, genuinely complete as a layer |
| 5–8 (the Problem engine) | done | **implemented**, pure, mutation-tested |
| 9–12 (the collector) | not started | **not implemented** — nothing ever runs a detector. This is the single most consequential gap: the engine cannot produce a problem because no cycle calls it |
| 13–17 (the surfaces) | not started | **not implemented** — Problems, Health, Brief have no routes |
| 18–21 (error intelligence) | not started | **not implemented** |
| 22–24 (storage providers) | not started | **not implemented** |
| 25 (checkpoint) | not started | **not implemented** |

The plan's checkboxes for Tasks 1–8 are accurate. Nothing is superseded. Nothing is blocked externally.

**The honest summary: the mission built the bottom two layers of a six-layer feature and none of the top
four.** Tasks 1–8 are 8 of 25, and the remaining 17 contain essentially all of the user-visible product.

## Capability flags

Every flag other than `environments` is `false`, and **every one of them is correctly false** — each names a
capability with no server implementation. None should be flipped until its feature works end to end.

| Flag | Why false | Enabled by |
|---|---|---|
| `health`, `brief`, `problems` | no read service, no API route, no page | Tasks 9–17 |
| `errors` | no collection, no fingerprinting, no store | Tasks 18–21 |
| `services` | no `services` table | mission phase 2 |
| `infrastructure` | no inventory read service | Task 10 + a surface |
| `logs` | search exists but not under `/api/v1` | a v1 logs route |
| `alerts`, `incidents`, `synthetics`, `slos`, `deployments`, `investigations`, `repository` | no implementation | mission phases 4–6 |
| `ai` | no provider configuration | mission phase 7 |
| `search`, `favorites` | no implementation | mission phase 7 |
| `push` | needs FCM/APNs credentials the owner has not created | out of scope, documented |

`IMPLEMENTED` in `src/lib/api/v1/features.ts` is the build's own statement of what it serves, and it is
currently truthful. That honesty is worth keeping: the Mobile app gates every screen on these flags.

## Remaining work, prioritised

### P0 — broken core, self-hosting, data safety
1. **`/c/<id>/<region>` returns 404.** A bare environment URL should redirect to the section default. Small,
   user-visible, and a plausible entry point from a bookmark or the API's environment id.

Nothing else is P0. Authentication, credential encryption, Docker persistence and migrations are complete and
verified.

### P1 — major promised user-facing functionality
2. **The collector runtime (Tasks 9–12).** Nothing else on this list can produce data without it. It is the
   gate in front of Problems, Health, Brief, System status and Reports alike.
3. **Problems list and Problem detail (Tasks 14–15)** — the object the whole mission is named for, with its
   evidence bundle and "Why this score".
4. **Health (Task 16)** and **Morning Brief (Task 17)** — the 30-second production experience.
5. **System status** — what the collector did, whether OpsWatch itself is healthy, and the distinction between
   "production is healthy" and "OpsWatch cannot tell".
6. **`/api/v1` domain routes** for the above, so Mobile's screens light up at the same time.

### P2 — intelligence and correlation
7. Error intelligence (Tasks 18–21): fingerprinting, groups, the errors surface.
8. Historical storage provider and the metrics job (Tasks 22–24), which unblocks Reports.
9. Reports (the four `*/report` pages) and `logs/volume`, `logs/endpoints`.
10. The Checkup/Audit page (`overview/audit`).
11. Deployment correlation and the investigation engine.

### P3 — integrations and polish
12. GitHub/repository connection, service→repository mapping, code evidence (mission-2 Phases I–K).
13. The Integration Centre and Settings as a first-class product (mission-2 Phases E–F).
14. Alerts, notifications, synthetics, SLOs.
15. Responsive and accessibility passes.

### P4 — genuinely optional
16. Optional AI, Ask OpsWatch, proposed fixes (mission-2 Phases L–P).
17. Cloudflare enrichment, demo mode, global search, favourites.

## What this means for sequencing

The collector is the bottleneck, not the pages. A Problems page built before Task 9 would have nothing to
list, and §2.6 forbids shipping an empty page that pretends otherwise. So the order is the plan's own order —
**Tasks 9–12, then 13–17** — and the first genuinely user-visible checkpoint arrives when the collector runs a
cycle and the Problems list shows what it found.

The P0 redirect is independent of all of it and is fixed first.
