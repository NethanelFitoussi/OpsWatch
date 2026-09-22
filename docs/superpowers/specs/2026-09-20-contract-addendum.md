# Contract addendum — the Mobile agent's ten requests, ruled on

**2026-09-20.** The Mobile agent ran a production-hardening pass over every screen and reported ten places
where a genuinely useful improvement needed a field the server does not send. In each case the app did
without it and **stated nothing it could not know**, which is the right behaviour and the reason these are
requests rather than bugs. Its full rationale is in `docs/mobile/api-contract.md` on `feature/mobile`.

All ten are **accepted** and added to `packages/contract` as optional fields. Three needed a decision rather
than a field; those decisions are recorded below so the phase that implements them does not re-litigate them.

**Why add the shape now, before the server can fill it.** §32 makes `packages/contract` the single source of
truth for the API, the web app, the mobile app and OpenAPI, and §33.1 makes additive optional fields the
sanctioned way to extend it. Locking the shape once lets Mobile write its rendering once, and an absent
optional field already means "not available" — the same honesty rule as a `null` measurement. What it must
never become is a field the server fills with a **guess**; each ruling below says what the server may derive
and what it must leave absent.

## The ten, and what each one is

| # | Field | Ruling | Populated by |
|---|---|---|---|
| 1 | `alertSummary.resolvedAt` | Accepted as-is. Deriving it from `history[]` would mean guessing at provider status words, which the app was right to refuse. | Mission phase 4 (alerts) |
| 2 | `family.unavailable.message` | Accepted **with a change** — see below. | Phase 4 surfaces (Health) |
| 3 | `errorSummary.statusSince` | Accepted as-is. For a `regression`, `firstSeenAt` is the group's first ever sighting, so the list genuinely cannot say when it came back. | Phase 5 (Task 19) |
| 4 | `errorSummary.trend` | Accepted as the **enum**, not a series — see below. | Phase 5 (Task 19) |
| 5 | occurrence window | Accepted as an explicit window — see below. | Phase 5 (Task 19) |
| 6 | `errorDetail.deployments`, `errorDetail.repository` | Accepted as-is, mirroring `problemDetail` field for field. This is mission-2 Phases J and K arriving at the error group as well as the problem, which is where a stack trace actually lives. | Mission 2, Phases J–K |
| 7 | `change.at` | Accepted as-is. Without it the Morning Brief can group changes but not order them, so it cannot read as a hand-off. | Phase 4 (Task 17) |
| 8 | `investigation.concludedAt` | Accepted as-is. | Mission phase 5 |
| 9 | commit permalink | Accepted, and **the server builds the URL** — see below. | Mission 2, Phase K |
| 10 | `logEntry.links.deploymentId`, `.incidentId` | Accepted as-is. | §18 (log intelligence) |

**Still open, and correctly not a schema change:** `GET /logs/entries/{id}`, so a log line can be deep-linked
and reopened after a restart. It is a *route*, and the route registry is checked against the files on disk, so
it lands with the logs phase rather than as an entry describing nothing.

## The three that needed a decision

### 2 — an unreadable family says why, twice

The request was a human-readable `message`, because "Couldn't read: denied (AccessDenied)" is the most
trust-relevant line on Home and a token is not actionable.

Accepted, but **§12.2 requires every human-readable label to be returned twice**, and §24 forbids a
user-facing string in code. So `unavailable` gains three fields, not one:

- `messageKey` and `values` — the catalogue key and its parameters, so a client with the catalogue renders in
  its own locale.
- `message` — the same sentence already rendered, in the caller's locale, for a client that has no catalogue.

The API already localises this way: it resolves the caller's locale from `?locale=` or `Accept-Language` and
renders through `next-intl`. `reason` and `code` stay exactly as they are, for logic.

**The server may never put a provider's raw error text in `message`.** It names the permission and the
resource in OpsWatch's own words — "the IAM role cannot list CloudFront distributions" — because a provider
message is unbounded, untranslated, and occasionally carries an account identifier.

### 4 — trend is an enum on the summary, a series on the detail

The request offered either a `series` or a cheap `direction`. The **enum** is correct for a list, and it is
already decided: **D1** fixes `trend` on `problemSummary` as `'rising' | 'falling' | 'stable' | null` with a
written derivation — compare the two most recent values, `rising` above +5 %, `falling` below −5 %, `stable`
between, `null` when there is nothing to compare. The error group gets the same enum with the same rule, read
from its hourly occurrence rollups.

`errorDetail` already carries `trend?: series`, so the detail keeps the full shape and the list stays cheap.
`null` remains a legal answer and must be rendered as "no trend", never as `stable`.

`TRENDS` moves from `problems.ts` to `primitives.ts` so `errors.ts` can use it without importing `problems.ts`,
which would be a cycle. Both names are still exported from the package root, so nothing a client imports moves.

### 5 — a count without a window is not a count

The contract genuinely did not say whether `2,417` meant "in the last hour" or "ever", so the app printed a
bare number, which was the honest thing to do.

Ruling: `errorSummary.occurrencesWindow: { from, to } | null`. When it is **null the count is lifetime**,
since `firstSeenAt`. When present, `occurrences` and `affectedInstances` are both counted over exactly that
window. The server must never send a windowed count with the window omitted.

### 9 — the server builds the permalink

The app was right not to invent a URL shape: only the server knows the provider, the host and whether the
instance is talking to github.com or an enterprise host. So `commit.url` is built server-side and sent, and
`repositoryEvidence.fileUrl` does the same for the file and line range. Both optional: absent means the
provider is not one OpsWatch can build a link for, which is a fact, not a failure.

## What this does not change

- Every addition is **optional**. No field was renamed, none removed, and no existing field changed meaning,
  so a client written against the older shape keeps working — §33.1's rule, unchanged.
- The Mobile agent's parity check must still pass 65/65 after this. It does.
- None of these fields is populated yet, and `GET /server`'s feature flags still report `errors`, `alerts`,
  `logs` and the rest as false. A client gates on the flag, not on the field's existence.
