# Recovery — where this branch stands, and how to continue it

> **Why this file exists.** A previous agent session was lost to a machine crash with a large amount of
> uncommitted work in the tree. Nothing here depends on a chat transcript surviving: this file plus the git
> history, the design spec and the implementation plan are enough for a fresh session to reconstruct the state
> and carry on. Keep it current — it is part of the work, not a report about it.

**Branch:** `feature/opswatch-intelligence` · **Base:** `7c471fd` · **Remote:** pushed to
`origin/feature/opswatch-intelligence` after every green checkpoint.

## The three documents that govern this work

| Document | What it is |
|---|---|
| `docs/superpowers/specs/2026-09-19-opswatch-intelligence-design.md` | The design. **§33 (peer review rulings) is binding and overrides every earlier section it contradicts**; §31–§32 override §1–§30. |
| `docs/superpowers/plans/2026-09-19-opswatch-intelligence.md` | The task-by-task plan. Its checkboxes are kept current as tasks land, so the first unticked step is the place to resume. **It writes out only Tasks 1–4**; see the note at the end of the hardening mission. |
| `docs/superpowers/plans/2026-09-20-product-hardening-and-remediation.md` | Mission 2, recorded 2026-09-20: product hardening, UX, security, settings and the Detect → Investigate → Locate → Explain → Propose workflow. The authority for everything after the intelligence plan. |
| `docs/superpowers/specs/2026-09-20-contract-addendum.md` | The Mobile agent's ten requests, ruled on, and which phase populates each field. |
| This file | The state of play, and the decisions that are not written in either of the above. |

## Where the work stands

**Recovered and committed** — the API slice that was in flight when the session was lost. It was audited
file by file, found essentially complete, and preserved rather than rewritten.

- `packages/contract` — the single source of truth for the API, the web app, the mobile app and OpenAPI.
- `/api/v1` — eight routes behind one handler, with a generated OpenAPI document.
- Audience-bound sessions — a `web` cookie and an `api` bearer token, neither replayable as the other.
- `src/lib/net/safe-fetch.ts` — pinned-address SSRF guard, groundwork for the synthetics of a later phase.

**Phase 1 — the store. Complete.** Tasks 1–4: the `problems` / `problem_evidence` store with its immutable
`seq` cursor, the append-only `events` spine with `collector_runs`, the collector lock claimed in one
conditional update, and incidents with their timeline and the retention rules. Migrations `0003`–`0006`.

**Phase 2 — the Problem engine. Complete.** Tasks 5–8: the problem key and the severity score with both
halves of §33.7; the three outcomes, the detector framework and the lifecycle with §33.5; fleet collapse and
expansion with hysteresis per §33.8; and the Stage 2 rules adapted as detectors. Everything under
`src/lib/detect/` is pure — no AWS, no clock, no database — and the boundary test enforces that rather than
trusting it, down to `Date.now()`.

**Next: Task 9**, the collector runtime and its cycle (Phase 3), then Tasks 10–12 (the `inventory` and
`detect` jobs, compaction, and the checkpoint where the engine runs headless). Then Phase 4 (the surfaces),
Phase 5 (error intelligence), Phase 6 (storage providers), then mission 2.

**Two things Phase 2 decided that later tasks depend on.** The Stage 2 rules are *adapted*, never copied —
`src/lib/detect/aws.ts` turns `Insight[]` into outcomes, and `insights.ts` remains the only place thresholds
live. And a grouped Stage 2 insight is **expanded back into its members**, because §33.8 makes fleet collapse
a lifecycle transition: `planFleet` collapses at the problem level, so the children exist and keep their
history. Task 10 owes the adapter two things it cannot know yet — real `minutesBreaching` from the live
problem's `firstSeenAt`, and family sizes for the blast radius. **The plan writes out only Tasks 1–4 as delivered** — Tasks 5–7 were derived from the spec and
written into it before being implemented, and every later task must be too, so a crash leaves the derived task
behind rather than only the memory of it.

**A note on tests, learned the hard way here.** Several rules in this engine are the kind a passing test does
not actually prove: the plan's own lock test passes for a read-then-write claim that loses the race, and a
boundary test written as `FLEET_MIN_MEMBERS - 1` follows a change to the constant and proves nothing. Every
safety-critical rule in Phases 1–2 has therefore been **mutation-tested** — break the rule, confirm a test
fails, restore — and spec constants are pinned as literals. Keep doing that.

