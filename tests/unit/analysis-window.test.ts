import { describe, expect, it } from 'vitest';
import {
  CHANGE_FLAT_RATIO, DEFAULT_REPORT_RANGE, REPORT_PERIOD_SECONDS, REPORT_RANGES,
  aggregateSeries, compareWindows, doubleWindow, parseReportRange, splitSeries, windowedMetric,
} from '@/lib/analysis/window';

const now = Date.parse('2026-09-18T14:07:42Z');

describe('doubleWindow', () => {
  it('floors the end to the period and puts the split one range before it', () => {
    const w = doubleWindow('12h', now);
    // 900 s period: 14:07:42 floors to 14:00:00.
    expect(w.fetch.end).toEqual(new Date('2026-09-18T14:00:00Z'));
    expect(w.fetch.start).toEqual(new Date('2026-09-17T14:00:00Z')); // 2 × 12 h
    expect(w.fetch.periodSeconds).toBe(900);
    expect(w.current).toEqual({ start: new Date('2026-09-18T02:00:00Z'), end: new Date('2026-09-18T14:00:00Z'), periodSeconds: 900 });
    expect(w.previous).toEqual({ start: new Date('2026-09-17T14:00:00Z'), end: new Date('2026-09-18T02:00:00Z'), periodSeconds: 900 });
    expect(w.splitAtMs).toBe(Date.parse('2026-09-18T02:00:00Z'));
    expect(w.range).toBe('12h');
  });

  it('gives every range a period that divides it exactly', () => {
    for (const range of REPORT_RANGES) {
      const w = doubleWindow(range, now);
      const halfSeconds = (w.current.end.getTime() - w.current.start.getTime()) / 1000;
      expect(halfSeconds % REPORT_PERIOD_SECONDS[range]).toBe(0);
      expect(w.fetch.end.getTime() % (REPORT_PERIOD_SECONDS[range] * 1000)).toBe(0);
    }
  });

  it('is stable within a period, so two renders share one cache key', () => {
    // now (14:07:42) floors to 14:05:00 for the 3h range's 300 s period; the next boundary is 14:10:00,
    // 138 s later. +137_000 stays inside that bucket; +600_000 has certainly crossed into a later one.
    expect(doubleWindow('3h', now)).toEqual(doubleWindow('3h', now + 137_000));
    expect(doubleWindow('3h', now).fetch.end).not.toEqual(doubleWindow('3h', now + 600_000).fetch.end);
  });
});

describe('parseReportRange', () => {
  it('falls back to 12 h and takes the first value of an array', () => {
    expect(parseReportRange(undefined)).toBe(DEFAULT_REPORT_RANGE);
    expect(parseReportRange('1h')).toBe('12h');   // 1h is not a report range
    expect(parseReportRange(['7d', '3h'])).toBe('7d');
  });
});

describe('splitSeries', () => {
  // A CloudWatch datapoint is timestamped at the START of its period, so t >= splitAt is the current half.
  const series = { timestamps: [10, 20, 30, 40], values: [1, 2, 3, 4] };
  it('puts the datapoint on the boundary in the current half', () => {
    expect(splitSeries(series, 30)).toEqual({
      previous: { timestamps: [10, 20], values: [1, 2] },
      current: { timestamps: [30, 40], values: [3, 4] },
    });
  });
  it('handles an empty series and an all-previous series', () => {
    expect(splitSeries({ timestamps: [], values: [] }, 30)).toEqual({ previous: { timestamps: [], values: [] }, current: { timestamps: [], values: [] } });
    expect(splitSeries(series, 99).current).toEqual({ timestamps: [], values: [] });
  });
});

describe('aggregateSeries', () => {
  it('averages, sums and maxes, and returns null for an empty series', () => {
    const s = { timestamps: [1, 2, 3], values: [2, 4, 9] };
    expect(aggregateSeries(s, 'average')).toBe(5);
    expect(aggregateSeries(s, 'sum')).toBe(15);
    expect(aggregateSeries(s, 'max')).toBe(9);
    expect(aggregateSeries({ timestamps: [], values: [] }, 'average')).toBeNull();
    expect(aggregateSeries({ timestamps: [], values: [] }, 'sum')).toBeNull();
    expect(aggregateSeries({ timestamps: [], values: [] }, 'max')).toBeNull();
  });
});

describe('compareWindows', () => {
  it('classifies up, down, flat, new and unavailable', () => {
    expect(compareWindows(120, 100)).toEqual({ kind: 'up', ratio: 0.2 });
    expect(compareWindows(80, 100)).toEqual({ kind: 'down', ratio: -0.2 });
    expect(compareWindows(100.5, 100)).toEqual({ kind: 'flat', ratio: 0.005 });
    expect(CHANGE_FLAT_RATIO).toBe(0.01);
    expect(compareWindows(0, 0)).toEqual({ kind: 'flat', ratio: 0 });
    expect(compareWindows(5, 0)).toEqual({ kind: 'new' });
    expect(compareWindows(null, 100)).toEqual({ kind: 'unavailable' });
    expect(compareWindows(100, null)).toEqual({ kind: 'unavailable' });
  });
  it('treats a negative previous value as uncomparable rather than inverting the arrow', () => {
    expect(compareWindows(10, -5)).toEqual({ kind: 'unavailable' });
  });
});

describe('windowedMetric', () => {
  it('splits, aggregates each half and compares in one go', () => {
    const w = doubleWindow('3h', now);
    const step = 300_000;
    const start = w.fetch.start.getTime();
    // 36 datapoints of 10 in the previous half, 36 of 15 in the current half.
    const timestamps = Array.from({ length: 72 }, (_, i) => start + i * step);
    const values = timestamps.map((t) => (t < w.splitAtMs ? 10 : 15));
    expect(windowedMetric({ timestamps, values }, w, 'average')).toEqual({ current: 15, previous: 10, change: { kind: 'up', ratio: 0.5 } });
    expect(windowedMetric({ timestamps, values }, w, 'sum')).toEqual({ current: 540, previous: 360, change: { kind: 'up', ratio: 0.5 } });
    expect(windowedMetric({ timestamps: [], values: [] }, w, 'max')).toEqual({ current: null, previous: null, change: { kind: 'unavailable' } });
  });
});
