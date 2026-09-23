import 'server-only';
import type { Db } from '../db/client';
import type { ProblemRow } from '../db/schema';
import { incidentCandidates, type CandidateProblem } from '../detect/incident';
import { appendTimeline, attachProblem, listOpenIncidents, openIncident, suppressionsByService } from '../store/incidents';

/**
 * Turning problems into incidents, once per detect cycle (§16).
 *
 * Runs inside the detect job rather than as a job of its own: an incident is a statement about the problems
 * that cycle just wrote, and evaluating it five minutes later would open incidents for trouble that had
 * already passed.
 */

/** The projection the rule reads. `u` is §33.7's user-facing term, left null when nobody measured it. */
export function toCandidate(row: ProblemRow): CandidateProblem {
  return {
    id: row.id,
    serviceId: row.serviceId,
    severity: row.severity,
    firstSeenAt: row.firstSeenAt,
    userFacing: row.scoreTerms.u,
  };
}

export type IncidentCycleResult = { opened: number };

export function runIncidentCycle(
  db: Db,
  context: { connectionId: string; scope: string },
  live: readonly ProblemRow[],
  nowMs: number,
): IncidentCycleResult {
  const open = listOpenIncidents(db, context.connectionId, context.scope);
  const candidates = incidentCandidates(live.map(toCandidate), nowMs, {
    suppressedUntil: suppressionsByService(db, context.connectionId, context.scope, nowMs),
    // A service already inside an open incident does not get a second one.
    existing: new Set(open.flatMap((incident) => incident.serviceIds)),
  });

  let opened = 0;
  for (const candidate of candidates) {
    const incident = openIncident(db, {
      connectionId: context.connectionId,
      scope: context.scope,
      // A message key with placeholders, never a sentence: both languages have to say the same thing.
      titleKey: `Incidents.title.${candidate.reason}`,
      values: { service: candidate.serviceId, problems: candidate.problemIds.length },
      severity: candidate.severity,
      startedAt: candidate.startedAt,
      serviceIds: [candidate.serviceId],
      origin: 'auto',
    });

    for (const problemId of candidate.problemIds) attachProblem(db, incident.id, problemId);

    appendTimeline(db, {
      incidentId: incident.id,
      at: nowMs,
      kind: 'status_change',
      // Why it was raised, recorded at the moment it was raised: a reader asking "why is this an incident?"
      // should not have to reconstruct the rule from the problems.
      messageKey: `Incidents.opened.${candidate.reason}`,
      values: { service: candidate.serviceId, problems: candidate.problemIds.length },
    });
    opened += 1;
  }

  return { opened };
}
