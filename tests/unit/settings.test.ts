import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { settings } from '@/lib/db/schema';
import { AUTO_REFRESH_MS } from '@/lib/monitoring/shared/refresh-timer';
import { SettingsInputError, createSettingsStore } from '@/lib/settings/repository';
import { COST_SERVICES, DEFAULT_SETTINGS, REFRESH_INTERVALS_MS, refreshCostPerHour } from '@/lib/settings/shared';
import { createTestDb } from '../helpers/db';

/** A store with a clock the test moves, so the 60-second cache can be observed without waiting. */
function storeAt(start = Date.parse('2026-09-18T10:00:00Z')) {
  let nowMs = start;
  return { store: createSettingsStore({ now: () => nowMs }), advance: (ms: number) => void (nowMs += ms) };
}

describe('the settings store', () => {
  it('answers with today’s behaviour while no one has saved anything', () => {
    // An existing instance must keep working unchanged: two minutes and three hours, from the constants.
    expect(DEFAULT_SETTINGS).toEqual({ refreshIntervalMs: AUTO_REFRESH_MS, defaultRange: '3h' });
    expect(DEFAULT_SETTINGS.refreshIntervalMs).toBe(120_000);
    expect(storeAt().store.read(createTestDb())).toEqual(DEFAULT_SETTINGS);
  });

  it('saves one row and reads it back', () => {
    const db = createTestDb();
    const { store } = storeAt();
    expect(store.save(db, { refreshIntervalMs: '300000', defaultRange: '24h' })).toEqual({ refreshIntervalMs: 300_000, defaultRange: '24h' });
    expect(store.read(db)).toEqual({ refreshIntervalMs: 300_000, defaultRange: '24h' });
    store.save(db, { refreshIntervalMs: 0, defaultRange: '1h' });
    // Still one row: the instance has one admin, so the settings are a single row, never a growing table.
    expect(db.select().from(settings).all()).toHaveLength(1);
  });

  it('refuses a refresh interval that is not one of the offered ones, and never clamps it', () => {
    const db = createTestDb();
    const { store } = storeAt();
    for (const bad of ['45000', 'soon', '-60000', '']) {
      expect(() => store.save(db, { refreshIntervalMs: bad, defaultRange: '3h' })).toThrow(SettingsInputError);
    }
    expect(() => store.save(db, { refreshIntervalMs: '45000', defaultRange: '3h' })).toThrow(expect.objectContaining({ code: 'refresh_invalid' }));
    expect(() => store.save(db, { refreshIntervalMs: '60000', defaultRange: '2h' })).toThrow(expect.objectContaining({ code: 'range_invalid' }));
    // A refused save changes nothing.
    expect(store.read(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts every interval the Settings page offers', () => {
    const db = createTestDb();
    const { store } = storeAt();
    for (const ms of REFRESH_INTERVALS_MS) expect(store.save(db, { refreshIntervalMs: String(ms), defaultRange: '3h' }).refreshIntervalMs).toBe(ms);
  });

  it('keeps a read for 60 seconds so a page render never pays a round trip per card', () => {
    const db = createTestDb();
    const { store, advance } = storeAt();
    store.save(db, { refreshIntervalMs: 60_000, defaultRange: '1h' });
    expect(store.read(db)).toEqual({ refreshIntervalMs: 60_000, defaultRange: '1h' });
    // Changed behind the store's back: only the clock can make it look again.
    db.update(settings).set({ refreshIntervalMs: 600_000 }).where(eq(settings.id, 1)).run();
    advance(59_999);
    expect(store.read(db).refreshIntervalMs).toBe(60_000);
    advance(1);
    expect(store.read(db).refreshIntervalMs).toBe(600_000);
  });

  it('drops the cached value on save, so the new value applies at once', () => {
    const db = createTestDb();
    const { store } = storeAt();
    expect(store.read(db).refreshIntervalMs).toBe(AUTO_REFRESH_MS);
    store.save(db, { refreshIntervalMs: 30_000, defaultRange: '12h' });
    expect(store.read(db)).toEqual({ refreshIntervalMs: 30_000, defaultRange: '12h' });
  });

  it('falls back to the default range if a stored row holds a range this version does not know', () => {
    const db = createTestDb();
    db.insert(settings).values({ id: 1, refreshIntervalMs: 30_000, defaultRange: '90d', updatedAt: new Date(0) }).run();
    expect(storeAt().store.read(db)).toEqual({ refreshIntervalMs: 30_000, defaultRange: DEFAULT_SETTINGS.defaultRange });
  });
});

describe('what a refresh interval costs', () => {
  it('counts the metrics of a page of about thirty services, from the README figures', () => {
    // GetMetricData is billed per metric requested, about USD 0.01 per 1,000; the Containers list asks
    // for two metrics per service, so two minutes is 30 refreshes of 60 metrics an hour.
    expect(COST_SERVICES).toBe(30);
    expect(refreshCostPerHour(120_000)).toEqual({ refreshesPerHour: 30, metricsPerHour: 1_800, usdPerHour: 0.018 });
    expect(refreshCostPerHour(30_000)).toEqual({ refreshesPerHour: 120, metricsPerHour: 7_200, usdPerHour: 0.072 });
    expect(refreshCostPerHour(60_000)).toEqual({ refreshesPerHour: 60, metricsPerHour: 3_600, usdPerHour: 0.036 });
    expect(refreshCostPerHour(300_000)).toEqual({ refreshesPerHour: 12, metricsPerHour: 720, usdPerHour: 0.0072 });
    expect(refreshCostPerHour(600_000)).toEqual({ refreshesPerHour: 6, metricsPerHour: 360, usdPerHour: 0.0036 });
  });

  it('agrees with the README’s worked example of eight hours on a Containers page', () => {
    const { metricsPerHour, usdPerHour } = refreshCostPerHour(AUTO_REFRESH_MS);
    expect(metricsPerHour * 8).toBe(14_400);
    expect((usdPerHour * 8).toFixed(2)).toBe('0.14');
  });

  it('costs nothing when auto-refresh is off', () => {
    expect(refreshCostPerHour(0)).toEqual({ refreshesPerHour: 0, metricsPerHour: 0, usdPerHour: 0 });
  });
});
