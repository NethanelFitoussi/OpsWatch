/**
 * When a set of problems becomes an incident (§16).
 *
 * Pure. The rule is deliberately narrow, because the cost of the two mistakes is asymmetric: an incident
 * that should have been raised is one an operator finds a minute later on the Problems page, while an
 * incident raised for every transient blip trains everybody to ignore the word. So both triggers require a
 * **critical** problem, and the second also requires evidence that users are actually affected.
 */

/** §16's window: two critical problems on one service this close together are one event, not two. */
export const INCIDENT_WINDOW_MS = 15 * 60_000;
/** §16: a single critical problem that lasts this long on a user-facing service is an incident by itself. */
export const SUSTAINED_MS = 15 * 60_000;
/** §16: dismissing an auto-created incident suppresses auto-creation for that service for two hours. */
export const DISMISSAL_SUPPRESSION_MS = 2 * 60 * 60_000;

export type IncidentReason = 'multiple_critical' | 'sustained_critical';

export type CandidateProblem = {
  id: string;
  serviceId: string | null;
  severity: 'critical' | 'warning' | 'info';
  firstSeenAt: number;
  /**
   * §33.7's `u` term: how user-facing the subject is, or **null when nobody measured it**. A fresh subject
   * leaves it out rather than filling it with zero, so null must not be read as "not user-facing" — it is
   * read as "unknown", and the sustained rule declines to fire on an unknown.
   */
  userFacing: number | null;
};

export type IncidentCandidate = {
  serviceId: string;
  problemIds: string[];
  severity: 'critical';
  startedAt: number;
  reason: IncidentReason;
};

/**
 * Services that should have an incident right now.
 *
 * `suppressedUntil` carries the dismissals: a service whose auto-created incident was dismissed is left
 * alone until the suppression expires, which is what makes dismissal mean something. `existing` carries the
 * services that already have an open incident, so a second cycle does not open a second one.
 */
export function incidentCandidates(
  problems: readonly CandidateProblem[],
  nowMs: number,
  state: { suppressedUntil: ReadonlyMap<string, number>; existing: ReadonlySet<string> },
): IncidentCandidate[] {
  const byService = new Map<string, CandidateProblem[]>();
  for (const problem of problems) {
    // A problem with no service cannot be grouped into a service incident, and §16 describes no other kind.
    if (problem.serviceId === null || problem.severity !== 'critical') continue;
    byService.set(problem.serviceId, [...(byService.get(problem.serviceId) ?? []), problem]);
  }

  const candidates: IncidentCandidate[] = [];
  for (const [serviceId, critical] of [...byService.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (state.existing.has(serviceId)) continue;
    const suppressed = state.suppressedUntil.get(serviceId);
    if (suppressed !== undefined && suppressed > nowMs) continue;

    const sorted = [...critical].sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id));

    // §16, first trigger: two or more critical problems on one service within fifteen minutes.
    const together = sorted.filter((problem) => nowMs - problem.firstSeenAt <= INCIDENT_WINDOW_MS);
    if (together.length >= 2) {
      candidates.push({
        serviceId,
        problemIds: together.map((problem) => problem.id),
        severity: 'critical',
        startedAt: together[0].firstSeenAt,
        reason: 'multiple_critical',
      });
      continue;
    }

    // §16, second trigger: one critical problem lasting more than fifteen minutes on a user-facing service.
    // `userFacing === null` means nobody measured it, and an incident raised on an unmeasured assumption is
    // exactly the kind of noise that makes the word stop meaning anything.
    const sustained = sorted.find(
      (problem) => nowMs - problem.firstSeenAt > SUSTAINED_MS && problem.userFacing !== null && problem.userFacing > 0,
    );
    if (sustained !== undefined) {
      candidates.push({
        serviceId,
        problemIds: [sustained.id],
        severity: 'critical',
        startedAt: sustained.firstSeenAt,
        reason: 'sustained_critical',
      });
    }
  }

  return candidates;
}

/** When a dismissal stops suppressing, so the caller does not repeat §16's two hours in three places. */
export function suppressedUntil(dismissedAt: number): number {
  return dismissedAt + DISMISSAL_SUPPRESSION_MS;
}
