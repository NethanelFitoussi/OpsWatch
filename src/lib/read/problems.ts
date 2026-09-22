import 'server-only';
import type { CursorPosition, Evidence, ProblemDetail, ProblemStatus, ProblemSummary, Trend } from '@opswatch/contract';
import { DEPLOYMENT_WINDOW_MS, correlateDeployments } from '../detect/correlate';
import type { Db } from '../db/client';
import { listDeployments } from '../store/deployments';
import type { ProblemEvidenceRow, ProblemRow, ProblemSeverity, ProblemStatus as StoredStatus } from '../db/schema';
import { isStale } from '../detect/lifecycle';
import {
  countProblemsBySeverity,
  findProblemById,
  listEvidence,
  pageProblems,
  type ProblemFilter,
} from '../store/problems';
import { TOP_PROBLEMS_LIMIT, pageLimit, toPage, toStoreCursor } from './paging';

/**
 * Problems, as every client reads them (§12, D1).
 *
 * A read service, not a route: the Problems page and `GET /api/v1/problems` call this one function, so the
 * browser and the phone cannot disagree about what a problem is. It is locale-free — the caller passes a
 * `render`, because only the caller knows who is asking — and it speaks the mobile contract's field names,
 * which §33.1 makes the source of truth.
 */

/** A problem opened within the last hour is `new`; after that it is simply `active` (D1). */
export const PROBLEM_NEW_MS = 60 * 60_000;

/** Renders a catalogue key with its values. The page binds it to next-intl; the API binds it to the caller's locale. */
export type Render = (key: string, values: Record<string, string | number>) => string;

export type ReadContext = { nowMs: number; render: Render };

/**
 * D1's status mapping. The stored lifecycle has four states and the wire has four, but they are not the same
 * four: `open` splits by age, and `closed` is not a thing a client needs to tell from `resolved`.
 */
export function wireStatus(row: ProblemRow, nowMs: number): ProblemStatus {
  if (row.status === 'acknowledged') return 'acknowledged';
  if (row.status === 'resolved' || row.status === 'closed') return 'resolved';
  return nowMs - row.firstSeenAt < PROBLEM_NEW_MS ? 'new' : 'active';
}

/**
 * D1's trend rule: compare the two most recent metric readings, `rising` above +5 %, `falling` below −5 %.
 *
 * In phase 1 the evidence bundle is restated each cycle rather than appended to, so there is usually only one
 * reading and the honest answer is `null` — which the contract requires clients to render as "no trend",
 * never as `stable`. The comparison is here so that the moment a bundle carries two, it is already right.
 */
export function trendOf(evidence: readonly ProblemEvidenceRow[]): Trend | null {
  const readings = evidence.filter((item) => item.kind === 'metric' && item.value !== null);
  if (readings.length < 2) return null;
  const [newer, older] = [...readings].sort((a, b) => b.at - a.at);
  const previous = older.value ?? 0;
  if (previous === 0) return null;
  const change = ((newer.value ?? 0) - previous) / Math.abs(previous);
  if (change > 0.05) return 'rising';
  return change < -0.05 ? 'falling' : 'stable';
}

function toEvidence(row: ProblemEvidenceRow, context: ReadContext): Evidence {
  return {
    id: row.id,
    at: row.at,
    // Phase 1 only ever records what a detector actually read, so every item is an observed fact. Correlations
    // and hypotheses arrive with the investigation engine, and must never be presented as facts before then.
    kind: 'fact',
    type: row.kind,
    title: context.render(row.labelKey, row.values),
    ...(row.value === null
      ? {}
      : { detail: row.unit === null ? String(row.value) : `${row.value} ${row.unit}` }),
  };
}

function toSummary(row: ProblemRow, evidence: readonly ProblemEvidenceRow[], context: ReadContext): ProblemSummary {
  return {
    id: row.id,
    key: row.key,
    title: context.render(row.titleKey, row.values),
    severity: row.severity,
    score: row.score,
    status: wireStatus(row, context.nowMs),
    // The detector id, verbatim and never translated: it is what a client groups and filters by.
    category: row.kind,
    ...(row.serviceId === null
      ? {}
      : { service: { type: 'service' as const, id: row.serviceId, label: row.subjectName } }),
    // Omitted when the subject *is* the service, because repeating it says nothing.
    ...(row.subjectType === 'service' ? {} : { resource: row.subjectName }),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    occurrences: row.occurrences,
    trend: trendOf(evidence),
  };
}

export type ProblemsQuery = {
  connectionId: string;
  scope: string;
  status?: readonly StoredStatus[];
  /** The contract's statuses, as a client sends them. Translated here; the store never sees a wire word. */
  wireStatus?: readonly ProblemStatus[];
  severity?: readonly ProblemSeverity[];
  serviceId?: string;
  sinceMs?: number;
  cursor?: CursorPosition | null;
  limit?: number;
};

/**
 * A wire status, as the store must ask for it.
 *
 * `new` and `active` are one stored state told apart by age, so each becomes a status plus a window on
 * `firstSeenAt`. Doing this in SQL rather than by filtering a page afterwards matters: a page filtered after
 * it was fetched is short by however many rows it dropped, and the cursor then skips the rest.
 */
export function statusWindowsFor(
  statuses: readonly ProblemStatus[],
  nowMs: number,
): { status: readonly StoredStatus[]; firstSeenFromMs?: number; firstSeenToMs?: number }[] {
  const boundary = nowMs - PROBLEM_NEW_MS;
  return statuses.map((status) => {
    if (status === 'acknowledged') return { status: ['acknowledged' as const] };
    // `closed` is a stored state no client is shown; to a reader it is resolved, so it answers here too.
    if (status === 'resolved') return { status: ['resolved' as const, 'closed' as const] };
    return status === 'new'
      ? { status: ['open' as const], firstSeenFromMs: boundary }
      : { status: ['open' as const], firstSeenToMs: boundary };
  });
}

