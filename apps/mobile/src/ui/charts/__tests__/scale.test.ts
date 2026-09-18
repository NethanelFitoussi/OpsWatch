import { areaPath, domainOf, downsample, linePath, nearestIndex, summary, type Point } from '../scale';

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
