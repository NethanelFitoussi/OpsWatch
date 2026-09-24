import 'server-only';
import type { Db } from '../db/client';
import type { LogSourceRow } from '../db/schema';
import { listForwardedGroups, listManagedConnections, dueIngestEvents, markIngestProcessed, readCollection, sweepIngestEvents } from '../store/collection';
import { listLogSources, upsertLogSource } from '../store/errors';
import { runErrorDetectCycle } from './errors-detect';
import { ingest } from './errors-job';
import type { JobOutcome } from './runner';

/**
 * The `ingest` job: draining what forwarders delivered.
 *
 * The endpoint accepts and queues; this processes. Expensive work never happens inside an HTTP request a
 * Lambda is waiting on, and the queue is a table drained by a job because that is the only queue this
 * product has ever had.
 *
 * What it does with a record is exactly what the `errors` job does with a line it fetched itself —
 * `ingest()` from that job, unchanged — so a log line that arrives by push and one that arrives by a
 * Logs Insights query become the same error group. Push is a cheaper way to get the same lines, not a
 * second, parallel idea of what an error is.
 *
 * **Then it decides what to keep.** With persistence off, a processed record is deleted in the same pass
 * that processed it: it existed only long enough to be read. With persistence on it lives until the
 * retention edge. Nothing is retained by default and nothing is retained longer than was asked for.
 */

/** How many records one cycle drains. A bound, so a burst cannot make one pass unbounded. */
export const INGEST_BATCH = 500;

/**
 * The log source a forwarded group is parsed with.
 *
 * A group can be forwarded without anybody having configured how to read it, so one is created — parked
 * as **disabled**, which is what keeps the `errors` job from also querying it through Logs Insights and
 * billing an operator twice for lines that already arrived for free.
 */
function sourceFor(db: Db, connectionId: string, region: string, logGroup: string, nowMs: number): LogSourceRow {
  const existing = listLogSources(db, connectionId, region).find((source) => source.logGroup === logGroup);
  if (existing !== undefined) return existing;
  return upsertLogSource(db, {
    connectionId,
    scope: region,
    logGroup,
    serviceId: null,
    enabled: false,
    // `regex` with no pattern is this product's "unparsed": the raw line becomes the message, which is
    // exactly right for a group nobody has told OpsWatch how to read.
    format: 'regex',
    fieldMap: {},
    createdAt: nowMs,
  });
}

export function runIngestJob({ db, nowMs }: { db: Db; nowMs: number }): JobOutcome {
  const queued = dueIngestEvents(db, INGEST_BATCH);

  if (queued.length > 0) {
    // Grouped, because `ingest()` parses a batch of one source at a time — and because one row per record
    // would re-read the source row for every line.
    const byGroup = new Map<string, typeof queued>();
    for (const event of queued) {
      const key = `${event.connectionId}\u0000${event.region}\u0000${event.logGroup}`;
      byGroup.set(key, [...(byGroup.get(key) ?? []), event]);
    }

    const environments = new Set<string>();
    for (const [key, events] of byGroup) {
      const [connectionId, region, logGroup] = key.split('\u0000');
      const source = sourceFor(db, connectionId, region, logGroup, nowMs);
      // The shape `ingest()` already reads: exactly what a Logs Insights row looks like, so one parser
      // serves both paths and a pushed line and a pulled line cannot be judged differently.
      ingest(
        { db, connectionId, scope: region, nowMs },
        source,
        events.map((event) => ({ '@message': event.message, '@logStream': event.logStream, '@timestamp': String(event.at) })),
      );
      environments.add(`${connectionId}\u0000${region}`);
    }

    markIngestProcessed(db, queued.map((event) => event.seq), nowMs);

    // §4.4 on the rows this pass just wrote, in the same pass — so a problem opens now rather than at the
    // next detect cycle.
    for (const environment of environments) {
      const [connectionId, region] = environment.split('\u0000');
      runErrorDetectCycle(db, { connectionId, scope: region }, nowMs);
    }
  }

  // Whatever was drained or not, what has already been processed is swept according to each connection's
  // own decision. A connection that stopped forwarding still gets its kept records aged out.
  for (const collection of listManagedConnections(db)) {
    const edge = collection.persistLogs ? nowMs - collection.retentionHours * 60 * 60_000 : nowMs + 1;
    sweepIngestEvents(db, collection.connectionId, edge);
  }

  return { covered: queued.length, total: queued.length, truncated: queued.length === INGEST_BATCH };
}

/**
 * Whether the `errors` job should leave this log group alone.
 *
 * A group whose lines already arrive by push must not also be queried through Logs Insights: that is the
 * same lines, twice, with the second copy billed per gigabyte scanned.
 */
export function isForwarded(db: Db, connectionId: string, region: string, logGroup: string): boolean {
  const collection = readCollection(db, connectionId);
  if (!collection.managed || !collection.realtimeLogs) return false;
  return listForwardedGroups(db, connectionId, region).some(
    (group) => group.logGroup === logGroup && group.state === 'active',
  );
}
