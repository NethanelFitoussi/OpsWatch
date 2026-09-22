# Recovery — where `feature/mobile` stands, and how to continue it

> **Why this file exists.** This branch has already survived one lost session. Nothing here depends on a chat
> transcript: this file, the git history and the fifteen documents beside it are enough for a fresh session to
> reconstruct the state and carry on. Keep it current — it is part of the work, not a report about it.

**Branch:** `feature/mobile` · **Base:** `7c471fd` on `main` · **Remote:** pushed to `origin/feature/mobile` after
every green checkpoint. **Never merged to `main`.**

The app is a standalone npm project in [`apps/mobile`](../../apps/mobile) with its own `package.json` and lockfile.
Everything this branch touches is under `apps/mobile/`, `docs/mobile/` and `.github/workflows/mobile*.yml`.

## The constraints this work is bound by

These came from the mission brief, not from the code, so they are written down here: nothing else in the repository
records that they were *required* rather than merely chosen. Each one is enforced somewhere, and that is where a
change to it has to be argued.

| Constraint | Where it lives now |
|---|---|
| One repository. No second `.git`, no separate mobile repo | The app is a directory in this repo |
| The app talks **only** to the OpsWatch server the user chose. Never to AWS, GitHub, Cloudflare or an AI provider | `src/api/http.ts` — one transport, one origin, cross-origin answers refused |
| No customer AWS / GitHub / Cloudflare / AI credential is ever stored in the app | Nothing reads or writes one; [privacy.md](privacy.md) lists everything that is stored |
| All privileged integrations stay server-side. The app reads; it does not administer | No integration-management screens exist |
| TLS verification is never silently disabled. Plain HTTP only for a local server, only in development builds, only with explicit consent | `src/lib/server-url.ts`, and the checkbox on Connect |
| The access token is in secure storage, never plain `AsyncStorage` | `src/state/storage.ts` `sessionKey()`, `expo-secure-store` |
| Tokens, passwords and provider keys are never logged | `src/lib/log.ts` — nine redaction rules, each with a test only it can satisfy |
| Notification payloads carry no credentials and no raw log content | [notifications.md](notifications.md#payload-rules) |
| Unavailable data is never shown as zero | `formatMetric` returns `NO_DATA`; [architecture.md](architecture.md#capability-discovery) |
| Causation is never asserted automatically | Investigations present evidence and hypotheses, never a cause |
| Do not publish, do not buy services, do not change production infrastructure | No credential exists in the repo to do any of it |

**One contract, not two.** The Web/API agent adopted this app's contract as canonical in `packages/contract`.
`src/api/contract.ts` is a temporary copy that must not be evolved independently; see *The contract switchover* below.

## Where the work stands

**Every screen in the brief exists** and is wired to the contract: Connect/Login, Home, Morning Brief, Problems,
Errors, Services, Infrastructure, Logs, Investigations, Alerts, Incidents, Synthetics, SLOs, Deployments, repository
evidence, Ask OpsWatch, global search, favorites, environments, settings. The remaining work is depth, verification
and the server-dependent items below — not new screens.

**Verified for real** — the table in [testing.md](testing.md#what-has-actually-been-verified) is the authority and
says what was *not* done as plainly as what was. In short: lint, typecheck and the Jest suite are green; the app has
been built as a release APK and run on an Android 15 emulator, including deep links, large font scales, landscape and
tablet geometry; the web export has been toured at six device profiles. **iOS has never been run** — this was
developed on Linux, and the iOS project has only ever been generated and read statically.

**Two security reviews** have been done and their findings closed; [security.md](security.md) keeps the findings as a
historical record rather than deleting them.

### Blocked on the server, and safe to leave blocked

None of these can be finished from this branch. Each is capability-gated, so the app behaves correctly today: it says
the server does not provide the feature rather than pretending it does.

| Item | What is missing | What the app does meanwhile |
|---|---|---|
| Push notifications end to end | No server implements `features.push`; needs an EAS project and APNs/FCM credentials | Local notifications work; the screen says push is unavailable ([notifications.md](notifications.md)) |
| Ask OpsWatch end to end | No server implements `features.ai` | The entry points are hidden by the capability gate |
| A single-log-entry endpoint | `GET /logs/{id}` does not exist in the contract | Deep links to a log line open the search that contains it ([api-contract.md](api-contract.md#contract-gaps--requests)) |
| Google sign-in | Needs a configured server and a real client id | The button appears only when the server advertises it |

### The contract switchover

`packages/contract` is on the server team's `feature/opswatch-intelligence` branch and **not yet on `main`**. Until it
is, this branch keeps its local copy and proves the two agree.

```bash
cd apps/mobile
OPSWATCH_CONTRACT_DIR=/path/to/packages/contract npx jest parity
```

Last run: **66/66** against their `3881b23`, which includes the ten additive fields they landed for this app. Metro
and Jest are already wired for the package, so the switchover is one file: `src/api/contract.ts` becomes a re-export
of `@opswatch/contract`, and the local schemas are deleted. [merge-notes.md](merge-notes.md) has the state table.

**Do not modify the Web/API worktree.** It is a separate checkout at a sibling path with its own branch checked out.
Read it, run parity against it, and record findings here or in `merge-notes.md` — never commit into it.

## Decisions that are not obvious from the code

- **The demo is a first-class client, not a fixture.** `src/demo/` implements the same client interface over a
  generated dataset, including degraded cases — an alert with no start time, a synthetic that never ran, a deployment
  with no commit, a resource with no metrics — so the empty and partial states are exercised in ordinary use.
- **`dev/mock-server.ts` speaks real HTTP** with no dependencies, so the transport, retries, timeouts and error
  mapping are tested against a socket rather than a mock.
- **Capability discovery distinguishes three states**, not two: available, *unavailable* (the server said no — nothing
  to retry) and *unknown* (we could not ask — offer a retry). Conflating them is the bug this exists to prevent.
- **The offline cache holds lists only**, in the OS cache directory so neither platform backs it up, bounded by age,
  count and size. Details, logs, stack traces, evidence and AI answers are never persisted.
- **Ages round so nothing looks fresher than it is.** A shared 15-second clock drives every relative time.
- **Sign-out clears locally first, then revokes.** A failed revoke must not leave a signed-in app.
- **The stack's native header is replaced while the demo banner is up.** Android hard-codes the toolbar's top inset,
  so the banner and the header both reserved the status bar height ([architecture.md](architecture.md#chrome-above-the-navigator)).

## How to pick up the work

1. `cd apps/mobile && npm ci && npm run check` — lint, typecheck and the full suite should be green.
2. Read [testing.md](testing.md#what-has-actually-been-verified) to see what is genuinely verified.
3. Re-run parity against the server branch (above) before changing anything in `src/api/contract.ts`.
4. For device work, `dev/device/tap.sh` taps **by label**; never hard-code coordinates, and always confirm the APK
   under test contains the change (check the bundle's timestamp — Gradle will happily package a stale one).

The quality bar this branch holds itself to: tests, lint, typecheck and parity green before every push; a device check
when the change is something only a device can show; and no claim in the docs that has not actually been run.
