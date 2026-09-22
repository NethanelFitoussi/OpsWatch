import { areaPath, domainOf, downsample, extent, linePath, nearestIndex, summary, thresholdsInScale, timeAxisFormat, type Point } from '../scale';

const points: Point[] = [
  [0, 1],
  [10, null],
  [20, 3],
  [30, 2],
];

it('draws gaps for null values instead of dropping to zero', () => {
  const d = domainOf(points)!;
  const path = linePath(points, d, 100, 50);
  expect(path.match(/M/g)).toHaveLength(2);
  expect(areaPath(points, d, 100, 50).match(/Z/g)).toHaveLength(2);
});

it('has no domain when there is no value at all', () => {
  expect(domainOf([[0, null]])).toBeNull();
  expect(summary([[0, null]])).toEqual({ latest: null, min: null, max: null });
});

it('includes thresholds in the domain and centres flat lines', () => {
  expect(domainOf(points, [10])!.maxY).toBeGreaterThanOrEqual(10);
  const flat = domainOf([[0, 5], [1, 5]])!;
  expect(flat.minY).toBeLessThan(5);
  expect(flat.maxY).toBeGreaterThan(5);
});

it('finds the nearest measured point, skipping gaps', () => {
  const d = domainOf(points)!;
  expect(nearestIndex(points, d, 100, 34)).toBe(2);
  expect(summary(points)).toEqual({ latest: 2, min: 1, max: 3 });
});

it('downsamples long series while keeping extremes', () => {
  const long: Point[] = Array.from({ length: 1000 }, (_, i) => [i, i === 500 ? 99 : 1]);
  const out = downsample(long, 100);
  expect(out.length).toBeLessThanOrEqual(110);
  expect(out.some((p) => p[1] === 99)).toBe(true);
});

describe('thresholdsInScale', () => {
  const quiet: Point[] = Array.from({ length: 10 }, (_, i) => [i, 0.2]);
  it('keeps a threshold the data can be read against', () => {
    expect(thresholdsInScale(quiet, { warning: 1 })).toEqual({ inScale: [1], offScale: [] });
  });
  it('drops one so far away it would flatten the line', () => {
    // 0.2 % against a 5 % critical line: drawing it would squash the series into the axis.
    expect(thresholdsInScale(quiet, { critical: 500 })).toEqual({ inScale: [], offScale: [500] });
  });
  it('says nothing when there is no data or no threshold', () => {
    expect(thresholdsInScale([[0, null]], { warning: 1 })).toEqual({ inScale: [], offScale: [1] });
    expect(thresholdsInScale(quiet, undefined)).toEqual({ inScale: [], offScale: [] });
  });
});

describe('timeAxisFormat', () => {
  const hour = 3_600_000;
  it('uses a clock for a short range and adds the date when it would be ambiguous', () => {
    expect(timeAxisFormat(0, 6 * hour)).toBe('time');
    expect(timeAxisFormat(0, 24 * hour)).toBe('time');
    expect(timeAxisFormat(0, 48 * hour)).toBe('dateTime');
    expect(timeAxisFormat(0, 30 * 24 * hour)).toBe('date');
  });
});

describe('extent', () => {
  it('folds rather than spreads, and says nothing about an empty list', () => {
    expect(extent([3, -1, 7])).toEqual({ min: -1, max: 7 });
    expect(extent([])).toBeNull();
  });
});

describe('large series', () => {
  it('summarises a series far larger than the argument limit', () => {
    // `Math.min(...values)` throws above ~100k arguments, and a server decides how many points it sends.
    const huge: Point[] = Array.from({ length: 300_000 }, (_, i) => [i, i === 1234 ? -5 : 1]);
    expect(() => summary(huge)).not.toThrow();
    expect(summary(huge)).toEqual({ latest: 1, min: -5, max: 1 });
    expect(() => domainOf(huge)).not.toThrow();
    expect(() => thresholdsInScale(huge, { warning: 2 })).not.toThrow();
  });
});
