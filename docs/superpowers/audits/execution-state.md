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
- [x] **Alarms, reports and Logs — rebuilt after the product was rejected on the running instance.** The
      first attempt shipped the AWS alarm identifier as the visible title, translation keys inside report
      rows, and a Logs page that was a column of log-group checkboxes beside a query textarea. What the
      rebuild changed, and why each was a defect rather than a preference:
      · **Metric-math alarms had no metric at all.** Application Insights creates alarms whose
        `MetricName`, `Namespace`, `Dimensions`, `Period` and `Statistic` are null, with the real metric
        inside `Metrics[].MetricStat` — so there was nothing to call them *but* their identifier. Reading
        the returned expression fixed the cause; `Dimensions: []` beating the query's dimensions was the
        second half of it.
      · **A deterministic metric catalogue** (32 families), not AI prose: the same words every render, in
        both locales, with the explanation, why it matters, and what to check.
      · **Titles are phrased for the state the alarm is in.** The family's sentence is written for the
        state it exists to catch, and printing it over an OK alarm put "crossed the threshold" under the
        heading *Healthy*.
      · **Reports and problems say what happened, not what it is called.** The detector stores ids
        (`metricKey`, `subjectKind`, `subjectName`) and `expandValues` turns them into words at render, so
        the row stays language-neutral and the sentence stays human.
      · **Three guards against a message key reaching a reader**, because next-intl renders a missing
        message as its own key path: no key may contain a dot, EN and FR must hold the same keys, and every
        key a report *composes at run time* must have a message. The third caught `openedCritical`.
      · **Logs was rearranged, not restyled**: search → filter → timeline → results → investigate. Sources
        are a popover, the query language is advanced, the empty state offers the four questions people
        arrive with, and on a phone the log lines come before the facets.
      · **UX-6 closed**: axe-core over 24 routes × 2 widths × 2 locales, zero WCAG 2.1 A/AA violations.
- [ ] Resume the remaining roadmap queue. Next by value, all dependency-ready:
      REP-6 overview and logs reports · REP-7 weekly send (ALE-4 unblocked it) ·
      HIS-10 backup/restore/export · INV-5 investigation workspace · API-8 public API guide ·
      UX-6 accessibility pass.
      Found blocked while surveying: **LOG-4** needs `logs:GetLogRecord`, which the role does not grant —
      it belongs with AWS-5's template version, not on its own. ALE-4's email and Slack halves each need a
      new runtime dependency and are not dependency-ready here.

## Standing constraints

- The running instance holds **real user data**: one AWS connection, a **real verified Cloudflare token**
  with `gigsberg.com` selected, four problems. Never `docker compose down -v`, never delete the volume,
  never revoke that connection.
- Secrets are never returned to a browser, never logged, never in the contract.
- Capability flags move only when the end-to-end behaviour genuinely exists; Mobile consumes them.
- Correlation is never rendered as cause. Observed → Correlated → Possible cause → AI hypothesis.
