import 'server-only';
import type { Db } from '../db/client';
import { randomId } from '../crypto';
import type { AlertRow, ProblemRow } from '../db/schema';
import { alertUrl } from '../notify/deliver';
import type { AlertPayload } from '../notify/payload';
import { destinationsFor, queueDelivery } from '../store/notifications';
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
import { machineCandidates } from './machine-alerts';
import { sloBurnCandidates } from './slo-burn';

/**
 * Turning live problems into alerts, once per detect cycle (§15).
 *
 * Every alert this build raises is **in-app**. §15 promises that installing OpsWatch never sends anything
 * outside the instance until a notifier exists, and the way that promise is kept is that there is no other
 * channel to choose — not a default somebody could change by accident.
 */

export type AlertCycleResult = { opened: number; refired: number; suppressed: number; resolved: number; queued: number };

/**
 * Queues one fire for every enabled destination.
 *
 * Queued rather than sent: the cycle's job is to decide, and a receiver that takes ten seconds to answer
 * must not hold a detect cycle open. The notify job sends, and retries what fails.
 */
function queueForDestinations(
  db: Db,
  context: { connectionId: string; scope: string },
  alert: AlertRow,
  candidate: Candidate,
  nowMs: number,
): number {
  // This environment's destinations, not the installation's. An unscoped destination still receives
  // everything — that is what a single-account installation means — but a destination that names an
  // account receives only that account's alerts, so one tenant's problems cannot reach another's endpoint.
  const destinations = destinationsFor(db, context.connectionId).filter((destination) => destination.enabled);
  for (const destination of destinations) {
    const payload: AlertPayload = {
      id: randomId(),
      alertId: alert.id,
      kind: 'alert.fired',
      severity: candidate.severity,
      // The key rather than the rendered sentence: a receiver in another language renders it itself, and
      // OpsWatch does not have to guess which language a webhook wants.
      title: candidate.titleKey,
      subject: candidate.subjectKey,
      environment: `${context.connectionId}:${context.scope}`,
      firedAt: nowMs,
      url: alertUrl(context.connectionId, context.scope, candidate.problemId, candidate.hostId ?? null),
    };
    queueDelivery(db, { destinationId: destination.id, alertId: alert.id, payload, nowMs });
  }
  return destinations.length;
}

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
  const result: AlertCycleResult = { opened: 0, refired: 0, suppressed: 0, resolved: 0, queued: 0 };
  const stillFiring = new Set<string>();

  // §19's burn alerts are candidates like any other: they go through the same rules, the same cooldown and
  // the same acknowledgement, rather than being a second alerting system beside the first.
  // Machines placed in this environment are candidates on the same terms: an agent's disk reading goes
  // through the same rules, cooldown and acknowledgement as a CloudWatch metric does.
  const candidates = [...live.map(toCandidate), ...sloBurnCandidates(db, context, nowMs), ...machineCandidates(db, context, nowMs)];

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
        const alert = openAlert(db, {
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
        // §15: only a fire leaves the instance, and only to a destination somebody created. A refire
        // inside the cooldown is deliberately silent — that is what the cooldown is for.
        result.queued += queueForDestinations(db, context, alert, candidate, nowMs);
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
