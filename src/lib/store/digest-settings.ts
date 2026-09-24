import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { digestSettings, type DigestSettingsRow } from '../db/schema';

/** The SQL behind the weekly summary switch. Here, not in `lib/notify/`, because §9.6 is unconditional. */
const DIGEST_SETTINGS_ID = 1;

/**
 * What an installation that has never been configured gets: **off**.
 *
 * Returned rather than written, so a fresh database has no row at all and nobody can mistake a default
 * for a decision somebody made.
 */
export function readDigestSettings(db: Db): DigestSettingsRow {
  return (
    db.select().from(digestSettings).where(eq(digestSettings.id, DIGEST_SETTINGS_ID)).get() ?? {
      id: DIGEST_SETTINGS_ID,
      enabled: false,
      dayOfWeek: 1,
      hourUtc: 8,
      lastSentAt: null,
      updatedAt: 0,
    }
  );
}

export function writeDigestSettings(
  db: Db,
  patch: { enabled: boolean; dayOfWeek: number; hourUtc: number },
  nowMs: number,
): DigestSettingsRow {
  const current = readDigestSettings(db);
  // `lastSentAt` survives a settings change: switching the day must not make a second summary due in the
  // same week, which is how a "small edit" turns into two emails on a Tuesday.
  const row: DigestSettingsRow = { ...current, ...patch, updatedAt: nowMs };
  db.insert(digestSettings).values(row).onConflictDoUpdate({ target: digestSettings.id, set: { ...row } }).run();
  return row;
}

/** Records that a summary went out, which is what keeps the cadence weekly rather than hourly. */
export function markDigestSent(db: Db, nowMs: number): void {
  const row: DigestSettingsRow = { ...readDigestSettings(db), lastSentAt: nowMs, updatedAt: nowMs };
  db.insert(digestSettings).values(row).onConflictDoUpdate({ target: digestSettings.id, set: { ...row } }).run();
}
