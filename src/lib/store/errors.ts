import 'server-only';
import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import { randomId } from '../crypto';
import type { Db } from '../db/client';
import {
  errorGroups,
  errorOccurrences,
  logSources,
  userMarks,
  type ErrorGroupRow,
  type ErrorGroupStatus,
  type LogSourceRow,
} from '../db/schema';
import type { SeqPage } from './problems';

/**
 * Error groups, their occurrences and the sources they come from (§4.4, §18).
 *
 * A group is a fingerprint, not an occurrence: it is what a screen lists, counts and follows over time.
 * Occurrences are rolled up by hour, because §4.4 counts over a window and an hourly bucket answers "three
 * times the baseline for this hour of the week" without keeping every line.
 */

/** No occurrence for this long and a group is considered resolved (§4.4). */
export const ERROR_RESOLVED_AFTER_MS = 7 * 24 * 60 * 60_000;
/** No occurrence for this long, then occurrences again, is a regression rather than a continuation. */
export const ERROR_REGRESSION_GAP_MS = 24 * 60 * 60_000;

export const HOUR_MS = 60 * 60_000;
export const hourOf = (at: number) => Math.floor(at / HOUR_MS) * HOUR_MS;

export type SeenError = {
  connectionId: string;
  scope: string;
  logSourceId: string;
  serviceId: string | null;
  fingerprint: string;
  fingerprintVersion: number;
  exceptionType: string | null;
  sampleMessage: string;
  normalizedMessage: string;
  topFrames: string[];
  at: number;
  count: number;
  instances: number | null;
};

/**
 * Records that a group was seen. Opens it if it is new, and decides its status from the gap since it was
 * last seen: a group silent for a day and then back is a **regression**, which is the state the whole
 * "what's new" idea turns on — it is different from one that never stopped.
 */
export function recordError(db: Db, seen: SeenError): ErrorGroupRow {
  return db.transaction(() => {
    const existing = db
      .select()
      .from(errorGroups)
      .where(
        and(
          eq(errorGroups.connectionId, seen.connectionId),
          eq(errorGroups.scope, seen.scope),
          eq(errorGroups.fingerprint, seen.fingerprint),
          eq(errorGroups.fingerprintVersion, seen.fingerprintVersion),
        ),
      )
      .get();

    const row = existing
      ? db
          .update(errorGroups)
          .set({
            lastSeenAt: Math.max(existing.lastSeenAt, seen.at),
            sampleMessage: seen.sampleMessage,
            ...statusFor(existing, seen.at),
          })
          .where(eq(errorGroups.id, existing.id))
          .returning()
          .get()
      : db
          .insert(errorGroups)
          .values({
            id: randomId(),
            fingerprint: seen.fingerprint,
            fingerprintVersion: seen.fingerprintVersion,
            connectionId: seen.connectionId,
            scope: seen.scope,
            serviceId: seen.serviceId,
            logSourceId: seen.logSourceId,
            exceptionType: seen.exceptionType,
            sampleMessage: seen.sampleMessage,
            normalizedMessage: seen.normalizedMessage,
            topFrames: seen.topFrames,
            firstSeenAt: seen.at,
            lastSeenAt: seen.at,
            status: 'new',
            statusSince: seen.at,
          })
          .returning()
          .get();

    const hour = hourOf(seen.at);
    db.insert(errorOccurrences)
      .values({ groupId: row.id, hourAt: hour, count: seen.count, instances: seen.instances })
      .onConflictDoUpdate({
        target: [errorOccurrences.groupId, errorOccurrences.hourAt],
        set: {
          count: sql`${errorOccurrences.count} + ${seen.count}`,
          // The larger of the two: instances seen in an hour, not summed across queries within it.
          instances: sql`max(coalesce(${errorOccurrences.instances}, 0), ${seen.instances ?? 0})`,
        },
      })
      .run();
    return row;
  });
}

/** A muted group stays muted: silencing it is a decision, and a new occurrence does not overrule it. */
function statusFor(existing: ErrorGroupRow, at: number): { status: ErrorGroupStatus; statusSince: number } {
  if (existing.status === 'muted') return { status: 'muted', statusSince: existing.statusSince };
  if (at - existing.lastSeenAt >= ERROR_REGRESSION_GAP_MS) return { status: 'regressed', statusSince: at };
  if (existing.status === 'new' || existing.status === 'regressed') {
    return { status: existing.status, statusSince: existing.statusSince };
  }
  return { status: 'ongoing', statusSince: existing.statusSince };
}

/** Groups with no occurrence for seven days become resolved. Answers how many changed. */
export function resolveSilentErrors(db: Db, nowMs: number): number {
  return db
    .update(errorGroups)
    .set({ status: 'resolved', statusSince: nowMs })
    .where(
      and(
        inArray(errorGroups.status, ['new', 'regressed', 'ongoing']),
        lt(errorGroups.lastSeenAt, nowMs - ERROR_RESOLVED_AFTER_MS),
      ),
    )
    .run().changes;
}

export type ErrorFilter = {
  connectionId: string;
  scope: string;
  status?: readonly ErrorGroupStatus[];
  sinceMs?: number;
};

