import 'server-only';
import type { CursorPosition, ErrorDetail, ErrorSummary, ErrorStatus } from '@opswatch/contract';
import type { Db } from '../db/client';
import type { ErrorGroupRow } from '../db/schema';
import {
  countOccurrences,
  findErrorGroup,
  listLogSources,
  occurrenceSeries,
  pageErrorGroups,
  recentErrorGroups,
} from '../store/errors';
import { pageLimit, toPage, toStoreCursor } from './paging';

/**
 * Error groups, as every client reads them (§4.4, §12).
 *
 * The same read service the Errors page and `GET /api/v1/errors` both call, so the browser and the phone
 * cannot disagree about what an error is.
 */

/** The window a list counts occurrences over by default: recent enough to mean "now". */
export const ERROR_COUNT_WINDOW_MS = 24 * 60 * 60_000;
/** How many groups each of the "what's new" sets shows. */
export const WHATS_NEW_LIMIT = 5;

export type ErrorReadContext = { nowMs: number };

/**
 * The stored status maps straight through, except `ongoing`, which the contract calls `recurring` — the
 * wire word, which §33.1 makes authoritative.
 */
export function wireErrorStatus(status: ErrorGroupRow['status']): ErrorStatus {
  if (status === 'ongoing' || status === 'muted') return 'recurring';
  if (status === 'regressed') return 'regression';
  return status === 'resolved' ? 'resolved' : 'new';
}

function toSummary(db: Db, row: ErrorGroupRow, context: ErrorReadContext): ErrorSummary {
  const window = { from: context.nowMs - ERROR_COUNT_WINDOW_MS, to: context.nowMs };
  const counted = countOccurrences(db, row.id, window);
  return {
    id: row.id,
    message: row.sampleMessage,
    ...(row.exceptionType === null ? {} : { type: row.exceptionType }),
    status: wireErrorStatus(row.status),
    ...(row.serviceId === null ? {} : { service: { type: 'service' as const, id: row.serviceId } }),
    occurrences: counted.count,
    affectedInstances: counted.instances,
    // The window is stated rather than left ambiguous: a count without one is not a count.
    occurrencesWindow: window,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    // For a regression this says when it came back, which is the whole point of that state.
    statusSince: row.statusSince,
    trend: trendOf(db, row, context.nowMs),
    ...(row.problemId === null ? {} : { problemId: row.problemId }),
  };
}

/**
 * D1's trend rule applied to the hourly rollups: the newer hour against the one before it, ±5 %.
 *
 * `null` when there are not two hours to compare, and `null` renders as "no trend" rather than as `stable`.
 */
function trendOf(db: Db, row: ErrorGroupRow, nowMs: number): ErrorSummary['trend'] {
  const series = occurrenceSeries(db, row.id, nowMs - 3 * 60 * 60_000);
  if (series.length < 2) return null;
  const previous = series[series.length - 2].count;
  const latest = series[series.length - 1].count;
  if (previous === 0) return null;
  const change = (latest - previous) / previous;
  if (change > 0.05) return 'rising';
  return change < -0.05 ? 'falling' : 'stable';
}

export type ErrorsQuery = {
  connectionId: string;
  scope: string;
  status?: readonly ErrorGroupRow['status'][];
  /** The contract's statuses, as a client sends them. Translated below; the store never sees a wire word. */
  wireStatus?: readonly ErrorStatus[];
  serviceId?: string;
  sinceMs?: number;
  cursor?: CursorPosition | null;
  limit?: number;
};

/**
 * A wire status, as the store stores it — the inverse of `wireErrorStatus`.
 *
 * `recurring` covers both `ongoing` and `muted`, because muting is a decision about notification and not a
 * change in what the group is doing. A client asking for recurring groups means both.
 */
export function storedErrorStatuses(statuses: readonly ErrorStatus[]): ErrorGroupRow['status'][] {
  const map: Record<ErrorStatus, ErrorGroupRow['status'][]> = {
    new: ['new'],
    recurring: ['ongoing', 'muted'],
    regression: ['regressed'],
    resolved: ['resolved'],
  };
  return [...new Set(statuses.flatMap((status) => map[status]))];
}

