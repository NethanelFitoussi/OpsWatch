import 'server-only';
import type { Db } from '../db/client';
import type { ProblemRow } from '../db/schema';
import { decide, ruleMatches, type Candidate } from '../detect/alert';
import {
  ensureInstallRules,
  findOpenAlert,
  listRules,
  openAlert,
  refireAlert,
  resolveAlertsExcept,
  suppressAlert,
  toRule,
} from '../store/alerts';
import { sloBurnCandidates } from './slo-burn';

/**
 * Turning live problems into alerts, once per detect cycle (§15).
 *
 * Every alert this build raises is **in-app**. §15 promises that installing OpsWatch never sends anything
 * outside the instance until a notifier exists, and the way that promise is kept is that there is no other
 * channel to choose — not a default somebody could change by accident.
 */

export type AlertCycleResult = { opened: number; refired: number; suppressed: number; resolved: number };

/** The projection the rules read, from a problem row. */
export function toCandidate(row: ProblemRow): Candidate {
  return {
    // The dedupe subject is the problem's own key, so one problem is one alert however often it is re-read.
    subjectKey: row.key,
    kind: row.kind,
    severity: row.severity,
    problemId: row.id,
    titleKey: row.titleKey,
    values: row.values,
  };
}

export function runAlertCycle(
  db: Db,
  context: { connectionId: string; scope: string },
  live: readonly ProblemRow[],
  nowMs: number,
): AlertCycleResult {
  // An environment gets §15.1's install rules it has not been offered yet: visible, editable, never hidden.
  ensureInstallRules(db, context.connectionId, context.scope, nowMs);

  const rules = listRules(db, context.connectionId, context.scope).map(toRule);
  const result: AlertCycleResult = { opened: 0, refired: 0, suppressed: 0, resolved: 0 };
  const stillFiring = new Set<string>();

  // §19's burn alerts are candidates like any other: they go through the same rules, the same cooldown and
  // the same acknowledgement, rather than being a second alerting system beside the first.
  const candidates = [...live.map(toCandidate), ...sloBurnCandidates(db, context, nowMs)];

  for (const candidate of candidates) {
    for (const rule of rules) {
      if (!ruleMatches(rule, candidate)) continue;

      const existing = findOpenAlert(db, `${rule.id}|${candidate.subjectKey}`);
      const decision = decide(
        rule,
        candidate,
        existing === null ? null : { dedupeKey: existing.dedupeKey, lastFiredAt: existing.lastFiredAt, status: existing.status },
        nowMs,
      );
      stillFiring.add(decision.dedupeKey);

      if (decision.action === 'open') {
        openAlert(db, {
          connectionId: context.connectionId,
          scope: context.scope,
          ruleId: rule.id,
          dedupeKey: decision.dedupeKey,
          problemId: candidate.problemId,
          titleKey: candidate.titleKey,
          values: candidate.values,
          severity: candidate.severity,
          at: nowMs,
        });
        result.opened += 1;
      } else if (decision.action === 'refire' && existing !== null) {
        refireAlert(db, existing.id, nowMs);
        result.refired += 1;
      } else if (existing !== null) {
        // Inside the cooldown, or acknowledged. Counted rather than dropped, so the page can say how many
        // fires the quiet covered.
        suppressAlert(db, existing.id, nowMs);
        result.suppressed += 1;
      }
    }
  }

  // Anything open that no live problem still matches has stopped: §15.2's resolution.
  result.resolved = resolveAlertsExcept(db, context.connectionId, context.scope, stillFiring, nowMs);
  return result;
}