/** One page of groups, on the same immutable `(seq, id)` axis as every other list (§33.6). */
export function pageErrorGroups(
  db: Db,
  filter: ErrorFilter,
  cursor: { afterSeq: number; afterId: string } | null,
  limit: number,
): SeqPage<ErrorGroupRow> {
  const where = [eq(errorGroups.connectionId, filter.connectionId), eq(errorGroups.scope, filter.scope)];
  if (filter.status?.length) where.push(inArray(errorGroups.status, [...filter.status]));
  if (filter.sinceMs !== undefined) where.push(gte(errorGroups.lastSeenAt, filter.sinceMs));
  if (cursor !== null) where.push(gt(errorGroups.seq, cursor.afterSeq));

  const rows = db
    .select()
    .from(errorGroups)
    .where(and(...where))
    .orderBy(asc(errorGroups.seq), asc(errorGroups.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit);
  const more = rows.length > limit;
  const last = items[items.length - 1];
  return { items, nextSeq: more && last ? last.seq : null, nextId: more && last ? last.id : null };
}

export function findErrorGroup(db: Db, id: string): ErrorGroupRow | null {
  return db.select().from(errorGroups).where(eq(errorGroups.id, id)).get() ?? null;
}

/** How many times a group was seen in a window, and across how many instances. */
export function countOccurrences(
  db: Db,
  groupId: string,
  window?: { from: number; to: number },
): { count: number; instances: number | null } {
  const where = [eq(errorOccurrences.groupId, groupId)];
  if (window) {
    where.push(gte(errorOccurrences.hourAt, hourOf(window.from)));
    where.push(lt(errorOccurrences.hourAt, window.to));
  }
  const rows = db
    .select()
    .from(errorOccurrences)
    .where(and(...where))
    .all();
  const instances = rows.reduce<number | null>(
    (best, row) => (row.instances === null ? best : Math.max(best ?? 0, row.instances)),
    null,
  );
  return { count: rows.reduce((total, row) => total + row.count, 0), instances };
}

/** The hourly buckets of a group, oldest first, for a trend. */
export function occurrenceSeries(db: Db, groupId: string, sinceMs: number): { at: number; count: number }[] {
  return db
    .select({ at: errorOccurrences.hourAt, count: errorOccurrences.count })
    .from(errorOccurrences)
    .where(and(eq(errorOccurrences.groupId, groupId), gte(errorOccurrences.hourAt, hourOf(sinceMs))))
    .orderBy(asc(errorOccurrences.hourAt))
    .all();
}

export function setErrorStatus(db: Db, id: string, status: ErrorGroupStatus, at: number, reason?: string): ErrorGroupRow {
  return db
    .update(errorGroups)
    .set({ status, statusSince: at, ...(reason === undefined ? {} : { mutedReason: reason }) })
    .where(eq(errorGroups.id, id))
    .returning()
    .get();
}

/** Every log source of an environment. A disabled one costs nothing and is still listed, so it can be turned on. */
export function listLogSources(db: Db, connectionId: string, scope: string): LogSourceRow[] {
  return db
    .select()
    .from(logSources)
    .where(and(eq(logSources.connectionId, connectionId), eq(logSources.scope, scope)))
    .orderBy(asc(logSources.logGroup))
    .all();
}

export function enabledLogSources(db: Db, connectionId: string, scope: string): LogSourceRow[] {
  return listLogSources(db, connectionId, scope).filter((source) => source.enabled);
}

export function upsertLogSource(
  db: Db,
  input: Omit<LogSourceRow, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): LogSourceRow {
  const existing = db
    .select()
    .from(logSources)
    .where(
      and(
        eq(logSources.connectionId, input.connectionId),
        eq(logSources.scope, input.scope),
        eq(logSources.logGroup, input.logGroup),
      ),
    )
    .get();
  if (existing) {
    return db
      .update(logSources)
      .set({ enabled: input.enabled, format: input.format, fieldMap: input.fieldMap, serviceId: input.serviceId })
      .where(eq(logSources.id, existing.id))
      .returning()
      .get();
  }
  return db
    .insert(logSources)
    .values({ ...input, id: input.id ?? randomId(), createdAt: input.createdAt ?? Date.now() })
    .returning()
    .get();
}

/**
 * Where a reader had got to. "What's new" is measured against the last time *you* looked, which is what makes
 * a brief personal rather than generic; §4.4 falls back to 24 hours when there is no mark.
 */
export function readMark(db: Db, adminUserId: number, kind: string, connectionId: string, scope: string): number | null {
  return (
    db
      .select({ seenAt: userMarks.seenAt })
      .from(userMarks)
      .where(
        and(
          eq(userMarks.adminUserId, adminUserId),
          eq(userMarks.kind, kind),
          eq(userMarks.connectionId, connectionId),
          eq(userMarks.scope, scope),
        ),
      )
      .get()?.seenAt ?? null
  );
}

export function writeMark(db: Db, adminUserId: number, kind: string, connectionId: string, scope: string, seenAt: number): void {
  db.insert(userMarks)
    .values({ adminUserId, kind, connectionId, scope, seenAt })
    .onConflictDoUpdate({
      target: [userMarks.adminUserId, userMarks.kind, userMarks.connectionId, userMarks.scope],
      set: { seenAt },
    })
    .run();
}

/** Newest groups first, for the "what's new" sets that are ranked by recency rather than paged. */
export function recentErrorGroups(db: Db, filter: ErrorFilter, limit: number): ErrorGroupRow[] {
  const where = [eq(errorGroups.connectionId, filter.connectionId), eq(errorGroups.scope, filter.scope)];
  if (filter.status?.length) where.push(inArray(errorGroups.status, [...filter.status]));
  if (filter.sinceMs !== undefined) where.push(gte(errorGroups.statusSince, filter.sinceMs));
  return db
    .select()
    .from(errorGroups)
    .where(and(...where))
    .orderBy(desc(errorGroups.statusSince), desc(errorGroups.seq))
    .limit(limit)
    .all();
}