export function listErrors(db: Db, query: ErrorsQuery, context: ErrorReadContext) {
  const page = pageErrorGroups(
    db,
    {
      connectionId: query.connectionId,
      scope: query.scope,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.wireStatus === undefined ? {} : { status: storedErrorStatuses(query.wireStatus) }),
      ...(query.serviceId === undefined ? {} : { serviceId: query.serviceId }),
      ...(query.sinceMs === undefined ? {} : { sinceMs: query.sinceMs }),
    },
    toStoreCursor(query.cursor ?? null),
    pageLimit(query.limit),
  );
  return toPage(page, (row) => toSummary(db, row, context));
}

export function getError(
  db: Db,
  query: { connectionId: string; scope: string; id: string },
  context: ErrorReadContext,
): ErrorDetail | null {
  const row = findErrorGroup(db, query.id);
  // Scoped: a group id from another environment reads as absent, not as somebody else's.
  if (!row || row.connectionId !== query.connectionId || row.scope !== query.scope) return null;

  const series = occurrenceSeries(db, row.id, context.nowMs - 7 * 24 * 60 * 60_000);
  // `errorDetail` overrides `trend` with the full series, so the summary's direction enum is dropped here
  // rather than colliding with it. A detail screen has the shape and can read the direction off it; a list
  // has the enum and stays cheap. That split is what the contract addendum ruled.
  // Typed as the summary minus its `trend`, because `errorDetail` replaces that field with the full series.
  const { trend, ...summary }: ErrorSummary = toSummary(db, row, context);
  void trend;
  return {
    ...summary,
    // The frames the fingerprint was computed over, which is what makes two occurrences one group.
    frames: row.topFrames.map((frame) => {
      const [file, fn] = frame.split(':');
      return { ...(file ? { file } : {}), ...(fn ? { function: fn } : {}), inApp: true };
    }),
    instances: [],
    sampleLogs: [],
    ...(series.length === 0
      ? {}
      : {
          trend: {
            label: 'occurrences',
            unit: 'count' as const,
            points: series.map((point) => [point.at, point.count] as [number, number]),
          },
        }),
    deployments: [],
    repository: [],
    allowedActions: row.status === 'muted' ? [] : ['mute'],
  };
}

/**
 * §4.4's three sets, which are what the Errors page leads with and what the brief renders.
 *
 * `since` is the reader's own mark when they have one, so "new" means "since *you* last looked" rather than
 * a generic window.
 */
export function whatsNew(
  db: Db,
  query: { connectionId: string; scope: string; since: number },
  context: ErrorReadContext,
): { new: ErrorSummary[]; regressed: ErrorSummary[]; spiking: ErrorSummary[] } {
  const recent = (status: ErrorGroupRow['status']) =>
    recentErrorGroups(db, { connectionId: query.connectionId, scope: query.scope, status: [status], sinceMs: query.since }, WHATS_NEW_LIMIT)
      .map((row) => toSummary(db, row, context));

  const spiking = recentErrorGroups(db, { connectionId: query.connectionId, scope: query.scope, status: ['ongoing', 'new', 'regressed'] }, 50)
    .map((row) => toSummary(db, row, context))
    .filter((summary) => summary.trend === 'rising')
    .slice(0, WHATS_NEW_LIMIT);

  return { new: recent('new'), regressed: recent('regressed'), spiking };
}

/** Whether this environment has any log source at all, which decides which empty state the page shows. */
export function errorCollectionState(
  db: Db,
  query: { connectionId: string; scope: string },
): 'no_sources' | 'none_enabled' | 'enabled' {
  const sources = listLogSources(db, query.connectionId, query.scope);
  if (sources.length === 0) return 'no_sources';
  return sources.some((source) => source.enabled) ? 'enabled' : 'none_enabled';
}
