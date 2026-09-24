import 'server-only';
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { randomId, randomToken } from '../crypto';
import type { Db } from '../db/client';
import {
  awsCollection,
  awsForwardedGroups,
  ingestEvents,
  ingestStats,
  type AwsCollectionRow,
  type AwsForwardedGroupRow,
  type IngestEventRow,
} from '../db/schema';
import { minuteOf, MINUTE_MS } from '../ingest/identity';

/**
 * Push collection, in SQL.
 *
 * Two rules run through every function here.
 *
 * **Absence is the default, and the default is off.** A connection with no row has managed collection
 * disabled, real-time logs disabled and persistence disabled. Nothing writes a row until an operator
 * touches the feature, so nobody can mistake a default for a decision somebody made.
 *
 * **Everything is scoped by connection.** An event belongs to the integration whose signature carried it,
 * and every read filters on that. An instance holding two AWS accounts must never let one account's
 * forwarder write into the other's data, and the `where` is what makes that structural.
 */

/** What an instance with no row has: everything off. Returned, never written. */
export function readCollection(db: Db, connectionId: string, nowMs = 0): AwsCollectionRow {
  return (
    db.select().from(awsCollection).where(eq(awsCollection.connectionId, connectionId)).get() ?? {
      connectionId,
      managed: false,
      realtimeLogs: false,
      persistLogs: false,
      retentionHours: 24,
      ingestSecretCiphertext: null,
      secretRotatedAt: null,
      stackState: 'absent' as const,
      stackName: null,
      stackId: null,
      forwarderArn: null,
      forwarderVersion: null,
      verifiedAt: null,
      createdAt: nowMs,
      updatedAt: nowMs,
    }
  );
}

export type CollectionPatch = Partial<
  Pick<
    AwsCollectionRow,
    | 'managed'
    | 'realtimeLogs'
    | 'persistLogs'
    | 'retentionHours'
    | 'ingestSecretCiphertext'
    | 'secretRotatedAt'
    | 'stackState'
    | 'stackName'
    | 'stackId'
    | 'forwarderArn'
    | 'forwarderVersion'
    | 'verifiedAt'
  >
>;

export function writeCollection(db: Db, connectionId: string, patch: CollectionPatch, nowMs: number): AwsCollectionRow {
  const current = readCollection(db, connectionId, nowMs);
  const row: AwsCollectionRow = { ...current, ...patch, connectionId, updatedAt: nowMs };
  db.insert(awsCollection).values(row).onConflictDoUpdate({ target: awsCollection.connectionId, set: { ...row } }).run();
  return row;
}

/** Every connection with a forwarder that could be sending. The ingestion endpoint's lookup. */
export function listManagedConnections(db: Db): AwsCollectionRow[] {
  return db.select().from(awsCollection).where(eq(awsCollection.managed, true)).all();
}

/* ------------------------------------------------------------------ forwarded log groups */

export function listForwardedGroups(db: Db, connectionId: string, region?: string): AwsForwardedGroupRow[] {
  const where = [eq(awsForwardedGroups.connectionId, connectionId)];
  if (region !== undefined) where.push(eq(awsForwardedGroups.region, region));
  return db.select().from(awsForwardedGroups).where(and(...where)).orderBy(asc(awsForwardedGroups.logGroup)).all();
}

export function findForwardedGroup(db: Db, connectionId: string, region: string, logGroup: string): AwsForwardedGroupRow | undefined {
  return db
    .select()
    .from(awsForwardedGroups)
    .where(
      and(
        eq(awsForwardedGroups.connectionId, connectionId),
        eq(awsForwardedGroups.region, region),
        eq(awsForwardedGroups.logGroup, logGroup),
      ),
    )
    .get();
}

export function upsertForwardedGroup(
  db: Db,
  input: Omit<AwsForwardedGroupRow, 'id' | 'createdAt' | 'updatedAt'>,
  nowMs: number,
): AwsForwardedGroupRow {
  const existing = findForwardedGroup(db, input.connectionId, input.region, input.logGroup);
  const row: AwsForwardedGroupRow = {
    ...input,
    id: existing?.id ?? randomId(),
    createdAt: existing?.createdAt ?? nowMs,
    updatedAt: nowMs,
  };
  db.insert(awsForwardedGroups)
    .values(row)
    .onConflictDoUpdate({
      target: [awsForwardedGroups.connectionId, awsForwardedGroups.region, awsForwardedGroups.logGroup],
      set: { state: row.state, filterName: row.filterName, lastError: row.lastError, updatedAt: nowMs },
    })
    .run();
  return row;
}

export function deleteForwardedGroup(db: Db, connectionId: string, region: string, logGroup: string): boolean {
  const result = db
    .delete(awsForwardedGroups)
    .where(
      and(
        eq(awsForwardedGroups.connectionId, connectionId),
        eq(awsForwardedGroups.region, region),
        eq(awsForwardedGroups.logGroup, logGroup),
      ),
    )
    .run();
  return result.changes > 0;
}

/* ------------------------------------------------------------------ the ingestion queue */

export type NewIngestEvent = Omit<IngestEventRow, 'seq' | 'processedAt'>;

