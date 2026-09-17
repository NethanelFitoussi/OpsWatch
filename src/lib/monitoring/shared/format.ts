import type { TimeRange } from './time-range';

export type MetricUnit = 'percent' | 'count' | 'rate' | 'bytes' | 'seconds' | 'milliseconds';
export const NO_VALUE = '—';

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
/** AWS reports instance memory in GiB and FreeableMemory in bytes; this is what converts one into the other. */
export const GIB = 1024 ** 3;

function unit(locale: string, name: string, value: number, digits: number): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit: name, maximumFractionDigits: digits }).format(value);
}

/** AWS units: CPU in percent (0–100), FreeableMemory in bytes (shown 1024-based), latencies in seconds, replica lag in ms. */
export function formatMetricValue(value: number | null | undefined, metricUnit: MetricUnit, locale: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  switch (metricUnit) {
    case 'percent':
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
    case 'count':
      return Math.abs(value) >= 10_000
        ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
        : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
    case 'rate':
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
    case 'bytes': {
      let index = 0;
      let scaled = value;
      while (Math.abs(scaled) >= 1024 && index < BYTE_UNITS.length - 1) {
        scaled /= 1024;
        index += 1;
      }
      return unit(locale, BYTE_UNITS[index], scaled, 1);
    }
    case 'seconds':
      return Math.abs(value) < 1 ? unit(locale, 'millisecond', value * 1000, 0) : unit(locale, 'second', value, 2);
    case 'milliseconds':
      return Math.abs(value) >= 1000 ? unit(locale, 'second', value / 1000, 2) : unit(locale, 'millisecond', value, 0);
  }
}

export function formatAxisTime(timestamp: number, range: TimeRange, locale: string, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions =
    range === '7d' ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, { ...options, ...(timeZone ? { timeZone } : {}) }).format(timestamp);
}
