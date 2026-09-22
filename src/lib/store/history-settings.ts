import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { historySettings, type HistorySettingsRow } from '../db/schema';

/** The SQL behind the history switch. Here, not in `lib/history/`, because §9.6 is unconditional. */
export const HISTORY_SETTINGS_ID = 1;

export function selectHistorySettings(db: Db): HistorySettingsRow | undefined {
  return db.select().from(historySettings).where(eq(historySettings.id, HISTORY_SETTINGS_ID)).get();
}

export function upsertHistorySettings(db: Db, row: HistorySettingsRow): void {
  db.insert(historySettings)
    .values(row)
    .onConflictDoUpdate({ target: historySettings.id, set: { ...row } })
    .run();
}
