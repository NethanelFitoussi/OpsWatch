import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { settings } from '../db/schema';
import { TIME_RANGES, type TimeRange } from '../monitoring/shared/time-range';
import { isOneOf } from '../type-guards';
import { DEFAULT_SETTINGS, REFRESH_INTERVALS_MS, type AppSettings } from './shared';

/** The instance has one admin, so the settings are one row; this is its primary key. */
const SETTINGS_ROW_ID = 1;
/** Long enough that one page render, with all its cards, reads the database at most once. */
const SETTINGS_TTL_MS = 60_000;

export type SettingsInputErrorCode = 'refresh_invalid' | 'range_invalid';

export class SettingsInputError extends Error {
  constructor(public readonly code: SettingsInputErrorCode) {
    super(code);
    this.name = 'SettingsInputError';
  }
}

// A refused value is never clamped to the nearest offered one: the admin is told instead. A missing
// field arrives as an empty string, which must not coerce to 0 and quietly turn auto-refresh off.
const refreshIntervalSchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .refine((ms) => (REFRESH_INTERVALS_MS as readonly number[]).includes(ms));
const defaultRangeSchema = z.enum(TIME_RANGES);

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, code: SettingsInputErrorCode): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SettingsInputError(code);
  return parsed.data;
}

/** A row written by another version may name a range this one dropped; the default stands in for it. */
function storedRange(value: string): TimeRange {
  return isOneOf(TIME_RANGES, value) ? value : DEFAULT_SETTINGS.defaultRange;
}

export type SettingsStore = {
  /** The saved settings, or today's behaviour while nothing has been saved. Cached for 60 seconds. */
  read(db: Db): AppSettings;
  /** Validates and stores the whole row, then drops the cached value so the change applies at once. */
  save(db: Db, input: { refreshIntervalMs: unknown; defaultRange: unknown }): AppSettings;
};

export function createSettingsStore({ now = Date.now, ttlMs = SETTINGS_TTL_MS }: { now?: () => number; ttlMs?: number } = {}): SettingsStore {
  let entry: { value: AppSettings; expiresAt: number } | null = null;
  return {
    read(db) {
      if (entry && entry.expiresAt > now()) return entry.value;
      const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ROW_ID)).get();
      const value: AppSettings = row
        ? { refreshIntervalMs: row.refreshIntervalMs, defaultRange: storedRange(row.defaultRange) }
        : DEFAULT_SETTINGS;
      entry = { value, expiresAt: now() + ttlMs };
      return value;
    },
    save(db, input) {
      const value: AppSettings = {
        refreshIntervalMs: parseOrThrow(refreshIntervalSchema, input.refreshIntervalMs, 'refresh_invalid'),
        defaultRange: parseOrThrow(defaultRangeSchema, input.defaultRange, 'range_invalid'),
      };
      const updatedAt = new Date(now());
      db.insert(settings)
        .values({ id: SETTINGS_ROW_ID, ...value, updatedAt })
        .onConflictDoUpdate({ target: settings.id, set: { ...value, updatedAt } })
        .run();
      entry = null;
      return value;
    },
  };
}

/** One store per server process, shared by every page render. */
export const appSettings: SettingsStore = createSettingsStore();
