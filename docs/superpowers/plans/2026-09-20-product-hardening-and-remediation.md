# OpsWatch — Product hardening and code-level remediation (mission 2)

**Recorded 2026-09-20**, from the owner's brief, before starting. It is written down rather than held in a
session because the last session was lost to a crash. Treat this file as the mission statement: it is the
authority for everything after Phase 1 of
`docs/superpowers/plans/2026-09-19-opswatch-intelligence.md`.

## What changes

OpsWatch is no longer aiming only to be technically capable. It has to be **extremely simple to install and
connect, immediately understandable, trustworthy enough for production observability and repository access,
polished like a real product, useful without AI, and substantially more powerful when Git and optional AI are
configured.**

The defining V1 workflow it must build toward:

> **Detect → Investigate → Locate in code → Explain → Propose correction**

A user connects infrastructure and a repository; OpsWatch detects an operational problem, correlates it with
the relevant code and deployment, and offers a concrete proposed correction. **The proposal is where it stops.**

## The safety boundary — the rule the rest of the mission is built around

There is a hard architectural line between **observe / read / analyse / recommend** and **modify / execute /
deploy**. V1 lives entirely on the first side, and the line must be visible in the code architecture *and* in
the UI, not merely honoured by convention.

- Repository access is **read-only**. No commit, push, PR, merge, deploy or rollback — not as a feature and
  never as a side effect of investigating something.
- No customer AWS, GitHub or Cloudflare resource is modified. Human approval is mandatory and is not a
  checkbox OpsWatch can tick for itself.
- A proposed fix must **never** silently become a repository modification. The user applies it themselves.
- Repository code is never executed. Inspecting tests read-only is evidence; running them needs a separately
  designed sandbox and security model that does not exist.

## Evidence has four kinds, and they are never blurred

Every surface that presents a conclusion must keep these visibly apart. This is the product's credibility.

| Kind | What it is |
|---|---|
| **Observed** | Measured or retrieved directly. A fact. |
| **Correlated** | Related by time, resource or code mapping. **Never stated as causation.** |
| **Hypothesis** | Inferred. If a model inferred it, it is labelled as an AI hypothesis. |
| **Proposed change** | A suggested modification, with confidence, risks and how to validate it. |

Deterministic first, AI second, always. Without AI configured the product must still deliver the problem, its
evidence, the stack trace, repository/file mapping, deployment correlation, relevant commits and diffs, and
deterministic investigation guidance. AI enhances that bounded context — it never receives a raw production
dataset, and it never decides.

## The phases

Lettered as the owner gave them. They are not strictly sequential: A/B depend on the surfaces existing, and
J–P depend on repository intelligence, so the order below is the execution order, not the letter order.

