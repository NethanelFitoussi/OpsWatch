import 'server-only';
import { average, sum } from '../monitoring/evaluate';
import type { SeriesData } from '../monitoring/metrics';
import { RANGE_SECONDS, type TimeRange, type TimeWindow } from '../monitoring/shared/time-range';
import { isOneOf } from '../type-guards';

export const REPORT_RANGES = ['3h', '12h', '24h', '7d'] as const satisfies readonly TimeRange[];
export type ReportRange = (typeof REPORT_RANGES)[number];
export const DEFAULT_REPORT_RANGE: ReportRange = '12h';

/** Coarser than the live pages (§3): a report reads a trend, not a spike. Each range divides exactly by its period. */
export const REPORT_PERIOD_SECONDS: Record<ReportRange, number> = { '3h': 300, '12h': 900, '24h': 1800, '7d': 3600 };

export function parseReportRange(value: string | string[] | undefined): ReportRange {
  const first = Array.isArray(value) ? value[0] : value;
  return isOneOf(REPORT_RANGES, first) ? first : DEFAULT_REPORT_RANGE;
}

export type DoubleWindow = { fetch: TimeWindow; current: TimeWindow; previous: TimeWindow; splitAtMs: number; range: ReportRange };

/**
 * One window of twice the range, plus the two halves it splits into (amendment 6). The end is floored to the
 * period, not to the minute, so the split lands on a datapoint boundary and the cache key stays stable for a
 * whole period instead of a whole minute.
 */
export function doubleWindow(range: ReportRange, nowMs: number): DoubleWindow {
  const periodSeconds = REPORT_PERIOD_SECONDS[range];
  const periodMs = periodSeconds * 1000;
  const endMs = Math.floor(nowMs / periodMs) * periodMs;
  const halfMs = RANGE_SECONDS[range] * 1000;
  const splitAtMs = endMs - halfMs;
  const startMs = endMs - 2 * halfMs;
  return {
    fetch: { start: new Date(startMs), end: new Date(endMs), periodSeconds },
    current: { start: new Date(splitAtMs), end: new Date(endMs), periodSeconds },
    previous: { start: new Date(startMs), end: new Date(splitAtMs), periodSeconds },
    splitAtMs,
    range,
  };
}

/** A CloudWatch datapoint is stamped at the start of its period, so the boundary datapoint belongs to the current half. */
export function splitSeries(series: SeriesData, splitAtMs: number): { current: SeriesData; previous: SeriesData } {
  const at = series.timestamps.findIndex((t) => t >= splitAtMs);
  const cut = at === -1 ? series.timestamps.length : at;
  return {
    previous: { timestamps: series.timestamps.slice(0, cut), values: series.values.slice(0, cut) },
    current: { timestamps: series.timestamps.slice(cut), values: series.values.slice(cut) },
  };
}

export type Aggregate = 'average' | 'sum' | 'max';

export function aggregateSeries(series: SeriesData, aggregate: Aggregate): number | null {
  if (series.values.length === 0) return null;
  if (aggregate === 'average') return average(series.values);
  if (aggregate === 'sum') return sum(series.values);
  return Math.max(...series.values);
}

export type Change = { kind: 'up' | 'down' | 'flat'; ratio: number } | { kind: 'new' } | { kind: 'unavailable' };
/** Below one per cent either way the arrow would be noise, so it reads as flat. */
export const CHANGE_FLAT_RATIO = 0.01;

export function compareWindows(current: number | null, previous: number | null): Change {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return { kind: 'unavailable' };
  // A negative baseline has no meaningful ratio; no metric this stage reads can be negative anyway.
  if (previous < 0) return { kind: 'unavailable' };
  if (previous === 0) return current === 0 ? { kind: 'flat', ratio: 0 } : { kind: 'new' };
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < CHANGE_FLAT_RATIO) return { kind: 'flat', ratio };
  return { kind: ratio > 0 ? 'up' : 'down', ratio };
}

export type WindowedMetric = { current: number | null; previous: number | null; change: Change };

export function windowedMetric(series: SeriesData, split: DoubleWindow, aggregate: Aggregate): WindowedMetric {
  const halves = splitSeries(series, split.splitAtMs);
  const current = aggregateSeries(halves.current, aggregate);
  const previous = aggregateSeries(halves.previous, aggregate);
  return { current, previous, change: compareWindows(current, previous) };
}
