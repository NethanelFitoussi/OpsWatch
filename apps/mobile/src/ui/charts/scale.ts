/**
 * Pure chart maths, kept apart from rendering so it is unit-tested. `null` values are gaps in the line, never zeros.
 */
export type Point = readonly [number, number | null];

export type Domain = { minX: number; maxX: number; minY: number; maxY: number };

export function domainOf(points: readonly Point[], extraY: readonly number[] = [], opts: { zeroBased?: boolean } = {}): Domain | null {
  const values = points.map((p) => p[1]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (points.length === 0 || values.length === 0) return null;
  const ys = [...values, ...extraY];
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (opts.zeroBased !== false && minY >= 0) minY = 0;
  if (minY === maxY) {
    // A flat line sits in the middle rather than on the edge.
    const pad = Math.abs(maxY) * 0.1 || 1;
    minY -= pad;
    maxY += pad;
  } else {
    maxY += (maxY - minY) * 0.08;
  }
  return { minX: points[0]![0], maxX: points[points.length - 1]![0], minY, maxY };
}

export function scaleX(x: number, d: Domain, width: number): number {
  return d.maxX === d.minX ? width / 2 : ((x - d.minX) / (d.maxX - d.minX)) * width;
}

export function scaleY(y: number, d: Domain, height: number): number {
  return height - ((y - d.minY) / (d.maxY - d.minY)) * height;
}

/** An SVG path with a new sub-path after every gap. */
export function linePath(points: readonly Point[], d: Domain, width: number, height: number): string {
  let path = '';
  let drawing = false;
  for (const [x, y] of points) {
    if (y === null || !Number.isFinite(y)) {
      drawing = false;
      continue;
    }
    const px = scaleX(x, d, width).toFixed(1);
    const py = scaleY(y, d, height).toFixed(1);
    path += `${drawing ? 'L' : 'M'}${px},${py}`;
    drawing = true;
  }
  return path;
}

/** Closed area paths under each continuous run of values. */
export function areaPath(points: readonly Point[], d: Domain, width: number, height: number): string {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p[1] === null || !Number.isFinite(p[1])) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length) runs.push(run);
  const base = scaleY(Math.max(d.minY, 0), d, height).toFixed(1);
  return runs
    .map((r) => {
      const line = linePath(r, d, width, height);
      const first = scaleX(r[0]![0], d, width).toFixed(1);
      const last = scaleX(r[r.length - 1]![0], d, width).toFixed(1);
      return `${line}L${last},${base}L${first},${base}Z`;
    })
    .join('');
}

/** Index of the point closest to a touch at `px` along the x axis, skipping gaps. */
export function nearestIndex(points: readonly Point[], d: Domain, width: number, px: number): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  points.forEach(([x, y], i) => {
    if (y === null) return;
    const distance = Math.abs(scaleX(x, d, width) - px);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

/**
 * Which thresholds belong on the chart. A threshold far outside the data would flatten the line it is meant to give
 * context to (a 5 % critical line against a series that never leaves 0.2 %), so it is left off the scale and named in
 * the caption instead.
 */
export function thresholdsInScale(
  points: readonly Point[],
  thresholds: { warning?: number; critical?: number } | undefined,
): { inScale: number[]; offScale: number[] } {
  const values = points.map((p) => p[1]).filter((v): v is number => v !== null && Number.isFinite(v));
  const wanted = [thresholds?.warning, thresholds?.critical].filter((v): v is number => v !== undefined);
  if (!values.length || !wanted.length) return { inScale: [], offScale: wanted };
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const headroom = Math.max(max - min, Math.abs(max) * 0.1, 1) * 2;
  const inScale = wanted.filter((v) => v <= max + headroom && v >= min - headroom);
  return { inScale, offScale: wanted.filter((v) => !inScale.includes(v)) };
}

/**
 * How to label a time axis. `HH:MM` is ambiguous as soon as a range covers more than a day, so longer spans carry
 * the date as well.
 */
export function timeAxisFormat(fromMs: number, toMs: number): 'time' | 'dateTime' | 'date' {
  const span = Math.abs(toMs - fromMs);
  if (span > 7 * 86_400_000) return 'date';
  if (span > 36 * 3_600_000) return 'dateTime';
  return 'time';
}

export function summary(points: readonly Point[]): { latest: number | null; min: number | null; max: number | null } {
  const values = points.map((p) => p[1]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (!values.length) return { latest: null, min: null, max: null };
  let latest: number | null = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const v = points[i]![1];
    if (v !== null) {
      latest = v;
      break;
    }
  }
  return { latest, min: Math.min(...values), max: Math.max(...values) };
}

/** Keeps at most `max` points (min/max-preserving buckets), so long series render cheaply. */
export function downsample(points: readonly Point[], max: number): Point[] {
  if (points.length <= max) return [...points];
  const bucket = Math.ceil(points.length / (max / 2));
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += bucket) {
    const slice = points.slice(i, i + bucket);
    const valued = slice.filter((p) => p[1] !== null);
    if (!valued.length) {
      out.push([slice[0]![0], null]);
      continue;
    }
    let lo = valued[0]!;
    let hi = valued[0]!;
    for (const p of valued) {
      if (p[1]! < lo[1]!) lo = p;
      if (p[1]! > hi[1]!) hi = p;
    }
    out.push(...(lo[0] <= hi[0] ? [lo, hi] : [hi, lo]).filter((p, j, arr) => j === 0 || p !== arr[0]));
  }
  return out;
}
