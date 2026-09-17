import { isOneOf } from '@/lib/type-guards';

export const TIME_RANGES = ['1h', '3h', '12h', '24h', '7d'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];
export const DEFAULT_TIME_RANGE: TimeRange = '3h';

export const RANGE_SECONDS: Record<TimeRange, number> = { '1h': 3600, '3h': 10_800, '12h': 43_200, '24h': 86_400, '7d': 604_800 };
const PERIOD_SECONDS: Record<TimeRange, number> = { '1h': 60, '3h': 60, '12h': 300, '24h': 300, '7d': 3600 };

export function periodForRange(range: TimeRange): number {
  return PERIOD_SECONDS[range];
}

export function parseTimeRange(value: string | string[] | undefined): TimeRange {
  const first = Array.isArray(value) ? value[0] : value;
  return isOneOf(TIME_RANGES, first) ? first : DEFAULT_TIME_RANGE;
}

export type TimeWindow = { start: Date; end: Date; periodSeconds: number };

const MINUTE_MS = 60_000;
const floorToMinute = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

/** The window of a page range, ending at the current whole minute. */
export function timeWindow(range: TimeRange, nowMs: number): TimeWindow {
  const end = floorToMinute(nowMs);
  return { start: new Date(end - RANGE_SECONDS[range] * 1000), end: new Date(end), periodSeconds: periodForRange(range) };
}

/** The window of a page range ending at the current minute. Server components render once per request, so reading the clock there is safe. */
export function currentWindow(range: TimeRange): TimeWindow {
  return timeWindow(range, Date.now());
}

/** The last `minutes` whole minutes, used by the Overview insights. */
export function recentWindow(minutes: number, nowMs: number, periodSeconds = 60): TimeWindow {
  const end = floorToMinute(nowMs);
  return { start: new Date(end - minutes * MINUTE_MS), end: new Date(end), periodSeconds };
}
