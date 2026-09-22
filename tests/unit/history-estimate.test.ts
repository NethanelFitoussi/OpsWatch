import { describe, expect, it } from 'vitest';
import {
  MINUTES_PER_MONTH,
  USD_PER_1000_METRICS,
  USD_PER_GB_SCANNED,
  estimateMonthly,
  intervalComparison,
  type EstimateLine,
} from '@/lib/history/estimate';

/**
 * §33.12 — the estimate branches by billing unit and **never shows one blended number**.
 *
 * The ruling exists because the two halves behave differently: one is arithmetic, the other moves with
 * whatever the application logs. A single averaged figure would hide the half that can surprise on a bill.
 */

const metrics = [{ id: 'ecs', metricsPerCycle: 40 }];
const scans = [{ id: 'errors', bytesPerDay: 2 * 1024 ** 3 }];

describe('§33.12 — two units are never blended', () => {
  it('THE RULING: a mixed selection produces two lines, each labelled with its own unit', () => {
    const estimate = estimateMonthly({ intervalMinutes: 5, metricCategories: metrics, scanCategories: scans });
    expect(estimate.mixed).toBe(true);
    expect(estimate.lines.map((line) => line.unit)).toEqual(['metrics', 'bytes_scanned']);
    // Each line carries the figure for its own unit and null for the other, so neither can be summed by mistake.
    const [metricLine, scanLine] = estimate.lines as [EstimateLine, EstimateLine];
    expect(metricLine.gigabytes).toBeNull();
    expect(scanLine.metrics).toBeNull();
  });

  it('marks the scan-billed half volatile and the metric-billed half not', () => {
    const estimate = estimateMonthly({ intervalMinutes: 5, metricCategories: metrics, scanCategories: scans });
    expect(estimate.lines.map((line) => line.volatile)).toEqual([false, true]);
  });

  it('is not mixed when only one unit is selected, so the page shows one line honestly', () => {
    expect(estimateMonthly({ intervalMinutes: 5, metricCategories: metrics, scanCategories: [] }).mixed).toBe(false);
    expect(estimateMonthly({ intervalMinutes: 5, metricCategories: [], scanCategories: scans }).mixed).toBe(false);
  });

  it('estimates nothing when nothing is selected', () => {
    const estimate = estimateMonthly({ intervalMinutes: 5, metricCategories: [], scanCategories: [] });
    expect(estimate.lines).toEqual([]);
    expect(estimate.totalUsd).toBe(0);
  });
});

describe('the metric half is arithmetic', () => {
  it('counts cycles from the interval, and requests from the cycles', () => {
    const estimate = estimateMonthly({ intervalMinutes: 5, metricCategories: metrics, scanCategories: [] });
    const line = estimate.lines[0] as EstimateLine;
    const requested = MINUTES_PER_MONTH / 5;
    expect(line.cycles).toBe(requested);
    expect(line.metrics).toBe(requested * 40);
    expect(line.usd).toBeCloseTo((requested * 40 / 1000) * USD_PER_1000_METRICS, 10);
  });

  it('halves the requests when the interval doubles, which is the trade §31.1 asks each option to state', () => {
    const fast = estimateMonthly({ intervalMinutes: 5, metricCategories: metrics, scanCategories: [] });
    const slow = estimateMonthly({ intervalMinutes: 10, metricCategories: metrics, scanCategories: [] });
    const fastMetrics = (fast.lines[0] as EstimateLine).metrics ?? 0;
    expect((slow.lines[0] as EstimateLine).metrics).toBe(fastMetrics / 2);
    expect(fastMetrics).toBeGreaterThan(0);
  });

  it('adds nothing for an interval of zero rather than dividing by it', () => {
    expect(estimateMonthly({ intervalMinutes: 0, metricCategories: metrics, scanCategories: [] }).lines).toEqual([]);
    expect(intervalComparison(40, 0)).toEqual({ cyclesPerMonth: 0, metricsPerMonth: 0 });
  });
});

describe('the scan half follows log volume, not the polling interval', () => {
  it('prices per gigabyte scanned over a month', () => {
    const line = estimateMonthly({ intervalMinutes: 5, metricCategories: [], scanCategories: scans }).lines[0] as EstimateLine;
    expect(line.gigabytes).toBeCloseTo(2 * 30, 6);
    expect(line.usd).toBeCloseTo(2 * 30 * USD_PER_GB_SCANNED, 10);
  });

  it('does not move when the metric interval changes, because it is billed on a different thing entirely', () => {
    const fast = estimateMonthly({ intervalMinutes: 1, metricCategories: [], scanCategories: scans });
    const slow = estimateMonthly({ intervalMinutes: 60, metricCategories: [], scanCategories: scans });
    expect(fast.lines[0]?.usd).toBe(slow.lines[0]?.usd);
  });
});

describe('the total', () => {
  it('is the sum of the lines, and is offered alongside them rather than instead of them', () => {
    const estimate = estimateMonthly({ intervalMinutes: 5, metricCategories: metrics, scanCategories: scans });
    expect(estimate.totalUsd).toBeCloseTo(estimate.lines.reduce((sum, line) => sum + line.usd, 0), 10);
    // The lines survive into the result: a caller cannot render the total without having been handed both units.
    expect(estimate.lines).toHaveLength(2);
  });
});
