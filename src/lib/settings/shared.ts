import { AUTO_REFRESH_MS } from '../monitoring/shared/refresh-timer';
import { DEFAULT_TIME_RANGE, type TimeRange } from '../monitoring/shared/time-range';

/**
 * The settings of the instance, as every page reads them. Client-safe: the Settings form, the section
 * header and the auto-refresh control all use these, so nothing here touches zod, the database or AWS.
 */
export type AppSettings = { refreshIntervalMs: number; defaultRange: TimeRange };

/** The refresh intervals the Settings page offers, in order. `0` turns auto-refresh off. */
export const REFRESH_INTERVALS_MS = [0, 30_000, 60_000, 120_000, 300_000, 600_000] as const;

/** What OpsWatch did before the Settings page existed, so an instance that never opens it is unchanged. */
export const DEFAULT_SETTINGS: AppSettings = { refreshIntervalMs: AUTO_REFRESH_MS, defaultRange: DEFAULT_TIME_RANGE };

/**
 * The figures of the README's "What monitoring costs": `cloudwatch:GetMetricData` is billed per metric
 * requested, about USD 0.01 per 1,000 metrics, and a Containers list of an account with about thirty
 * services asks for two metrics per service (CPU and memory) on every refresh. The Settings page states
 * the cost from these numbers rather than from a sentence someone has to keep up to date.
 */
export const COST_SERVICES = 30;
const COST_METRICS_PER_SERVICE = 2;
/** USD 0.01 per 1,000 metrics, written as metrics per dollar so the division stays exact in binary. */
const METRICS_PER_USD = 100_000;
const HOUR_MS = 3_600_000;

/** What one such page costs per hour at this interval. Off costs nothing beyond the first page load. */
export function refreshCostPerHour(intervalMs: number): { refreshesPerHour: number; metricsPerHour: number; usdPerHour: number } {
  if (intervalMs <= 0) return { refreshesPerHour: 0, metricsPerHour: 0, usdPerHour: 0 };
  const refreshesPerHour = HOUR_MS / intervalMs;
  const metricsPerHour = refreshesPerHour * COST_SERVICES * COST_METRICS_PER_SERVICE;
  return { refreshesPerHour, metricsPerHour, usdPerHour: metricsPerHour / METRICS_PER_USD };
}
