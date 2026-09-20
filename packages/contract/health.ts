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
  /** When it happened, so a brief can be read in order rather than only grouped. */
  at: epochSchema.optional(),
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
  /**
   * Present when the server could not read this family (missing permission, throttling, error).
   *
   * `reason` and `code` are for logic. The sentence is returned **twice** (§12.2): `messageKey` + `values` for
   * a client that holds the catalogue and renders in its own locale, and `message` already rendered in the
   * caller's locale for one that does not. This is the most trust-relevant line on the first screen, so it
   * says what cannot be read and why, in OpsWatch's own words — never a provider's raw error text, which is
   * unbounded, untranslated and occasionally carries an account identifier.
   */
  unavailable: z
    .object({
      reason: z.string(),
      code: z.string().optional(),
      messageKey: z.string().optional(),
      values: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      message: z.string().optional(),
    })
    .optional(),
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
