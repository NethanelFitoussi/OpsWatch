import 'server-only';
import type { Change, Family, Health, HealthStatus } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { FamilySnapshotRow } from '../db/schema';
import { listEvents } from '../store/events';
import { listFamilySnapshots } from '../store/health';
import { countBySeverity, topProblems, type ReadContext } from './problems';

/**
 * The health of one environment, right now (D1's `health`).
 *
 * It answers from the database alone: the detect job wrote down what each family looked like, so this page is
 * instant and costs nothing. Reading AWS here would make the first screen the slowest and the most expensive.
 *
 * The distinction the whole thing turns on: **"production is healthy" and "OpsWatch cannot tell you whether
 * production is healthy" are different answers.** A family nobody has read is `unknown` and says why; an
 * environment where nothing has been read at all is `unknown` overall. A monitoring tool that reports health
 * it has not measured is worse than one that admits the gap.
 */

/** The four families the detect job reads, in the order the page shows them. */
export const HEALTH_FAMILIES = ['ecs', 'rds', 'alb', 'alarms'] as const;
export type HealthFamily = (typeof HEALTH_FAMILIES)[number];

/** How long a change stays interesting on the Health page. The brief uses its own, wider, period. */
const RECENT_CHANGE_MS = 24 * 60 * 60_000;

/** Renders a family's name and its unavailability, in the caller's locale. */
export type HealthLabels = {
  family: (family: string) => string;
  unavailable: (reason: string, values: Record<string, string | number>) => { messageKey: string; message: string };
  change: (kind: string, values: Record<string, string | number>) => string;
};

export type HealthContext = ReadContext & { labels: HealthLabels };

function familyOf(snapshot: FamilySnapshotRow | undefined, family: string, labels: HealthLabels): Family {
  if (snapshot === undefined) {
    // Never read. Not healthy, not broken — unknown, which is the honest word.
    return { family, label: labels.family(family), status: 'unknown', total: null, affected: null };
  }
  const base: Family = {
    family,
    label: labels.family(family),
    status: snapshot.status,
    total: snapshot.total,
    affected: snapshot.affected,
  };
  if (snapshot.unavailableReason === null) return base;
  const rendered = labels.unavailable(snapshot.unavailableReason, { family: labels.family(family) });
  return {
    ...base,
    unavailable: {
      reason: snapshot.unavailableReason,
      ...(snapshot.unavailableCode === null ? {} : { code: snapshot.unavailableCode }),
      // §12.2: the sentence twice — the key for a client with the catalogue, the text for one without.
      messageKey: rendered.messageKey,
      values: { family: labels.family(family) },
      message: rendered.message,
    },
  };
}

/**
 * The environment's status, which is the worst thing known about it — except that "nothing has been read"
 * outranks "everything read is fine", because the second would be a claim and the first is an admission.
 */
export function overallStatus(families: readonly Family[], counts: { critical: number; warning: number }): HealthStatus {
  if (families.every((family) => family.status === 'unknown')) return 'unknown';
  if (counts.critical > 0 || families.some((family) => family.status === 'critical')) return 'critical';
  if (counts.warning > 0 || families.some((family) => family.status === 'degraded')) return 'degraded';
  return families.some((family) => family.status === 'unknown') ? 'degraded' : 'healthy';
}

/** The lifecycle events of a period, as the contract's `Change`. */
export function changesFrom(
  db: Db,
  query: { connectionId: string; scope: string; sinceMs: number; untilMs: number },
  labels: HealthLabels,
): Change[] {
  const DIRECTION: Record<string, Change['direction']> = {
    problem_opened: 'new',
    problem_reopened: 'up',
    problem_resolved: 'resolved',
  };
  return listEvents(db, { ...query, sinceMs: query.sinceMs, untilMs: query.untilMs }, null, 50)
    .items.filter((event) => event.kind in DIRECTION)
    .map((event) => ({
      id: event.id,
      direction: DIRECTION[event.kind],
      text: labels.change(event.kind, { subject: event.subjectId }),
      at: event.at,
      ...(event.severity === null ? {} : { severity: event.severity }),
      ...(typeof event.payload.problemId === 'string'
        ? { ref: { type: 'problem' as const, id: event.payload.problemId } }
        : {}),
    }))
    .reverse();
}

export function readHealth(db: Db, query: { connectionId: string; scope: string }, context: HealthContext): Health {
  const snapshots = new Map(listFamilySnapshots(db, query.connectionId, query.scope).map((row) => [row.family, row]));
  const families = HEALTH_FAMILIES.map((family) => familyOf(snapshots.get(family), family, context.labels));
  const counts = countBySeverity(db, query);
  const ranked = topProblems(db, query, context);
  const ecs = snapshots.get('ecs');

  return {
    generatedAt: context.nowMs,
    status: overallStatus(families, counts),
    counts: {
      critical: counts.critical,
      warning: counts.warning,
      // Services are what the ECS family counts. Null when it was never read — not zero, which would read
      // as "you have no services" rather than "we have not looked".
      healthyServices: ecs?.total === null || ecs === undefined ? null : ecs.total - (ecs.affected ?? 0),
      totalServices: ecs?.total ?? null,
    },
    families,
    topProblem: ranked[0] ?? null,
    // Nothing in this build measures these. `null` is the contract's word for that, and every client renders
    // it as "no data" rather than as a zero.
    activeAlerts: null,
    synthetics: null,
    recentIncidents: [],
    recentDeployments: [],
    changes: changesFrom(
      db,
      { ...query, sinceMs: context.nowMs - RECENT_CHANGE_MS, untilMs: context.nowMs },
      context.labels,
    ),
  };
}

/** Whether anything has been read at all, which is what tells a first run from a healthy environment. */
export function hasBeenRead(db: Db, query: { connectionId: string; scope: string }): boolean {
  return listFamilySnapshots(db, query.connectionId, query.scope).length > 0;
}
