import 'server-only';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cloudflareDaily, type CloudflareDailyRow } from '../db/schema';

/**
 * What Cloudflare reported, as rows (CF-2).
 *
 * Every column is a count Cloudflare gave. Nothing is derived here, so a ratio a page shows can always be
 * recomputed from what is stored and checked against the provider.
 */

export type NewZoneDay = Omit<CloudflareDailyRow, 'fetchedAt'>;

/** Idempotent: a day re-fetched is a day corrected, not a day duplicated. Cloudflare revises recent days. */
export function recordZoneDays(db: Db, rows: readonly NewZoneDay[], nowMs: number): number {
  if (rows.length === 0) return 0;
  return db.transaction(() => {
    for (const row of rows) {
      db.insert(cloudflareDaily)
        .values({ ...row, fetchedAt: nowMs })
        .onConflictDoUpdate({
          target: [cloudflareDaily.zoneId, cloudflareDaily.date],
          set: { ...row, fetchedAt: nowMs },
        })
        .run();
    }
    return rows.length;
  });
}

/** One zone's days, oldest first, which is the order a chart draws. */
export function listZoneDays(db: Db, zoneId: string, sinceDate: string): CloudflareDailyRow[] {
  return db
    .select()
    .from(cloudflareDaily)
    .where(and(eq(cloudflareDaily.zoneId, zoneId), gte(cloudflareDaily.date, sinceDate)))
    .orderBy(asc(cloudflareDaily.date))
    .all();
}

/** Every selected zone at once, for a page that summarises them together. */
export function listDaysForZones(db: Db, zoneIds: readonly string[], sinceDate: string): CloudflareDailyRow[] {
  if (zoneIds.length === 0) return [];
  return db
    .select()
    .from(cloudflareDaily)
    .where(and(inArray(cloudflareDaily.zoneId, [...zoneIds]), gte(cloudflareDaily.date, sinceDate)))
    .orderBy(asc(cloudflareDaily.date))
    .all();
}
