import 'server-only';
import type { AwsTarget, MonitoringDeps } from './call';
import { getLogsQueryResults, startLogsQuery, stopLogsQuery } from './logs';

/** The IAM action a failure here points at, so the page can say which permission is missing. */
const LOGS_QUERY_ACTION = 'logs:StartQuery';
import type { MonitoringResult } from './result';

/**
 * Slowest endpoints, from the application's own logs (Stage 3 §3b, §18).
 *
 * CloudWatch cannot answer this. A load balancer reports latency for a whole target group and never per
 * path, so in a read-only account the only source is what the application itself logged. That is why this
 * page needs a field mapping and the others do not, and why it is honest about needing one.
 *
 * Everything here except `runEndpointsQuery` is pure, so a mapping can be checked against sample rows
 * without touching AWS.
 */

/** §3b: fifty rows, sorted by p95. A page is a summary; the query is not a data export. */
export const ENDPOINTS_ROW_LIMIT = 50;
/** §3b and the rest of the Logs section: nothing longer than a day. */
export const ENDPOINTS_MAX_WINDOW_MS = 24 * 60 * 60_000;
/** How many raw lines to show when a mapping matched nothing, so the operator can see the real field names. */
export const SAMPLE_LINES = 3;

const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 1000;

export type EndpointsMapping = {
  logGroups: string[];
  /** The field holding the route or path, as the log writes it — `route`, `path`, `http.target`. */
  routeField: string;
  /** The field holding the duration in milliseconds. */
  durationField: string;
};

export type EndpointRow = {
  route: string;
  count: number;
  /** Null when the query returned the row but not this statistic, which is never treated as zero. */
  averageMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type EndpointsResult = {
  rows: EndpointRow[];
  bytesScanned: number;
  /** Raw lines to show when nothing matched, so the mapping can be corrected rather than guessed at. */
  samples: string[];
  /** True when the query ran and matched no row — different from the query having failed. */
  matchedNothing: boolean;
};

/** A Logs Insights identifier. Anything else would let a mapping field close the query and append its own. */
const SAFE_FIELD = /^[A-Za-z_@][A-Za-z0-9_.@-]{0,80}$/;

export function isSafeField(field: string): boolean {
  return SAFE_FIELD.test(field);
}

/**
 * The statistics query §3b describes: count, average, p95 and maximum of the duration, grouped by route.
 *
 * The field names come from an operator, so they are validated against `SAFE_FIELD` before they reach the
 * string — a query language with no parameter binding is one where the only defence is refusing the input.
 */
export function endpointsQuery(mapping: Pick<EndpointsMapping, 'routeField' | 'durationField'>, limit = ENDPOINTS_ROW_LIMIT): string | null {
  if (!isSafeField(mapping.routeField) || !isSafeField(mapping.durationField)) return null;
  const route = mapping.routeField;
  const duration = mapping.durationField;
  return [
    `fields ${route}, ${duration}`,
    `| filter ispresent(${route}) and ispresent(${duration})`,
    `| stats count(*) as hits, avg(${duration}) as avgMs, pct(${duration}, 95) as p95Ms, max(${duration}) as maxMs by ${route} as route`,
    '| sort p95Ms desc',
    `| limit ${limit}`,
  ].join('\n');
}

/** The query that shows what the logs actually look like, for when the mapping matched nothing. */
export function sampleQuery(limit = SAMPLE_LINES): string {
  return ['fields @message', '| sort @timestamp desc', `| limit ${limit}`].join('\n');
}

/** A statistic Logs Insights did not return is null, never 0 — 0 ms would be a measurement nobody made. */
function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseEndpointRows(rows: readonly Record<string, string>[]): EndpointRow[] {
  return rows
    .map((row) => ({
      route: row.route ?? '',
      // A row with no count is not a row about an endpoint; it is filtered out below.
      count: num(row.hits) ?? 0,
      averageMs: num(row.avgMs),
      p95Ms: num(row.p95Ms),
      maxMs: num(row.maxMs),
    }))
    .filter((row) => row.route !== '');
}

/** Clamps a window to §3b's day, so a page cannot ask for a scan it was told not to make. */
export function clampWindow(fromMs: number, toMs: number): { fromMs: number; toMs: number; clamped: boolean } {
  if (toMs - fromMs <= ENDPOINTS_MAX_WINDOW_MS) return { fromMs, toMs, clamped: false };
  return { fromMs: toMs - ENDPOINTS_MAX_WINDOW_MS, toMs, clamped: true };
}

async function poll(
  target: AwsTarget,
  queryId: string,
  sleep: (ms: number) => Promise<void>,
  deps: MonitoringDeps,
): Promise<MonitoringResult<{ rows: Record<string, string>[]; bytesScanned: number }>> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const results = await getLogsQueryResults(target, queryId, deps);
    if (!results.ok) return results;
    if (results.data.status === 'Complete') {
      return { ok: true, data: { rows: results.data.rows, bytesScanned: results.data.statistics.bytesScanned } };
    }
    if (results.data.status !== 'Scheduled' && results.data.status !== 'Running') {
      return { ok: false, reason: 'error', code: results.data.status, action: LOGS_QUERY_ACTION };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  // Out of patience: stop it rather than leaving it running and billing.
  await stopLogsQuery(target, queryId, deps);
  return { ok: false, reason: 'error', code: 'Timeout', action: LOGS_QUERY_ACTION };
}

export async function runEndpointsQuery(
  target: AwsTarget,
  mapping: EndpointsMapping,
  window: { fromMs: number; toMs: number },
  deps: MonitoringDeps & { sleep?: (ms: number) => Promise<void> } = {},
): Promise<MonitoringResult<EndpointsResult>> {
  const query = endpointsQuery(mapping);
  if (query === null) return { ok: false, reason: 'error', code: 'InvalidFieldName', action: LOGS_QUERY_ACTION };

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const { fromMs, toMs } = clampWindow(window.fromMs, window.toMs);
  const range = { startSeconds: Math.floor(fromMs / 1000), endSeconds: Math.floor(toMs / 1000) };

  const started = await startLogsQuery(target, { logGroups: mapping.logGroups, query, ...range }, deps);
  if (!started.ok) return started;

  const polled = await poll(target, started.data.queryId, sleep, deps);
  if (!polled.ok) return polled;

  const rows = parseEndpointRows(polled.data.rows);
  if (rows.length > 0) {
    return { ok: true, data: { rows, bytesScanned: polled.data.bytesScanned, samples: [], matchedNothing: false } };
  }

  // Nothing matched. §3b: show what the lines actually look like so the field names can be corrected.
  const sampled = await startLogsQuery(target, { logGroups: mapping.logGroups, query: sampleQuery(), ...range }, deps);
  if (!sampled.ok) {
    return { ok: true, data: { rows: [], bytesScanned: polled.data.bytesScanned, samples: [], matchedNothing: true } };
  }
  const sampleRows = await poll(target, sampled.data.queryId, sleep, deps);
  return {
    ok: true,
    data: {
      rows: [],
      // Both scans are charged, so both are reported.
      bytesScanned: polled.data.bytesScanned + (sampleRows.ok ? sampleRows.data.bytesScanned : 0),
      samples: sampleRows.ok ? sampleRows.data.rows.map((row) => row['@message'] ?? '').filter((line) => line !== '') : [],
      matchedNothing: true,
    },
  };
}
