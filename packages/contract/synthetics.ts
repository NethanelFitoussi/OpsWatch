/**
 * Synthetic checks: what OpsWatch probes from outside, and what it saw.
 */
import { z } from 'zod';
import { epochSchema, idSchema, lenientEnum, nullableNumberSchema, refSchema, seriesSchema } from './primitives';

export const SYNTHETIC_STATUSES = ['up', 'down', 'degraded', 'unknown'] as const;
export type SyntheticStatus = (typeof SYNTHETIC_STATUSES)[number];

export const syntheticSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: z.string(),
  target: z.string(),
  status: lenientEnum(SYNTHETIC_STATUSES, 'unknown'),
  /** Fractions between 0 and 1. */
  availability24h: nullableNumberSchema.default(null),
  uptime30d: nullableNumberSchema.default(null),
  latencyMs: nullableNumberSchema.default(null),
  ssl: z
    .object({ valid: z.boolean().nullable(), expiresAt: epochSchema.nullable(), issuer: z.string().optional() })
    .nullable()
    .default(null),
  lastCheckedAt: epochSchema.nullable(),
});
export type SyntheticSummary = z.infer<typeof syntheticSummarySchema>;

export const syntheticDetailSchema = syntheticSummarySchema.extend({
  latency: seriesSchema.optional(),
  /** One bucket per period, `up: null` when no check ran. */
  availability: z.array(z.object({ at: epochSchema, up: z.boolean().nullable() })).default([]),
  failures: z
    .array(z.object({ at: epochSchema, reason: z.string(), statusCode: z.number().int().optional(), location: z.string().optional() }))
    .default([]),
  problem: refSchema.optional(),
});
export type SyntheticDetail = z.infer<typeof syntheticDetailSchema>;
