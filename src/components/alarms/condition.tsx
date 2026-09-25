import type { MetricShape } from '@/lib/monitoring/shared/metric-catalogue';

/**
 * The condition, written the way somebody would say it.
 *
 * `≥ 64` is a number without a unit; `CPU reservation ≥ 64%` is a sentence. The shape comes from the
 * metric catalogue, so a percentage gets its sign and a count does not get one it has no business with.
 *
 * Shared by the row and the detail, so the two can never print the condition differently.
 */
export function conditionText(input: {
  metric: string | null;
  comparison: string | null;
  threshold: number;
  shape: MetricShape;
}): string {
  const suffix = { percent: '%', seconds: ' s', milliseconds: ' ms', bytes: ' B', count: '', plain: '' }[input.shape];
  const value = `${input.comparison ?? ''} ${input.threshold}${suffix}`.trim();
  return input.metric === null ? value : `${input.metric} ${value}`;
}

/** Kept here as the name the alarm components have always used; the list itself lives with the catalogue. */
export { RESOURCE_DIMENSIONS as RESOURCE_DIMENSION_FALLBACK } from '@/lib/monitoring/shared/metric-catalogue';
