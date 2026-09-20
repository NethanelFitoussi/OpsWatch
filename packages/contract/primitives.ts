/**
 * The vocabulary every domain of the contract is built from.
 *
 * Seeded from `apps/mobile/src/api/contract.ts` (the mobile agent's file, which is the source of truth field by
 * field). The helpers below were module-private there; they are exported here because the contract is split by
 * domain. Nothing was renamed or removed.
 */
import { z } from 'zod';

/**
 * An enum that tolerates values added by a newer server, mapping them to `fallback`.
 *
 * The `meta` is what the generated OpenAPI document shows: a transform has no JSON Schema of its own, and without it
 * the generator would refuse the schema rather than describe the enum the transform accepts.
 */
export function lenientEnum<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z
    .string()
    .transform((value): T[number] => ((values as readonly string[]).includes(value) ? (value as T[number]) : fallback))
    .meta({ type: 'string', enum: [...values] });
}

export const idSchema = z.string().min(1).max(200);
/** Every time in the contract is epoch milliseconds. */
export const epochSchema = z.number().finite();
/** A metric the server could not measure is `null`, never `0`. */
export const nullableNumberSchema = z.number().finite().nullable();
/** The actions the server authorises on an object for the calling actor. Convenience, never security. */
export const allowedActionsSchema = z.array(z.string()).default([]);

export const SEVERITIES = ['critical', 'warning', 'info'] as const;
export const severitySchema = lenientEnum(SEVERITIES, 'info');
export type Severity = (typeof SEVERITIES)[number];

export const HEALTH_STATUSES = ['healthy', 'degraded', 'critical', 'unknown'] as const;
export const healthStatusSchema = lenientEnum(HEALTH_STATUSES, 'unknown');
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const REF_TYPES = [
  'problem',
  'error',
  'service',
  'alert',
  'incident',
  'synthetic',
  'slo',
  'deployment',
  'infrastructure',
  'investigation',
  'evidence',
  'log',
  'environment',
] as const;
export type RefType = (typeof REF_TYPES)[number];
export const refTypeSchema = z.enum(REF_TYPES);

/** A typed pointer to another OpsWatch object. The app turns it into a route through the deep-link allow-list. */
export const refSchema = z.object({ type: refTypeSchema, id: idSchema, label: z.string().optional() });
export type Ref = z.infer<typeof refSchema>;

export const METRIC_UNITS = ['percent', 'ms', 'seconds', 'count', 'per_minute', 'per_second', 'bytes', 'ratio', 'none'] as const;
export const metricUnitSchema = lenientEnum(METRIC_UNITS, 'none');
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const metricValueSchema = z.object({
  value: nullableNumberSchema,
  unit: metricUnitSchema,
  status: lenientEnum(['ok', 'warning', 'critical', 'unknown'] as const, 'unknown').nullable().default(null),
});
export type MetricValue = z.infer<typeof metricValueSchema>;

/** A time series as compact `[time, value]` pairs. A `null` value is a gap, not a zero. */
export const seriesSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  unit: metricUnitSchema,
  points: z.array(z.tuple([epochSchema, nullableNumberSchema])),
  thresholds: z.object({ warning: z.number().optional(), critical: z.number().optional() }).optional(),
});
export type Series = z.infer<typeof seriesSchema>;
