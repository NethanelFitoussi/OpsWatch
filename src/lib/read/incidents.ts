import 'server-only';
import type { IncidentDetail, IncidentSummary } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { IncidentRow, IncidentTimelineRow } from '../db/schema';
import { findIncident, incidentProblemIds, listIncidents, listTimeline } from '../store/incidents';
import { findProblemById, listEvidence } from '../store/problems';
import { toSummary, type ReadContext } from './problems';

/**
 * Incidents, as every client reads them (§16, §12).
 *
 * The status mapping is the one place this differs from the store. The contract's statuses are what a reader
 * is shown; the stored ones include `dismissed`, which is a decision about *this product's* noise rather
 * than a state of the estate, so a dismissed incident is simply not listed.
 */

/** How many incidents one page carries. A list is a way in, not an archive. */
export const INCIDENT_LIMIT = 50;

/**
 * The stored lifecycle into the contract's, which are not the same four.
 *
 * `identified` means a cause is known and the work continues, which a reader experiences as still being
 * investigated — the contract has no separate word for it, and inventing one would be a breaking change for
 * the sake of a nuance. `monitoring` means the fix is in and somebody is watching, which is exactly what
 * `mitigated` says.
 */
export function wireIncidentStatus(status: IncidentRow['status']): IncidentSummary['status'] {
  if (status === 'resolved') return 'resolved';
  if (status === 'monitoring') return 'mitigated';
  return 'investigating';
}

/** Renders a key in the caller's locale. The service never builds a sentence itself (§12.2). */
export type IncidentLabels = { title: (key: string, values: Record<string, string | number>) => string };

function toIncidentSummary(row: IncidentRow, labels: IncidentLabels): IncidentSummary {
  return {
    id: row.id,
    title: labels.title(row.titleKey, row.values),
    severity: row.severity,
    status: wireIncidentStatus(row.status),
    startedAt: row.startedAt,
    resolvedAt: row.resolvedAt,
    affectedServices: row.serviceIds.map((serviceId) => ({ type: 'service' as const, id: serviceId, label: serviceId })),
  };
}

function timelineEntry(entry: IncidentTimelineRow, labels: IncidentLabels): IncidentDetail['timeline'][number] {
  return {
    at: entry.at,
    type: entry.kind,
    // A note is a person's own words and is shown verbatim; everything else is a key with placeholders.
    text: entry.note ?? (entry.messageKey === null ? '' : labels.title(entry.messageKey, entry.values ?? {})),
    ...(typeof entry.values?.problemId === 'string'
      ? { ref: { type: 'problem' as const, id: entry.values.problemId } }
      : {}),
  };
}

export function listIncidentSummaries(
  db: Db,
  query: { connectionId: string; scope: string },
  labels: IncidentLabels,
): IncidentSummary[] {
  return listIncidents(db, query.connectionId, query.scope, INCIDENT_LIMIT)
    // A dismissed incident is a decision about this product's noise, not a state of the estate.
    .filter((row) => row.dismissedAt === null)
    .map((row) => toIncidentSummary(row, labels));
}

export function getIncident(
  db: Db,
  query: { connectionId: string; scope: string; id: string },
  labels: IncidentLabels,
  context: ReadContext,
): { row: IncidentRow; detail: IncidentDetail } | null {
  const row = findIncident(db, query.id);
  // Scoped deliberately: an id from another environment reads as absent, not as somebody else's.
  if (row === null || row.connectionId !== query.connectionId || row.scope !== query.scope) return null;

  const entries = listTimeline(db, row.id);
  const problems = incidentProblemIds(db, row.id)
    .map((id) => findProblemById(db, id))
    .filter((problem): problem is NonNullable<typeof problem> => problem !== null)
    .map((problem) => toSummary(problem, listEvidence(db, problem.id), context));

  return {
    row,
    detail: {
      ...toIncidentSummary(row, labels),
      timeline: entries.filter((entry) => entry.kind !== 'note').map((entry) => timelineEntry(entry, labels)),
      problems,
      notes: entries
        .filter((entry) => entry.kind === 'note' && entry.note !== null)
        .map((entry) => ({ at: entry.at, text: entry.note ?? '', ...(entry.actorId === null ? {} : { author: entry.actorId }) })),
      // Dismissing is the one thing this build lets a reader do to an auto-created incident.
      allowedActions: row.origin === 'auto' && row.dismissedAt === null ? ['dismiss'] : [],
    },
  };
}