| Phase | Area |
|---|---|
| **A** | Full product UX/UI review, walked as five real users: first-time self-hoster, developer, DevOps/SRE, CTO checking production in the morning, engineer in an incident. Fix real problems; do not redesign for novelty. |
| **B** | The 30-second production experience. Home, Health, Morning Brief, Problems and Investigations must answer ten questions fast: healthy? what is broken? how serious? when did it start? what changed? who is affected? what evidence? likely origin? is code involved? what should I do? Progressive disclosure, not ten dashboards. |
| **C** | Simplicity of installation. Clone → minimal env → `docker compose up` → browser → create admin → connect infrastructure → working. A basic install must not require AI, GitHub, Elasticsearch, a vector database, Cloudflare, notifications, historical collection or storage configuration. |
| **D** | Onboarding wizard, with progress, skippable optional steps, and failures explained as *what failed, why it matters, whether OpsWatch can continue, how to fix it* — never a raw AWS error where a safe explanation exists. |
| **E** | Integration Center: AWS, GitHub, Cloudflare, Slack, email, webhooks, AI, historical storage, semantic providers. Each shows connected / not connected / degraded / missing permissions / error, with connect, configure, test, reconnect, disable, remove. **No stored secret is ever exposed.** |
| **F** | Settings as a first-class product: General, Appearance, Users & Access, Environments (production visually unmistakable), Integrations, Data & History, Repository Intelligence, AI, Notifications, Synthetics, Alerts, Security, System, Backup/Export. **No meaningless toggles** — every setting has a real effect and a clear owner (device, user, environment, or instance). Advanced material goes in an Advanced area. |
| **G** | Adversarial security review. High priority. Auth, RBAC, sessions, tokens and scopes, secrets at rest, redaction, logs, audit, CSRF, SSRF, XSS, injection, SQL boundaries, path traversal, unsafe URLs, redirects, webhook validation, rate limiting, brute force, malformed and oversized payloads, external provider responses, repository content, AI prompt/data boundaries, multi-user and environment isolation, backup exposure, error-message leakage. Regression tests for every meaningful finding. |
| **H** | Least privilege across AWS IAM, GitHub and Cloudflare. Required permissions clearly separated from optional ones that unlock advanced capability. CloudFormation V2 may be prepared and tested but **never deployed automatically**, and V1 users keep a useful degraded experience. |
| **I** | Repository connection experience. Environment → Service → Deployment → Repository → Branch → Commit → Files. Explicit service-to-repository mapping the user can inspect and correct, not guesswork alone. |
| **J** | Automatic code correlation — a **deterministic pipeline before any AI**. Stack trace, file, line, function, service, route, deployment, commit SHA, recent commits, diff, branch, error fingerprint, first-seen. Timestamps correlating is never a claim of causation. |
| **K** | Code evidence on Problem detail: repository, deployment, first failing deployment, stack frame, recent change, relevant diff — each tagged with which of the four evidence kinds it is. |
| **L** | The V1 Proposed Fix: explanation, affected files, suggested change, patch preview, confidence, evidence used, risks, tests to run, validation steps, rollback consideration. |
| **M** | Deterministic first, AI second. Build the bounded structured context, then let optional AI reason over it. |
| **N** | Proposed-fix safety model — the four evidence kinds above, plus confidence and validation, always visible. |
| **O** | Patch preview as a unified diff, read-only against the customer repository. |
| **P** | Test recommendations: which unit/regression/integration test, expected metric improvement, expected error disappearance, log condition to watch. |
| **Q** | Similar incidents, deterministic matching first (same fingerprint, same service and route, same pattern); semantic indexing may improve it when enabled. |
| **R** | Investigation workspace — timeline, metrics, errors, logs, deployment, repository, code evidence, similar incidents, hypothesis, proposed fix, without losing Problem context. |
| **S** | Make the safe-action boundary explicit in architecture and UI. |
| **T** | Self-observability. System status covers API, database, collector, historical storage, jobs, integrations, repository access, notification providers, AI, semantic index, last successful and failed collection, backlog. **"Production is healthy" and "OpsWatch cannot currently determine production health" must never look the same.** |
| **U** | Responsive final pass: desktop, laptop, tablet, narrow mobile. No accidental horizontal overflow; code, diff and log viewers may scroll deliberately. |
| **V** | Accessibility: semantic HTML, keyboard, focus, dialogs, forms, labels, aria, severity that does not depend on colour alone, contrast, reduced motion, chart alternatives, screen readers. |
| **W** | Performance and **AWS cost**: duplicate AWS calls, unnecessary CloudWatch queries, N+1, expensive renders, excessive polling, unbounded lists, missing pagination, large payloads, caching and its invalidation, collector contention, database growth. Never improve UX by silently increasing AWS polling cost. |
| **X** | Repository-wide code quality: duplication (code, API logic, AWS logic, schemas), oversized files and functions, dead code, weak typing, unsafe casts, inconsistent validation and error handling, unnecessary dependencies, boundary violations, missing tests, security regressions. Refactor safely; do not over-engineer. |
| **Y** | Realistic end-to-end acceptance journey, as far as the environment safely permits — fresh install through to proposed correction, with missing data staying missing at every step. |
| **Z** | Documentation for the whole experience, including a plain statement of the V1 safety boundary. |

## Mobile stays converged

The Mobile agent continues on `feature/mobile`; **do not modify that branch or worktree.** When Web/API adds
Investigation, Repository Evidence or Proposed Fix capabilities that Mobile should eventually expose, extend
`packages/contract` cleanly — additively, optional fields only — rather than inventing Web-only undocumented
shapes. See `docs/RECOVERY.md` for the parity command.

## Sequencing decision

Phase 1 of the intelligence plan (the store) is done. The order of what follows, and why:

1. **Finish the intelligence plan's engine and surfaces** (its Tasks 5–21). A/B/R cannot be done against pages
   that do not exist, and J–L need the Problem, the evidence bundle and error fingerprints to correlate from.
2. **G (security) and H (least privilege) run alongside**, not at the end — a finding is cheapest to fix
   before the surface is built on top of it, and security is called out as high priority.
3. **C/D/E/F** once there is something to onboard into and configure.
4. **I → J → K → M → N → L → O → P → Q → R** in that order: connection, then deterministic correlation, then
   presentation of evidence, then bounded context, then the safety model, and only then the proposed fix that
   depends on all of it. The fix is built last because everything it asserts must already be earned.
5. **S/T** as the boundary and self-observability passes.
6. **A → U → V → W → X → Y → Z** as the finishing passes, in that order.

## A gap in the intelligence plan, found on 2026-09-20

`docs/superpowers/plans/2026-09-19-opswatch-intelligence.md` indexes 25 tasks but writes out **only Tasks
1–4** in executable detail; it ends mid-Phase-1. Tasks 5–25 exist as one-line entries in its Task index and as
paths in its File Structure.

They are not lost: the 945-line spec they are derived from is committed, binding, and detailed enough (§4.3
the Problem, §5 detectors, §7 the investigation engine, §9 storage and cost, §12 the API, §13 GitHub, §16
incidents, §23 AI, and §31–§33 which override everything earlier). The working practice from here:

> Before implementing a task beyond 4, derive its detail from the spec and **write it into the plan first**,
> then implement it. A crash then leaves the derived task behind rather than only the memory of it.
