import 'server-only';
import { fingerprint, sampleFrames, significantFrames, normalizeMessage, FINGERPRINT_VERSION } from '../detect/fingerprint';
import { parseLine, parseStack, type FieldMap } from '../detect/log-parse';
import type { Db } from '../db/client';
import type { LogSourceRow } from '../db/schema';
import { getLogsQueryResults, startLogsQuery, stopLogsQuery } from '../monitoring/logs';
import type { AwsTarget } from '../monitoring/call';
import { resolveTarget } from '../monitoring/target';
import { enabledLogSources, recordError } from '../store/errors';
import { budgetState, recordBudgetStop, recordScan } from '../store/logs-budget';
import { runErrorDetectCycle } from './errors-detect';
import type { JobOutcome } from './runner';

/**
 * The `errors` job (§18, §4.4): one bounded Logs Insights query per opted-in source, every fifteen minutes.
 *
 * Two things govern it, and both are about not surprising a self-hoster with a bill:
 *
 * 1. **Opt-in per source.** A `log_source` row that is disabled costs nothing at all — the job never sees it.
 * 2. **A hard daily stop.** Logs Insights is billed per gigabyte scanned, so `OPSWATCH_LOGS_BUDGET_GB_PER_DAY`
 *    is a ceiling rather than a warning: once today's scanned bytes reach it the job stops for the day and
 *    records *why*, so a reader is never left wondering where the errors went. The spend is measured from
 *    what AWS itself reports as scanned, never from an estimate of our own.
 */

/** One query per source per cycle, as §9.2's cap for this job says. */
export const ERRORS_QUERY_LIMIT = 200;
/** The window each cycle asks about, slightly wider than the fifteen-minute cadence so nothing falls between. */
export const ERRORS_WINDOW_MS = 20 * 60_000;
/** How long to wait for one query before giving up on it and moving to the next source. */
const POLL_INTERVAL_MS = 1_000;
const POLL_ATTEMPTS = 30;

/**
 * The query. It asks for the fields the field map might name, and nothing else — no wildcard, so the scan is
 * bounded by what is actually needed. `@message` is the raw line, which is what a JSON or regex map parses.
 */
export function errorQuery(limit: number): string {
  return [
    'fields @timestamp, @message, @logStream',
    '| filter @message like /(?i)(error|exception|fatal|traceback)/',
    '| sort @timestamp desc',
    `| limit ${limit}`,
  ].join('\n');
}

export type ErrorsJobInput = {
  db: Db;
  connectionId: string;
  scope: string;
  nowMs: number;
  budgetGbPerDay: number;
  /** Injected so a test drives the polling rather than waiting on it. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runErrorsJob(input: ErrorsJobInput): Promise<JobOutcome> {
  const sources = enabledLogSources(input.db, input.connectionId, input.scope);
  // Nothing opted in: the job did nothing and cost nothing, and says so rather than looking like a failure.
  if (sources.length === 0) return { covered: 0, total: 0 };

  const budget = budgetState(input.db, input.nowMs, input.budgetGbPerDay);
  if (budget.exhausted) {
    recordBudgetStop(input.db, input.nowMs);
    // Truncated, not failed: the job worked exactly as configured. The number it covered is the honest zero.
    return { covered: 0, total: sources.length, truncated: true };
  }

  const target = await resolveTarget({ connectionId: input.connectionId, region: input.scope });
  if (!target.ok) throw new Error('connection_unavailable');

  let covered = 0;
  for (const source of sources) {
    // Re-checked between sources: one busy group can exhaust the day's budget on its own.
    if (budgetState(input.db, input.nowMs, input.budgetGbPerDay).exhausted) {
      recordBudgetStop(input.db, input.nowMs);
      return { covered, total: sources.length, truncated: true };
    }
    const scanned = await collectOne(input, target.data, source);
    if (scanned) covered += 1;
  }

  // §4.4 on the rows this cycle just wrote. Judging them here rather than in a job of its own is what makes
  // an error problem open in the same pass that collected the errors, instead of up to fifteen minutes later.
  runErrorDetectCycle(input.db, { connectionId: input.connectionId, scope: input.scope }, input.nowMs);

  return { covered, total: sources.length, truncated: covered < sources.length };
}

async function collectOne(input: ErrorsJobInput, target: AwsTarget, source: LogSourceRow): Promise<boolean> {
  const started = await startLogsQuery(target, {
    logGroups: [source.logGroup],
    query: errorQuery(ERRORS_QUERY_LIMIT),
    startSeconds: Math.floor((input.nowMs - ERRORS_WINDOW_MS) / 1000),
    endSeconds: Math.floor(input.nowMs / 1000),
  });
  // A source that cannot be queried must not stop the others; the cycle reports it as not covered.
  if (!started.ok) return false;

  const sleep = input.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const results = await getLogsQueryResults(target, started.data.queryId);
    if (!results.ok) return false;

    if (results.data.status === 'Complete') {
      // Recorded before the rows are parsed, so a scan always costs its budget even if parsing then fails.
      recordScan(input.db, input.nowMs, results.data.statistics.bytesScanned);
      ingest(input, source, results.data.rows);
      return true;
    }
    if (results.data.status !== 'Scheduled' && results.data.status !== 'Running') {
      recordScan(input.db, input.nowMs, results.data.statistics.bytesScanned);
      return false;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  // Out of patience: stop it rather than leaving it running and billing.
  await stopLogsQuery(target, started.data.queryId);
  return false;
}

/** Turns the rows of one query into error groups. Counts identical fingerprints within the batch. */
export function ingest(
  input: Pick<ErrorsJobInput, 'db' | 'connectionId' | 'scope' | 'nowMs'>,
  source: LogSourceRow,
  rows: readonly Record<string, string>[],
): number {
  const batch = new Map<string, { seen: Parameters<typeof recordError>[1]; count: number }>();

  for (const row of rows) {
    const raw = row['@message'];
    if (raw === undefined) continue;
    const parsed = parseLine(raw, source.format, source.fieldMap as FieldMap);
    const message = parsed.message ?? raw;
    const frames = parseStack(parsed.stack);
    const print = fingerprint({
      ...(parsed.type === null ? {} : { type: parsed.type }),
      message,
      frames,
      logGroup: source.logGroup,
    });
    const at = Number(row['@timestamp']) || input.nowMs;

    const existing = batch.get(print);
    if (existing) {
      existing.count += 1;
      existing.seen.at = Math.max(existing.seen.at, at);
      continue;
    }
    batch.set(print, {
      count: 1,
      seen: {
        connectionId: input.connectionId,
        scope: input.scope,
        logSourceId: source.id,
        serviceId: source.serviceId,
        fingerprint: print,
        fingerprintVersion: FINGERPRINT_VERSION,
        exceptionType: parsed.type,
        sampleMessage: message.slice(0, 1000),
        normalizedMessage: normalizeMessage(message),
        topFrames: significantFrames(frames),
        // The same frames, unnormalised, so a reader can be sent to a line. `significantFrames` above is
        // what grouping uses and carries no line at all — the two are computed from one parse and kept apart.
        sampleFrames: sampleFrames(frames),
        at,
        count: 1,
        instances: null,
      },
    });
  }

  for (const entry of batch.values()) {
    recordError(input.db, { ...entry.seen, count: entry.count });
  }
  return batch.size;
}
