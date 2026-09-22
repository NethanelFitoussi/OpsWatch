import 'server-only';

/**
 * What enabling historical collection will cost, estimated before anything is switched on (**§33.12**).
 *
 * The ruling is that this **never shows one blended number**. Two things are billed in completely different
 * units, and averaging them hides the one that can surprise:
 *
 * - **metric-billed** categories are priced per metric requested, and are predictable: resources × metrics ×
 *   cycles is arithmetic.
 * - **scan-billed** categories (logs, errors) are priced per gigabyte scanned, and depend on how much the
 *   application happens to log. That is the volatile half, and it is labelled as such.
 *
 * Everything here is an estimate and is called one. A bill depends on prices we do not read and on traffic
 * nobody can predict; presenting it as a figure would be a promise the product cannot keep.
 */

/** Published USD per 1,000 metrics requested from `GetMetricData`, as §9.5 quotes it. */
export const USD_PER_1000_METRICS = 0.01;
/** Published USD per gigabyte scanned by Logs Insights. */
export const USD_PER_GB_SCANNED = 0.005;

export const MINUTES_PER_MONTH = 30 * 24 * 60;

export type MetricCategory = { id: string; metricsPerCycle: number };
export type ScanCategory = { id: string; bytesPerDay: number };

export type EstimateLine = {
  /** How it is billed, which is the whole point of separating them. */
  unit: 'metrics' | 'bytes_scanned';
  /** Cycles a month, or scans a month. */
  cycles: number;
  /** Metrics requested a month, for a metric line. */
  metrics: number | null;
  /** Gigabytes scanned a month, for a scan line. */
  gigabytes: number | null;
  usd: number;
  /** True for the half that depends on how much the application logs, rather than on arithmetic. */
  volatile: boolean;
};

export type Estimate = {
  lines: EstimateLine[];
  totalUsd: number;
  /** True when both halves are present, which is when the caller must show two lines and say which is which. */
  mixed: boolean;
};

/**
 * The estimate for one selection.
 *
 * `intervalMinutes` drives the metric half only: a scan-billed category is read on its own cadence and its
 * cost follows the log volume, not the polling interval.
 */
export function estimateMonthly(input: {
  intervalMinutes: number;
  metricCategories: readonly MetricCategory[];
  scanCategories: readonly ScanCategory[];
  /** How often a scan-billed category is queried, per day. */
  scansPerDay?: number;
}): Estimate {
  const lines: EstimateLine[] = [];

  const metricsPerCycle = input.metricCategories.reduce((total, category) => total + category.metricsPerCycle, 0);
  if (metricsPerCycle > 0 && input.intervalMinutes > 0) {
    const cycles = Math.floor(MINUTES_PER_MONTH / input.intervalMinutes);
    const metrics = cycles * metricsPerCycle;
    lines.push({
      unit: 'metrics',
      cycles,
      metrics,
      gigabytes: null,
      usd: (metrics / 1000) * USD_PER_1000_METRICS,
      // Arithmetic: resources times metrics times cycles. It does not move unless the estimate's inputs do.
      volatile: false,
    });
  }

  const bytesPerDay = input.scanCategories.reduce((total, category) => total + category.bytesPerDay, 0);
  if (bytesPerDay > 0) {
    const scansPerDay = input.scansPerDay ?? 96;
    const gigabytes = (bytesPerDay * 30) / 1024 ** 3;
    lines.push({
      unit: 'bytes_scanned',
      cycles: scansPerDay * 30,
      metrics: null,
      gigabytes,
      usd: gigabytes * USD_PER_GB_SCANNED,
      // Sized from the group's own recent ingestion, and it moves with whatever the application logs.
      volatile: true,
    });
  }

  return {
    lines,
    totalUsd: lines.reduce((total, line) => total + line.usd, 0),
    mixed: lines.length > 1,
  };
}

/**
 * What each interval costs relative to another, which is what §31.1 asks each option to state in one line:
 * precision gained against requests added.
 */
export function intervalComparison(metricsPerCycle: number, minutes: number): { cyclesPerMonth: number; metricsPerMonth: number } {
  const cyclesPerMonth = minutes > 0 ? Math.floor(MINUTES_PER_MONTH / minutes) : 0;
  return { cyclesPerMonth, metricsPerMonth: cyclesPerMonth * metricsPerCycle };
}
