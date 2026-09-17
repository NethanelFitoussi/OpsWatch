import 'server-only';

const BURSTABLE: Record<string, number> = { micro: 1, small: 2, medium: 4, large: 8, xlarge: 16, '2xlarge': 32 };
const SIZE_UNITS: Record<string, number> = { large: 1, xlarge: 2, '2xlarge': 4, '4xlarge': 8, '8xlarge': 16, '12xlarge': 24, '16xlarge': 32, '24xlarge': 48 };
const GIB_PER_LARGE: Record<string, number> = {
  r5: 16, r6g: 16, r6gd: 16, r6i: 16, r7g: 16, r7i: 16, r8g: 16,
  m5: 8, m6g: 8, m6gd: 8, m6i: 8, m7g: 8, m7i: 8, m8g: 8,
};

/** Memory of common RDS classes. Unknown classes (serverless, x2, metal…) return null and memory rules skip them. */
export function instanceMemoryGiB(instanceClass: string): number | null {
  const match = /^db\.([a-z0-9]+)\.([a-z0-9]+)$/.exec(instanceClass);
  if (!match) return null;
  const [, family, size] = match;
  if (family === 't3' || family === 't4g') return BURSTABLE[size] ?? null;
  const perLarge = GIB_PER_LARGE[family];
  const units = SIZE_UNITS[size];
  return perLarge && units ? perLarge * units : null;
}