**The V1 safety boundary, which overrides any task that appears to ask otherwise:** OpsWatch observes,
correlates, investigates and *proposes*. It never modifies a customer's infrastructure or repository, never
commits, pushes, opens a PR, deploys or rolls back, and never executes repository code. A proposed fix is
reviewed and applied by the user. Evidence is always labelled observed / correlated / hypothesis / proposed,
and an AI hypothesis is never presented as an observed fact.

## How to verify the tree before trusting it

```
npm test && npm run typecheck && npm run lint && npm run build && npx knip
```

Every task must leave all five green before it commits. E2E needs Docker and is run where a task says so:

```
docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e
docker compose -f docker-compose.test.yml down -v
```

**Known pre-existing knip findings (11).** `src/components/analysis/facets-panel.tsx` plus ten unused
exports/types under `lib/analysis`, `lib/auth/google.ts` and `lib/monitoring/shared`. They predate this
branch — verified identical at `3045142`. A task is green when it adds **no new** finding, not when knip is
silent.

**Prettier is not this repo's formatter.** There is no config and the tree is not prettier-clean under its
defaults. ESLint is the gate. Do not run `prettier --write` over a file: it rewrites single quotes to double
and reflows to 80 columns, which is churn against the house style.

## Decisions taken during recovery that are not in the spec or the plan

1. **Migration numbering shifted by one.** The plan predicts `drizzle/0002_*.sql` for Task 1. The recovered
   API work already took `0002` (the sessions `audience` and `last_used_at` columns), so Task 1 is `0003`,
   Task 2 is `0004`, and every later task shifts likewise. Nothing else about the migrations changes; they
   remain generated by `npm run db:generate` and are never hand-edited.

2. **`Db` carries `$client` on its type.** `src/lib/db/client.ts` now types the handle as
   `BetterSQLite3Database<typeof schema> & { $client: Database.Database }`. The store needs statements drizzle
   does not express, and the plan's own Task 1 test reaches for it. The boundary test keeps it below the store.

3. **Four repositories are grandfathered out of the §9.6 store rule.** Turning on "nothing outside `lib/db`
   and `lib/store` may import drizzle-orm" surfaced `lib/auth/admin.ts`, `lib/auth/sessions.ts`,
   `lib/connections/repository.ts` and `lib/settings/repository.ts`. Each is the same thing the rule asks for
   and none reaches for `.$client`; they simply live beside the feature that owns them. Migrating them is a
   refactor of its own. They are named in a **closed** list in `tests/unit/module-boundaries.test.ts`, with a
   test that withdraws an entry's cover as soon as it stops querying. **The list must not grow** — a new
   module that wants SQL belongs in `lib/store/`.

4. **OpenAPI path parameters are derived, not declared twice.** The recovered generator templated
   `/me/sessions/{id}` without declaring `id`, which is not a valid OpenAPI 3.1 document and leaves a
   generated client unable to see the segment. Parameters are now derived from each route's own path
   template, with two tests against drift.

5. **The problem key length-prefixes its parts.** §4.3 writes it as
   `sha256(connectionId + '|' + scope + '|' + kind + '|' + subjectId)`. That collides: `kind='a|b',
   subjectId='c'` and `kind='a', subjectId='b|c'` hash the same string, which would silently merge two
   unrelated subjects into one problem row. The parts are length-prefixed instead —
   `2:c1|9:us-east-1|12:ecs_cpu_high|8:prod/web` — keeping the spec's four inputs and its determinism without
   the ambiguity. The digest is pinned by a test against an independently computed value; **changing it
   re-keys every open problem in the field.**

6. **The container's data directory is pinned in `docker-compose.yml`, not left to `.env`.** A self-hosted
   installation lost its admin account and its encrypted credentials on `docker compose up --build`: `.env`
   is passed through `env_file` *and* is what `npm run dev` reads, so an `OPSWATCH_DATA_DIR` set for a local
   run sent the container's database into its own writable layer while the mounted volume stayed empty. The
   reported "Create admin came back" was the same bug, not a second one — with an empty database there
   genuinely was no admin, and `/login` correctly redirected to `/setup`. Compose now sets
   `OPSWATCH_DATA_DIR: /data` under `environment`, which outranks `env_file`. **Do not move it back into
   `.env`, and do not add a second writable volume** — one database is the whole backup story.
   `src/lib/db/storage.ts` warns at startup when the data directory is on an overlay or tmpfs mount, and
   `npm run verify:persistence` proves the whole thing against a real volume across a restart, a recreation
   and an image rebuild. The e2e suite cannot: `docker-compose.test.yml` uses tmpfs so each run starts empty,
   which is why this shipped unnoticed.

