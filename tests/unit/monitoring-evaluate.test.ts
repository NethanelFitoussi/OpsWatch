import { describe, expect, it } from 'vitest';
import { MIN_CONSECUTIVE, average, breachActive, sliceSince, sum, thresholdLevel, type Level, type Levels } from '@/lib/monitoring/evaluate';

const NOW = Date.parse('2026-09-17T10:00:00Z');
/** A 1-minute series whose last datapoint is at NOW. */
const series = (values: number[]) => ({ timestamps: values.map((_, i) => NOW - (values.length - 1 - i) * 60_000), values });
const repeat = (value: number, n: number) => Array.from({ length: n }, () => value);

describe('breachActive', () => {
  const warn: Level = { threshold: 85, clearAt: 80 };
  it.each([
    [[86, 86, 86], true],
    [[86, 86], false],
    [[86, 84, 86, 86], false],
    [[86, 86, 86, 82, 83], true],
    [[86, 86, 86, 80], false],
    [[86, 86, 86, 79, 86, 86], false],
    [[], false],
  ])('above 85, clearing at 80: %j → %s', (values, expected) => {
    expect(breachActive(values, warn, 'above')).toBe(expected);
  });

  it('works downwards', () => {
    const low: Level = { threshold: 5, clearAt: 10 };
    expect(breachActive([4, 4, 4], low, 'below')).toBe(true);
    expect(breachActive([4, 4, 4, 9], low, 'below')).toBe(true);
    expect(breachActive([4, 4, 4, 10], low, 'below')).toBe(false);
  });

  it('needs a run of MIN_CONSECUTIVE datapoints to start firing', () => {
    expect(breachActive(repeat(86, MIN_CONSECUTIVE), warn, 'above')).toBe(true);
    expect(breachActive(repeat(86, MIN_CONSECUTIVE - 1), warn, 'above')).toBe(false);
  });
});

describe('thresholdLevel', () => {
  const levels: Levels = { warning: { threshold: 85, clearAt: 80 }, critical: { threshold: 95, clearAt: 90 } };
  it('needs both the average and a held breach', () => {
    expect(thresholdLevel(series(repeat(86, 15)), levels, 'above')).toBe('warning');
    expect(thresholdLevel(series(repeat(96, 15)), levels, 'above')).toBe('critical');
    expect(thresholdLevel(series(repeat(85, 15)), levels, 'above')).toBeNull();
    expect(thresholdLevel(series([...repeat(84, 12), 99, 99, 99]), levels, 'above')).toBe('warning');
    expect(thresholdLevel(series([...repeat(90, 12), 79, 79, 79]), levels, 'above')).toBeNull();
    expect(thresholdLevel(series([...repeat(50, 12), 99, 99, 99]), levels, 'above')).toBeNull();
    expect(thresholdLevel(series([]), levels, 'above')).toBeNull();
  });

  it('slices the evaluation window by time', () => {
    const old = series([...repeat(99, 20), ...repeat(50, 15)]);
    expect(thresholdLevel(sliceSince(old, NOW - 15 * 60_000), levels, 'above')).toBeNull();
    expect(sliceSince(series([1, 2, 3]), NOW - 60_000).values).toEqual([2, 3]);
    expect(average([1, 2, 3])).toBe(2);
    expect(average([])).toBeNull();
    expect(sum([1, 2, 3])).toBe(6);
  });
});
