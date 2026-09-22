import 'server-only';
import type { Db } from '../db/client';
import { HISTORY_CATEGORIES, type HistoryCategoryId, type HistorySettingsRow } from '../db/schema';
import { HISTORY_SETTINGS_ID, selectHistorySettings, upsertHistorySettings } from '../store/history-settings';
import type { HistoryInterval } from './shared';

/**
 * Historical collection, off by default (§31.1).
 *
 * The owner's ruling is binding and unusually specific: **a fresh installation must never add AWS polling
 * cost without an explicit action.** So the absence of a row means disabled, not "use a sensible default" —
 * there is no interval a product may choose on an operator's behalf when the choice costs them money.
 */
/** The presets, so an operator does not have to reason about eleven categories to get started. */
export const HISTORY_PRESETS: Record<'minimal' | 'standard' | 'detailed', HistoryCategoryId[]> = {
  minimal: ['infrastructure'],
  standard: ['infrastructure', 'application', 'database', 'problems'],
  detailed: [...HISTORY_CATEGORIES],
};

/** The interval a fresh form suggests. Only ever a suggestion: nothing collects until someone enables it. */
export const SUGGESTED_INTERVAL: HistoryInterval = 5;

export const DEFAULT_HISTORY: Omit<HistorySettingsRow, 'id' | 'updatedAt'> = {
  enabled: false,
  intervalMinutes: 5,
  categories: HISTORY_PRESETS.standard,
  retentionDays: 90,
  providerId: 'opswatch-db',
};

export function readHistorySettings(db: Db): HistorySettingsRow {
  const row = selectHistorySettings(db);
  // No row means off. Never a default that starts spending.
  return row ?? { id: HISTORY_SETTINGS_ID, ...DEFAULT_HISTORY, updatedAt: 0 };
}

export function writeHistorySettings(
  db: Db,
  input: Partial<Omit<HistorySettingsRow, 'id' | 'updatedAt'>>,
  nowMs: number,
): HistorySettingsRow {
  const current = readHistorySettings(db);
  const next = { ...current, ...input, id: HISTORY_SETTINGS_ID, updatedAt: nowMs };
  upsertHistorySettings(db, next);
  return next;
}

/** Whether the metrics job may run at all. The single question the collector asks before spending anything. */
export function historyEnabled(db: Db): boolean {
  return readHistorySettings(db).enabled;
}