/**
 * Stores a batch, ignoring what is already there.
 *
 * `onConflictDoNothing` on the derived id is the deduplication: AWS delivers at least once, and a retried
 * batch inserts nothing rather than doubling a log line. The two counts are returned separately because a
 * forwarder retrying something it already delivered should see that it was recognised.
 */
export function storeIngestEvents(db: Db, events: readonly NewIngestEvent[]): { accepted: number; duplicate: number } {
  if (events.length === 0) return { accepted: 0, duplicate: 0 };
  let accepted = 0;
  db.transaction((tx) => {
    for (const event of events) {
      const result = tx.insert(ingestEvents).values(event).onConflictDoNothing({ target: ingestEvents.id }).run();
      accepted += result.changes;
    }
  });
  return { accepted, duplicate: events.length - accepted };
}

/** The next batch to process, oldest first. `processedAt` null is the queue. */
export function dueIngestEvents(db: Db, limit: number): IngestEventRow[] {
  return db
    .select()
    .from(ingestEvents)
    .where(isNull(ingestEvents.processedAt))
    .orderBy(asc(ingestEvents.seq))
    .limit(limit)
    .all();
}

export function markIngestProcessed(db: Db, seqs: readonly number[], nowMs: number): void {
  if (seqs.length === 0) return;
  db.transaction((tx) => {
    for (const seq of seqs) tx.update(ingestEvents).set({ processedAt: nowMs }).where(eq(ingestEvents.seq, seq)).run();
  });
}

/**
 * Deletes processed events this connection is not keeping.
 *
 * Called with `olderThanMs = nowMs` when persistence is off, which discards everything the moment it has
 * been processed, and with the retention edge when it is on. Nothing is ever retained by default and
 * nothing is retained for longer than the operator asked.
 */
export function sweepIngestEvents(db: Db, connectionId: string, olderThanMs: number): number {
  return db
    .delete(ingestEvents)
    // A queued row has a null `processedAt`, and `null < x` is null rather than true in SQL — so the
    // comparison alone already refuses to take a record nobody has looked at yet. An `is not null` beside
    // it would be a guard no test could ever reach.
    .where(and(eq(ingestEvents.connectionId, connectionId), lt(ingestEvents.processedAt, olderThanMs)))
    .run().changes;
}

/** Everything queued and everything kept, for one connection. Used when a connection stops forwarding. */
export function deleteIngestEvents(db: Db, connectionId: string): number {
  return db.delete(ingestEvents).where(eq(ingestEvents.connectionId, connectionId)).run().changes;
}

/* ------------------------------------------------------------------ traffic counters */

export type StatDelta = { events?: number; bytes?: number; rejected?: number; duplicates?: number };

/** Adds to one minute's counters. Counted here so health survives the events themselves being discarded. */
export function recordIngestStat(db: Db, connectionId: string, region: string, atMs: number, delta: StatDelta): void {
  const minute = minuteOf(atMs);
  const values = {
    connectionId,
    region,
    minute,
    events: delta.events ?? 0,
    bytes: delta.bytes ?? 0,
    rejected: delta.rejected ?? 0,
    duplicates: delta.duplicates ?? 0,
  };
  db.insert(ingestStats)
    .values(values)
    .onConflictDoUpdate({
      target: [ingestStats.connectionId, ingestStats.region, ingestStats.minute],
      set: {
        events: sql`${ingestStats.events} + ${values.events}`,
        bytes: sql`${ingestStats.bytes} + ${values.bytes}`,
        rejected: sql`${ingestStats.rejected} + ${values.rejected}`,
        duplicates: sql`${ingestStats.duplicates} + ${values.duplicates}`,
      },
    })
    .run();
}

export type IngestTraffic = {
  events: number;
  bytes: number;
  rejected: number;
  duplicates: number;
  /** When the most recent record arrived, or null when none ever has. */
  lastEventAt: number | null;
};

/** What arrived over a window, for one connection. The numbers behind the forwarder's health. */
export function readIngestTraffic(db: Db, connectionId: string, sinceMs: number): IngestTraffic {
  const rows = db
    .select()
    .from(ingestStats)
    .where(and(eq(ingestStats.connectionId, connectionId), gte(ingestStats.minute, minuteOf(sinceMs))))
    .all();
  const withEvents = rows.filter((row) => row.events > 0).map((row) => row.minute);
  return {
    events: rows.reduce((total, row) => total + row.events, 0),
    bytes: rows.reduce((total, row) => total + row.bytes, 0),
    rejected: rows.reduce((total, row) => total + row.rejected, 0),
    duplicates: rows.reduce((total, row) => total + row.duplicates, 0),
    // The end of the last minute that carried anything: a minute bucket cannot say more than that.
    lastEventAt: withEvents.length === 0 ? null : Math.max(...withEvents) + MINUTE_MS,
  };
}

/** How many requests this integration made in the current minute, for the rate limit. */
export function requestsThisMinute(db: Db, connectionId: string, nowMs: number): number {
  const rows = db
    .select()
    .from(ingestStats)
    .where(and(eq(ingestStats.connectionId, connectionId), eq(ingestStats.minute, minuteOf(nowMs))))
    .all();
  return rows.reduce((total, row) => total + row.events + row.rejected + row.duplicates, 0);
}

/** A fresh signing secret. Generated here so no page and no template ever chooses one. */
export const newIngestSecret = () => randomToken(32);