## Accepted trade-offs, reviewed and deliberately left as they are

Both came out of an independent peer review of `90ed109`, which raised no critical or important findings.

- **`validate()` in `src/lib/api/v1/envelope.ts` sends the raw value in production.** Outside production a
  response the contract rejects throws, so drift fails the suite. In production it is logged and the value is
  sent as-is, because a running instance answering 500 is worse than one answering a field a client ignores.
  The mechanism returns the **unvalidated** object on that path, so it does not strip unknown keys the way the
  success path does. No current route passes anything wider than an explicitly shaped literal, so there is no
  live exposure — but a future route that spreads a database row into its response would be sending that row
  verbatim on a validation failure. Shape the response object explicitly; do not spread a row into it.
- **`GET /api/v1/openapi.json` does not go through `apiJson()`.** It is the one response not checked against a
  contract schema. It still carries `cache-control: no-store` and the shared error handling, and its schema is
  deliberately loose, so this is a documented exception rather than a gap.

## The parallel Mobile agent

A second agent builds OpsWatch Mobile in the worktree `/var/www/html/OpsWatch-mobile` on `feature/mobile`.
**Do not modify that branch or that worktree.** Inspect it read-only.

`packages/contract` was seeded from `apps/mobile/src/api/contract.ts`, and that file stays authoritative field
by field: what the server must add is added as an **optional** field — never a rename, never a removal. The
mobile agent maintains a parity check that is the convergence gate for both sides. Run it against this
checkout without touching its branch:

```
cd /var/www/html/OpsWatch-mobile/apps/mobile
OPSWATCH_CONTRACT_DIR=/var/www/html/opswatch/packages/contract npx jest contract-parity
```

It passed 65/65 as of `90ed109`. **As of 2026-09-20 the check cannot run**: the Mobile agent's own
`jest.setup.ts` has a `jest.mock()` factory referencing an out-of-scope `parent`, so the suite fails before
any test executes. That is their work in progress, it has been reported to them, and their worktree must not
be touched to fix it. Until it compiles, verify the additive guarantee from this side instead —
`tests/unit/contract-additive.test.ts` fails if any exported name disappears, and diffing exported names
against `git show HEAD:packages/contract/*.ts` catches a removal directly.

The mobile app still uses its local copy; its switchover is one file, and it is waiting for
`packages/contract` to reach `main`. Tell it when that happens.

## Constraints that hold no matter what a task says

- **Read-only forever.** No write verb against a customer's AWS, Cloudflare or GitHub. No task adds an AWS
  action to `src/lib/aws/permissions.ts`, and `TEMPLATE_VERSION` stays 1.
- **Do not deploy, and do not touch AWS or any production infrastructure.** CloudFormation V2 may be prepared
  and tested locally but must never be deployed automatically.
- **Additive migrations only.** No existing table is rebuilt, no column altered or dropped.
- **No user-facing string in code.** Every one is a key in `messages/en.json` *and* `messages/fr.json`.
- **Nothing is faked.** A missing measurement is `null` and renders as "not measured", never `0`, never
  "healthy". An empty page is a bug.
- **Never weaken a security constraint to make a test pass.**

## Resuming after another session loss

Prefer reconstructing from this repository — it is designed to be sufficient:

1. `git log --oneline` on `feature/opswatch-intelligence`, and `git status` for anything uncommitted.
2. Read the spec, then this file, then the plan. The first unticked `- [ ]` step in the plan is the resume point.
3. Run the five gate commands above to confirm the tree is green before changing anything.
4. Audit any uncommitted work before overwriting it — the last crash left several thousand good lines behind,
   and they were worth keeping.

If the previous session's transcript is still on the same machine, `claude --resume` lists resumable sessions
and `claude --resume <id>` reopens one. Session ids are local to `~/.claude/` on that machine and are
deliberately not recorded in this repository; they are useless elsewhere, and this file is the supported path.
