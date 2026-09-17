import 'server-only';
import type { SeriesData } from './metrics';

/** Datapoints in a row past a threshold before a rule starts firing. */
export const MIN_CONSECUTIVE = 3;
export type Direction = 'above' | 'below';
export type Level = { threshold: number; clearAt: number };
export type Levels = { warning: Level; critical?: Level };

/** `series` is ascending (getMetricSeries guarantees it), so the first matching index starts the window. */
export function sliceSince(series: SeriesData, sinceMs: number): SeriesData {
  const start = series.timestamps.findIndex((t) => t >= sinceMs);
  if (start === -1) return { timestamps: [], values: [] };
  return { timestamps: series.timestamps.slice(start), values: series.values.slice(start) };
}

export const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
export const average = (values: readonly number[]): number | null => (values.length === 0 ? null : sum(values) / values.length);

/**
 * Hysteresis computed from the series alone: no state is stored between requests. While inactive, a run of
 * MIN_CONSECUTIVE datapoints past the threshold activates the breach; while active, only a datapoint at or
 * beyond `clearAt` clears it, so values between `clearAt` and the threshold keep it active.
 */
export function breachActive(values: readonly number[], level: Level, direction: Direction): boolean {
  const past = (v: number) => (direction === 'above' ? v > level.threshold : v < level.threshold);
  const cleared = (v: number) => (direction === 'above' ? v <= level.clearAt : v >= level.clearAt);
  let active = false;
  let run = 0;
  for (const v of values) {
    if (active) {
      if (cleared(v)) {
        active = false;
        run = 0;
      }
      continue;
    }
    run = past(v) ? run + 1 : 0;
    if (run >= MIN_CONSECUTIVE) active = true;
  }
  return active;
}

/** A level fires when the window average is past its threshold and the breach is still active at the end of the window. */
export function thresholdLevel(series: SeriesData, levels: Levels, direction: Direction): 'critical' | 'warning' | null {
  const avg = average(series.values);
  if (avg === null) return null;
  const fires = (level: Level) =>
    (direction === 'above' ? avg > level.threshold : avg < level.threshold) && breachActive(series.values, level, direction);
  if (levels.critical && fires(levels.critical)) return 'critical';
  return fires(levels.warning) ? 'warning' : null;
}
