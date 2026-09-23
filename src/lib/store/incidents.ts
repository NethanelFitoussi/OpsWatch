import 'server-only';
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { randomId } from '../crypto';
import { DISMISSAL_SUPPRESSION_MS } from '../detect/incident';
import type { Db } from '../db/client';
import {
  incidentTimeline,
  incidents,
  problems,
  type IncidentRow,
  type IncidentStatus,
  type IncidentTimelineKind,
  type IncidentTimelineRow,
  type ProblemSeverity,
} from '../db/schema';

/**
 * Incidents and their timeline (§4.8, §16).
 *
 * Phase 1 ships the state, not the judgement: §16's auto-creation rules belong to a later phase. What exists here
 * is somewhere for a timeline to land and a way for a problem to point at an incident.
 *
 * There is deliberately **no** `incident_problems` join table. A problem belongs to at most one incident, so
 * `problems.incident_id` already carries the relation, and §4.8's `problemIds[]` is read back through it. A join
 * table would let a problem belong to two incidents, which is a state the product has no meaning for.
 */
export type NewIncident = {
  connectionId: string;
  scope: string;
  titleKey: string;
  values: Record<string, string | number>;
  severity: ProblemSeverity;
  startedAt: number;
  serviceIds: string[];
  origin: 'auto' | 'user';
};

export type NewTimelineEntry = {
  incidentId: string;
  at: number;
  kind: IncidentTimelineKind;
  eventId?: string;
  actorId?: string;
  messageKey?: string;
  values?: Record<string, string | number>;
  note?: string;
};

/** Opens an incident. It always starts `investigating`: nothing is identified before anyone has looked. */
export function openIncident(db: Db, input: NewIncident): IncidentRow {
  return db
    .insert(incidents)
    .values({ ...input, id: randomId(), status: 'investigating', resolvedAt: null, dismissedAt: null })
    .returning()
    .get();
}

export function appendTimeline(db: Db, input: NewTimelineEntry): IncidentTimelineRow {
  return db
    .insert(incidentTimeline)
    .values({
      id: randomId(),
      incidentId: input.incidentId,
      at: input.at,
      kind: input.kind,
      eventId: input.eventId ?? null,
      actorId: input.actorId ?? null,
      messageKey: input.messageKey ?? null,
      values: input.values ?? {},
      note: input.note ?? null,
    })
    .returning()
    .get();
}

/**
 * Puts a problem under an incident and records that it happened. Both writes are one transaction: an incident
 * whose timeline does not mention how a problem joined it is a story with a gap in it.
 */
export function attachProblem(db: Db, incidentId: string, problemId: string): void {
  db.transaction((tx) => {
    tx.update(problems).set({ incidentId }).where(eq(problems.id, problemId)).run();
    tx.insert(incidentTimeline)
      .values({
        id: randomId(),
        incidentId,
        // The attachment is dated by the problem it attaches, so the timeline reads in the order things happened.
        at: tx.select({ at: problems.firstSeenAt }).from(problems).where(eq(problems.id, problemId)).get()?.at ?? 0,
        kind: 'event',
        eventId: null,
        actorId: null,
        messageKey: null,
        values: { problemId },
        note: null,
      })
      .run();
  });
}

/** §4.8's `problemIds[]`, read back through the column that carries it. */
export function incidentProblemIds(db: Db, incidentId: string): string[] {
  return db
    .select({ id: problems.id })
    .from(problems)
    .where(eq(problems.incidentId, incidentId))
    .orderBy(asc(problems.seq))
    .all()
    .map((row) => row.id);
}

/**
 * Moves an incident along and writes the move into its timeline. `resolvedAt` is stamped only by `resolved`:
 * `monitoring` is not over, and a incident that went back to `investigating` must lose nothing by doing so.
 */
export function setIncidentStatus(
  db: Db,
  id: string,
  status: IncidentStatus,
  at: number,
  actorId: string | null,
): IncidentRow {
  return db.transaction((tx) => {
    const updated = tx
      .update(incidents)
      .set({ status, ...(status === 'resolved' ? { resolvedAt: at } : {}) })
      .where(eq(incidents.id, id))
      .returning()
      .get();
    tx.insert(incidentTimeline)
      .values({
        id: randomId(),
        incidentId: id,
        at,
        kind: 'status_change',
        eventId: null,
        actorId,
        messageKey: null,
        values: { status },
        note: null,
      })
      .run();
    return updated;
  });
}

/**
 * Marks an incident as not worth attention without claiming it is over. Dismissing is a statement about the
 * operator's interest; resolving is a statement about the system, and conflating them loses the difference.
 */
export function dismissIncident(db: Db, id: string, at: number, actorId: string): IncidentRow {
  return db.transaction((tx) => {
    const updated = tx.update(incidents).set({ dismissedAt: at }).where(eq(incidents.id, id)).returning().get();
    tx.insert(incidentTimeline)
      .values({
        id: randomId(),
        incidentId: id,
        at,
        kind: 'note',
        eventId: null,
        actorId,
        messageKey: null,
        values: { dismissed: 1 },
        note: null,
      })
      .run();
    return updated;
  });
}

export function findIncident(db: Db, id: string): IncidentRow | null {
  return db.select().from(incidents).where(eq(incidents.id, id)).get() ?? null;
}

/** §16: all timestamped, newest last. Ordered by the incident's own clock, not by the order rows were written. */
export function listTimeline(db: Db, incidentId: string): IncidentTimelineRow[] {
  return db
    .select()
    .from(incidentTimeline)
    .where(eq(incidentTimeline.incidentId, incidentId))
    .orderBy(asc(incidentTimeline.at), asc(incidentTimeline.seq))
    .all();
}

/** Open incidents in one environment, newest first. `dismissed` ones are not open. */
export function listOpenIncidents(db: Db, connectionId: string, scope: string): IncidentRow[] {
  return db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.connectionId, connectionId),
        eq(incidents.scope, scope),
        isNull(incidents.resolvedAt),
        isNull(incidents.dismissedAt),
      ),
    )
    .orderBy(desc(incidents.startedAt), desc(incidents.seq))
    .all();
}

/** Every incident in one environment, newest first, bounded. */
export function listIncidents(db: Db, connectionId: string, scope: string, limit: number): IncidentRow[] {
  return db
    .select()
    .from(incidents)
    .where(and(eq(incidents.connectionId, connectionId), eq(incidents.scope, scope)))
    .orderBy(desc(incidents.startedAt), desc(incidents.seq))
    .limit(limit)
    .all();
}

/**
 * When auto-creation is suppressed for each service, from the dismissals that are still in force (§16).
 *
 * Read from the rows rather than kept as separate state: a dismissal *is* the suppression, so there is no
 * second thing to keep in step with it.
 */
export function suppressionsByService(db: Db, connectionId: string, scope: string, nowMs: number): Map<string, number> {
  const rows = db
    .select()
    .from(incidents)
    .where(and(eq(incidents.connectionId, connectionId), eq(incidents.scope, scope), isNotNull(incidents.dismissedAt)))
    .all();

  const suppressions = new Map<string, number>();
  for (const row of rows) {
    if (row.dismissedAt === null) continue;
    const until = row.dismissedAt + DISMISSAL_SUPPRESSION_MS;
    if (until <= nowMs) continue;
    for (const serviceId of row.serviceIds) {
      // The latest dismissal wins, so dismissing twice extends rather than shortens the quiet.
      suppressions.set(serviceId, Math.max(suppressions.get(serviceId) ?? 0, until));
    }
  }
  return suppressions;
}
