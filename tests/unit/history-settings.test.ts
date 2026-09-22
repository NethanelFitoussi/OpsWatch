import { describe, expect, it } from 'vitest';
import { DEFAULT_HISTORY, HISTORY_PRESETS, SUGGESTED_INTERVAL, historyEnabled, readHistorySettings, writeHistorySettings } from '@/lib/history/settings';
import { HISTORY_INTERVALS, LIMITED_WITHOUT_HISTORY, RETENTION_CHOICES } from '@/lib/history/shared';
import { estimateMonthly, intervalComparison, USD_PER_1000_METRICS, MINUTES_PER_MONTH } from '@/lib/history/estimate';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

describe('history is off until someone says otherwise (§31.1)', () => {
  it('is disabled on a fresh installation', () => {
    const db = createTestDb();
    // The owner's binding ruling: a fresh install must never add AWS polling cost without an explicit action.
    expect(historyEnabled(db)).toBe(false);
    expect(readHistorySettings(db).enabled).toBe(false);
  });

  it('treats the absence of a row as off, not as a default worth starting', () => {
    const db = createTestDb();
    expect(DEFAULT_HISTORY.enabled).toBe(false);
    // There is no interval a product may choose on an operator's behalf when the choice costs them money.
    expect(readHistorySettings(db).updatedAt).toBe(0);
  });

  it('stays off across a read, because reading is not consenting', () => {
    const db = createTestDb();
    readHistorySettings(db);
    readHistorySettings(db);
    expect(historyEnabled(db)).toBe(false);
  });

  it('turns on only when asked, and remembers what was chosen', () => {
    const db = createTestDb();
    const saved = writeHistorySettings(db, { enabled: true, intervalMinutes: 15, categories: ['infrastructure'] }, NOW);
    expect({ enabled: saved.enabled, interval: saved.intervalMinutes }).toEqual({ enabled: true, interval: 15 });
    expect(historyEnabled(db)).toBe(true);
    expect(readHistorySettings(db).categories).toEqual(['infrastructure']);
  });

  it('can be turned off again without losing what was configured', () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true, intervalMinutes: 30, categories: ['database'] }, NOW);
    const off = writeHistorySettings(db, { enabled: false }, NOW + 1000);
    expect(off.enabled).toBe(false);
    expect({ interval: off.intervalMinutes, categories: off.categories }).toEqual({ interval: 30, categories: ['database'] });
  });

  it('offers §31.1\'s intervals and says what is limited while it is off', () => {
    expect([...HISTORY_INTERVALS]).toEqual([1, 5, 10, 15, 30, 60]);
    expect(HISTORY_INTERVALS).toContain(SUGGESTED_INTERVAL);
    expect([...RETENTION_CHOICES]).toEqual([30, 90, 180, 365]);
    // The trade has to be visible before it is made, not discovered afterwards.
    expect(LIMITED_WITHOUT_HISTORY).toContain('baselines');
    expect(LIMITED_WITHOUT_HISTORY).toContain('reports');
    expect(LIMITED_WITHOUT_HISTORY).toContain('slos');
  });

  it('has presets so nobody has to reason about eleven categories to begin', () => {
    expect(HISTORY_PRESETS.minimal.length).toBeLessThan(HISTORY_PRESETS.standard.length);
    expect(HISTORY_PRESETS.standard.length).toBeLessThan(HISTORY_PRESETS.detailed.length);
  });
});

describe('the estimate branches by billing unit (§33.12)', () => {
  it('never blends two units into one number', () => {
    const estimate = estimateMonthly({
      intervalMinutes: 5,
      metricCategories: [{ id: 'infrastructure', metricsPerCycle: 258 }],
      scanCategories: [{ id: 'errors', bytesPerDay: 1024 ** 3 }],
    });
    // Two lines, because averaging them would hide the half that can surprise.
    expect(estimate.lines).toHaveLength(2);
    expect(estimate.mixed).toBe(true);
    expect(estimate.lines.map((line) => line.unit).sort()).toEqual(['bytes_scanned', 'metrics']);
  });

  it('says plainly which half is the volatile one', () => {
    const estimate = estimateMonthly({
      intervalMinutes: 5,
      metricCategories: [{ id: 'infrastructure', metricsPerCycle: 258 }],
      scanCategories: [{ id: 'errors', bytesPerDay: 1024 ** 3 }],
    });
    // Metric cost is arithmetic; scan cost follows whatever the application happens to log.
    expect(estimate.lines.find((line) => line.unit === 'metrics')?.volatile).toBe(false);
    expect(estimate.lines.find((line) => line.unit === 'bytes_scanned')?.volatile).toBe(true);
  });

  it('prices metrics at the published rate, from arithmetic anyone can check', () => {
    const estimate = estimateMonthly({ intervalMinutes: 5, metricCategories: [{ id: 'a', metricsPerCycle: 258 }], scanCategories: [] });
    const line = estimate.lines[0];
    const cycles = Math.floor(MINUTES_PER_MONTH / 5);
    expect(line.cycles).toBe(cycles);
    expect(line.metrics).toBe(cycles * 258);
    expect(line.usd).toBeCloseTo((cycles * 258 / 1000) * USD_PER_1000_METRICS, 6);
  });

  it('shows one line when only one unit is selected', () => {
    const onlyMetrics = estimateMonthly({ intervalMinutes: 5, metricCategories: [{ id: 'a', metricsPerCycle: 10 }], scanCategories: [] });
    expect(onlyMetrics.mixed).toBe(false);
    expect(onlyMetrics.lines).toHaveLength(1);
  });

  it('costs nothing when nothing is selected, rather than guessing', () => {
    const nothing = estimateMonthly({ intervalMinutes: 5, metricCategories: [], scanCategories: [] });
    expect(nothing.lines).toEqual([]);
    expect(nothing.totalUsd).toBe(0);
  });

  it('shows each interval its own consequence, on both axes (§31.1)', () => {
    const fast = intervalComparison(258, 1);
    const slow = intervalComparison(258, 15);
    // Precision gained against requests added: a third of the bill at fifteen minutes, as §9.5 says.
    expect(fast.metricsPerMonth).toBeGreaterThan(slow.metricsPerMonth);
    expect(slow.cyclesPerMonth * 3).toBe(intervalComparison(258, 5).cyclesPerMonth);
  });
});
