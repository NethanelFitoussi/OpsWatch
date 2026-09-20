import 'server-only';
import { and, asc, eq, gt, gte, inArray, lt, lte, or } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import { events, type EventKind, type EventRow } from '../db/schema';
import type { SeqPage } from './problems';
import { inBatches } from './tx';

/**
 * The append-only spine (§9.3): the activity feed, the facts an investigation cites, an incident's timeline and
 * every report read from the same rows. Nothing here is ever updated — an event is something that happened, and
 * the only thing that may remove one is retention.
 *
 * `dedupeKey` is what makes a collector safe to re-run. A cycle that is interrupted and repeated writes the same
 * events again, and the partial unique index turns the repeat into a no-op rather than a duplicate in the feed.
 */
export type NewEvent = Omit<EventRow, 'seq' | 'id'> & { id?: string };

export type EventFilter = {
  connectionId?: string;
  scope?: string;
  serviceId?: string;
  subjectId?: string;
  sinceMs?: number;
  untilMs?: number;
};

/**
 * Appends one event, or answers `null` when its `dedupeKey` has already been written.
 *
 * The conflict is handled here rather than thrown, because every caller would otherwise catch it and carry on: a
 * key that is already present means the event is already in the spine, which is success, not failure.
 */
export function appendEvent(db: Db, event: NewEvent): EventRow | null {
  return (
    db
      .insert(events)
      .values({ ...event, id: event.id ?? randomId() })
      .onConflictDoNothing()
      .returning()
      .get() ?? null
  );
}

/** Appends a batch through §9.2's bounded transactions, so a large cycle does not hold the event loop. */
export function appendEvents(db: Db, batch: readonly NewEvent[]): Promise<number> {
  const rows = batch.map((event) => ({ ...event, id: event.id ?? randomId() }));
  return inBatches(db, rows, (tx, chunk) => {
    tx.insert(events).values([...chunk]).onConflictDoNothing().run();
  });
}

/** One page of events, oldest first, on the same immutable `(seq, id)` axis every list in the product uses. */
export function listEvents(
  db: Db,
  filter: EventFilter,
  cursor: { afterSeq: number; afterId: string } | null,
  limit: number,
): SeqPage<EventRow> {
  const where = [];
  if (filter.connectionId !== undefined) where.push(eq(events.connectionId, filter.connectionId));
  if (filter.scope !== undefined) where.push(eq(events.scope, filter.scope));
  if (filter.serviceId !== undefined) where.push(eq(events.serviceId, filter.serviceId));
  if (filter.subjectId !== undefined) where.push(eq(events.subjectId, filter.subjectId));
  if (filter.sinceMs !== undefined) where.push(gte(events.at, filter.sinceMs));
  if (filter.untilMs !== undefined) where.push(lte(events.at, filter.untilMs));
  if (cursor !== null) {
    where.push(or(gt(events.seq, cursor.afterSeq), and(eq(events.seq, cursor.afterSeq), gt(events.id, cursor.afterId)))!);
  }
  const rows = db
    .select()
    .from(events)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(events.seq), asc(events.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  const more = rows.length > limit;
  const last = items[items.length - 1];
  return { items, nextSeq: more && last ? last.seq : null, nextId: more && last ? last.id : null };
}

/**
 * Retention, by kind. The window differs per kind — an inventory event is noise after a week, a problem's history
 * is not — so the caller names which kinds it is purging rather than the store deciding for everything at once.
 */
export function deleteEventsBefore(db: Db, beforeMs: number, kinds: readonly EventKind[]): number {
  if (kinds.length === 0) return 0;
  return db
    .delete(events)
    .where(and(lt(events.at, beforeMs), inArray(events.kind, [...kinds])))
    .run().changes;
}
