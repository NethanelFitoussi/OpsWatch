/**
 * The health of one environment, right now: the first screen anyone opens.
 *
 * A family the server could not read says so in `unavailable` rather than counting as healthy — an unreadable
 * family and a healthy one must never look the same.
 */
import { z } from 'zod';
import { epochSchema, healthStatusSchema, idSchema, lenientEnum, nullableNumberSchema, refSchema, severitySchema } from './primitives';
import { deploymentSummarySchema } from './deployments';
import { incidentSummarySchema } from './incidents';
import { problemSummarySchema } from './problems';

export const CHANGE_DIRECTIONS = ['up', 'down', 'new', 'resolved', 'stable'] as const;
export type ChangeDirection = (typeof CHANGE_DIRECTIONS)[number];

export const changeSchema = z.object({
  id: idSchema,
  direction: lenientEnum(CHANGE_DIRECTIONS, 'stable'),
  text: z.string(),
  severity: severitySchema.optional(),
  ref: refSchema.optional(),
});
export type Change = z.infer<typeof changeSchema>;

export const familySchema = z.object({
  family: z.string(),
  label: z.string(),
  status: healthStatusSchema,
  total: nullableNumberSchema,
  affected: nullableNumberSchema,
  /** Present when the server could not read this family (missing permission, throttling, error). */
  unavailable: z.object({ reason: z.string(), code: z.string().optional() }).optional(),
});
export type Family = z.infer<typeof familySchema>;

export const healthCountsSchema = z.object({
  critical: z.number(),
  warning: z.number(),
  healthyServices: nullableNumberSchema,
  totalServices: nullableNumberSchema,
});
export type HealthCounts = z.infer<typeof healthCountsSchema>;

export const healthSchema = z.object({
  generatedAt: epochSchema,
  status: healthStatusSchema,
  headline: z.string().optional(),
  counts: healthCountsSchema,
  families: z.array(familySchema).default([]),
  topProblem: problemSummarySchema.nullable().default(null),
  activeAlerts: nullableNumberSchema.default(null),
  synthetics: z.object({ up: z.number(), down: z.number(), degraded: z.number() }).nullable().default(null),
  recentIncidents: z.array(incidentSummarySchema).default([]),
  recentDeployments: z.array(deploymentSummarySchema).default([]),
  changes: z.array(changeSchema).default([]),
});
export type Health = z.infer<typeof healthSchema>;
