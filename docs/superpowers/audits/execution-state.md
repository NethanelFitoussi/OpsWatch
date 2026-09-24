# Execution state

**Mode: continuous autonomous execution.** A checkpoint is an internal synchronisation boundary, not a
conversation boundary. This file exists so that a session which loses its context can resume without the
mission being restated.

## The standing loop

For every green checkpoint: implement → unit and adversarial tests → E2E → browser-verify on the running
instance → update `full-roadmap-status.md` → `npm run roadmap:check` → commit on
`feature/opswatch-intelligence` → `git fetch origin` → reconcile Mobile work → merge `--no-ff` into `main`
→ integration gates → push `origin/main` → verify → return to the feature branch → start the next
dependency-ready item immediately.

## Gate discipline

Never pipe a build, a typecheck or a test run through `head`. Closing the pipe can kill the process, and a
truncated log hides real errors — both happened, and cost a rebuild each. Write to a log file, report the
exit code, then grep the file.

## Current phase: product comprehension and UX

In order. Tick as they land.

- [x] Problem comprehension: headline, severity, duration, impact, detection rule, what to check
- [x] Problem visual evidence: lifecycle timeline, metric chart where history exists, unambiguous counters
- [x] Recommended investigation per detector family — every headline kind now has a rule, and possible causes are their own card
- [x] Cloudflare: a dashboard that shows what connecting it bought
- [x] Navigation collapsed by default — the main rail, not the inner section menu (corrected mid-flight)
- [x] Accounts: one card language across providers
- [x] Accounts: editable per provider
- [x] Full-site visual QA on the running product, and fixes — 41 routes swept and reviewed as images
- [x] Visual polish and text reduction — every page says its own name once; held by a ruling test
- [x] Visual infrastructure: patterns extracted and written down before any code
- [x] INF-1..3 evaluated health, primitives, ECS estate
- [x] INF-4 EC2 host map
- [x] INF-5 Redis, discovered through CloudWatch
- [x] INF-6 Kubernetes / EKS — Container Insights, cluster → namespace → workload → pod, boundary stated
- [x] DOC-1 categorised documentation — 17 guides, 6 categories, EN and FR, searchable, contextual links
- [x] Phase C full visual QA across every section, EN/FR, desktop and narrow
- [x] ALE-4 webhook delivery — the documentation described it, so it had to exist
- [ ] Resume the remaining roadmap queue

## Standing constraints

- The running instance holds **real user data**: one AWS connection, a **real verified Cloudflare token**
  with `gigsberg.com` selected, four problems. Never `docker compose down -v`, never delete the volume,
  never revoke that connection.
- Secrets are never returned to a browser, never logged, never in the contract.
- Capability flags move only when the end-to-end behaviour genuinely exists; Mobile consumes them.
- Correlation is never rendered as cause. Observed → Correlated → Possible cause → AI hypothesis.
