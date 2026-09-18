// Threshold bands and fixed value bands that dense components (charts, cell shading) colour by. Client-safe:
// no AWS, zod, Node, database, server-only or next-intl/server import.

import type { Tone } from '@/lib/ui/tones';

export type ThresholdLevels = { warning: number; critical?: number; direction: 'above' | 'below' };
export type ThresholdBand = { from: number; to: number | null; tone: Tone };

export function bandsFor(levels: ThresholdLevels, max: number | null): ThresholdBand[] {
  if (levels.direction === 'below') {
    return [
      { from: 0, to: levels.warning, tone: 'warning' },
      { from: levels.warning, to: max, tone: 'success' },
    ];
  }
  const bands: ThresholdBand[] = [{ from: 0, to: levels.warning, tone: 'success' }];
  if (levels.critical === undefined) return [...bands, { from: levels.warning, to: max, tone: 'warning' }];
  return [...bands, { from: levels.warning, to: levels.critical, tone: 'warning' }, { from: levels.critical, to: max, tone: 'danger' }];
}

/** Exclusive at the threshold, exactly like `breachActive` in evaluate.ts, so a chart band and a rule agree. */
export function toneForValue(value: number | null, levels: ThresholdLevels): Tone | null {
  if (value === null || !Number.isFinite(value)) return null;
  const past = (t: number) => (levels.direction === 'above' ? value > t : value < t);
  if (levels.critical !== undefined && past(levels.critical)) return 'danger';
  return past(levels.warning) ? 'warning' : 'success';
}

export const CPU_BANDS = [10, 50, 85] as const;
const CPU_BAND_NAMES = ['idle', 'low', 'medium', 'high'] as const;

export function cpuBand(value: number | null): 'unknown' | 'idle' | 'low' | 'medium' | 'high' {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  let index = 0;
  for (const threshold of CPU_BANDS) {
    if (value >= threshold) index += 1;
  }
  return CPU_BAND_NAMES[index];
}

export const VOLUME_BANDS = [1_048_576, 1_073_741_824, 10_737_418_240] as const;
const VOLUME_BAND_NAMES = ['tiny', 'small', 'large', 'huge'] as const;

export function volumeBand(bytes: number | null): 'unknown' | 'tiny' | 'small' | 'large' | 'huge' {
  if (bytes === null || !Number.isFinite(bytes)) return 'unknown';
  let index = 0;
  for (const threshold of VOLUME_BANDS) {
    if (bytes >= threshold) index += 1;
  }
  return VOLUME_BAND_NAMES[index];
}
