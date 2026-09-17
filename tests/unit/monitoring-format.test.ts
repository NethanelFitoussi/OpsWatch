import { describe, expect, it } from 'vitest';
import { mergeSeriesRows } from '@/lib/monitoring/shared/chart-data';
import { formatAxisTime, formatMetricValue } from '@/lib/monitoring/shared/format';
import { sparklinePoints } from '@/lib/monitoring/shared/sparkline';

describe('formatMetricValue', () => {
  it('formats each unit in English and French', () => {
    expect(formatMetricValue(12.5, 'percent', 'en')).toBe('12.5%');
    expect(formatMetricValue(12.5, 'percent', 'fr')).toBe('12,5 %');
    expect(formatMetricValue(842, 'count', 'en')).toBe('842');
    expect(formatMetricValue(12_345, 'count', 'en')).toBe('12.3K');
    expect(formatMetricValue(12_345, 'count', 'fr')).toBe('12,3 k');
    expect(formatMetricValue(40.25, 'rate', 'en')).toBe('40.3');
    expect(formatMetricValue(3 * 1024 ** 3, 'bytes', 'en')).toBe('3 GB');
    expect(formatMetricValue(3 * 1024 ** 3, 'bytes', 'fr')).toBe('3 Go');
    expect(formatMetricValue(512 * 1024 ** 2, 'bytes', 'en')).toBe('512 MB');
    expect(formatMetricValue(0.12, 'seconds', 'en')).toBe('120 ms');
    expect(formatMetricValue(1.5, 'seconds', 'fr')).toBe('1,5 s');
    expect(formatMetricValue(120, 'milliseconds', 'fr')).toBe('120 ms');
    expect(formatMetricValue(1500, 'milliseconds', 'en')).toBe('1.5 sec');
    expect(formatMetricValue(null, 'percent', 'en')).toBe('—');
    expect(formatMetricValue(Number.NaN, 'count', 'en')).toBe('—');
  });

  it('formats chart axis times per range', () => {
    const t = Date.parse('2026-09-17T14:05:00Z');
    expect(formatAxisTime(t, '3h', 'en', 'UTC')).toBe('02:05 PM');
    expect(formatAxisTime(t, '3h', 'fr', 'UTC')).toBe('14:05');
    expect(formatAxisTime(t, '7d', 'fr', 'UTC')).toBe('jeu. 14:05');
  });
});

describe('chart rows and sparklines', () => {
  it('merges series on their timestamps', () => {
    expect(mergeSeriesRows([{ timestamps: [1, 2], values: [10, 20] }, { timestamps: [2, 3], values: [5, 6] }])).toEqual([
      { t: 1, s0: 10, s1: null },
      { t: 2, s0: 20, s1: 5 },
      { t: 3, s0: null, s1: 6 },
    ]);
    expect(mergeSeriesRows([])).toEqual([]);
  });

  it('draws sparkline points from zero to the max', () => {
    expect(sparklinePoints([0, 50, 100], 80, 24)).toBe('0,24 40,12 80,0');
    expect(sparklinePoints([0, 50, 100], 80, 24, 200)).toBe('0,24 40,18 80,12');
    expect(sparklinePoints([5], 80, 24)).toBe('0,0 80,0');
    expect(sparklinePoints([0, 0], 80, 24)).toBe('0,24 80,24');
    expect(sparklinePoints([], 80, 24)).toBe('');
  });
});