/** One page of problems, oldest first on the immutable cursor axis. */
export function listProblems(db: Db, query: ProblemsQuery, context: ReadContext) {
  const filter: ProblemFilter = {
    connectionId: query.connectionId,
    scope: query.scope,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.wireStatus === undefined ? {} : { statusWindows: statusWindowsFor(query.wireStatus, context.nowMs) }),
    ...(query.severity === undefined ? {} : { severity: query.severity }),
    ...(query.serviceId === undefined ? {} : { serviceId: query.serviceId }),
    ...(query.sinceMs === undefined ? {} : { sinceMs: query.sinceMs }),
  };
  const page = pageProblems(db, filter, toStoreCursor(query.cursor ?? null), pageLimit(query.limit));
  return toPage(page, (row) => toSummary(row, listEvidence(db, row.id), context));
}

/**
 * The worst problems, ranked, with no cursor at all — §33.6's bounded top-N. Severity and score are what a
 * reader wants to sort by and exactly what a cursor may not run on, so this returns a complete set instead.
 */
export function topProblems(db: Db, query: { connectionId: string; scope: string }, context: ReadContext): ProblemSummary[] {
  const filter: ProblemFilter = { connectionId: query.connectionId, scope: query.scope, status: ['open', 'acknowledged'] };
  const all: ProblemRow[] = [];
  let cursor: { afterSeq: number; afterId: string } | null = null;
  // Ranked inside a bounded set, so the page is read out in full and then ordered.
  for (let guard = 0; guard < 20; guard += 1) {
    const page = pageProblems(db, filter, cursor, MAX_SCAN);
    all.push(...page.items);
    if (page.nextSeq === null || page.nextId === null) break;
    cursor = { afterSeq: page.nextSeq, afterId: page.nextId };
  }
  return all
    .sort((a, b) => b.score - a.score || b.lastSeenAt - a.lastSeenAt || a.id.localeCompare(b.id))
    .slice(0, TOP_PROBLEMS_LIMIT)
    .map((row) => toSummary(row, listEvidence(db, row.id), context));
}

/** How many rows one ranking pass reads at a time. The set it ranks is bounded by what is open. */
const MAX_SCAN = 200;

export function countBySeverity(db: Db, query: { connectionId: string; scope: string }) {
  return countProblemsBySeverity(db, { connectionId: query.connectionId, scope: query.scope, status: ['open', 'acknowledged'] });
}

/** Whether the collector has stopped looking at this problem's subject, which a page must say rather than hide. */
export function problemIsStale(row: ProblemRow, nowMs: number): boolean {
  return (
    row.resolvedAt === null &&
    isStale(
      {
        id: row.id,
        key: row.key,
        status: row.status,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        lastEvaluatedAt: row.lastEvaluatedAt,
        clearStreak: row.clearStreak,
        clearSinceAt: row.clearSinceAt,
        occurrences: row.occurrences,
        flapCount: row.flapCount,
        resolvedAt: row.resolvedAt,
      },
      nowMs,
    )
  );
}

export type ProblemDetailResult = { detail: ProblemDetail; row: ProblemRow } | null;

/** One problem, with the evidence that argued for it. Null when it does not exist in this environment. */
/**
 * Deployments of the same service that started shortly before the problem did (§7).
 *
 * Read from stored rows, so it costs nothing and works for a problem opened weeks ago — which is the point
 * of DEP-1 having written them down in the first place. An environment where the deployments job has never
 * run correlates with nothing, which is the honest answer rather than an empty list meaning "none happened".
 */
function correlatedDeployments(db: Db, row: ProblemRow) {
  const candidates = listDeployments(
    db,
    {
      connectionId: row.connectionId,
      scope: row.scope,
      ...(row.serviceId === null ? {} : { serviceId: row.serviceId }),
      sinceMs: row.firstSeenAt - DEPLOYMENT_WINDOW_MS,
      untilMs: row.firstSeenAt + 1,
    },
    20,
  );

  return correlateDeployments(candidates, { serviceId: row.serviceId, firstSeenAt: row.firstSeenAt }).map((correlated) => ({
    deployment: {
      id: correlated.deployment.deploymentId,
      service: { type: 'service' as const, id: correlated.deployment.serviceId, label: correlated.deployment.serviceName },
      version: correlated.deployment.taskDefinition,
      at: correlated.deployment.startedAt,
      status: correlated.deployment.status,
    },
    minutesBeforeProblem: correlated.minutesBefore,
  }));
}

export function getProblem(
  db: Db,
  query: { connectionId: string; scope: string; id: string },
  context: ReadContext,
): ProblemDetailResult {
  const row = findProblemById(db, query.id);
  // Scoped deliberately: a problem id from another environment must read as absent, not as someone else's.
  if (!row || row.connectionId !== query.connectionId || row.scope !== query.scope) return null;
  const evidence = listEvidence(db, row.id);
  return {
    row,
    detail: {
      ...toSummary(row, evidence, context),
      evidence: evidence.map((item) => toEvidence(item, context)),
      errors: [],
      metrics: [],
      // §7: a measured Δt and a declared relation, never a cause. Every surface rendering it says so.
      deployments: correlatedDeployments(db, row),
      repository: [],
      possibleCauses: [],
      alerts: [],
      // Acknowledging is the one thing phase 1 lets a reader do to a problem.
      allowedActions: row.status === 'acknowledged' ? [] : ['acknowledge'],
    },
  };
}
