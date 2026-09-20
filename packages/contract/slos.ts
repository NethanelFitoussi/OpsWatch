/**
 * Service level objectives and what is left of their error budget.
 */
import { z } from 'zod';
import { idSchema, lenientEnum, nullableNumberSchema, refSchema, seriesSchema } from './primitives';

export const SLO_STATUSES = ['healthy', 'at_risk', 'breached', 'unknown'] as const;
export type SloStatus = (typeof SLO_STATUSES)[number];

export const sloSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  service: refSchema.optional(),
  /** Fractions: 0.999 is 99.9 %. */
  target: z.number(),
  current: nullableNumberSchema,
  window: z.string(),
  /** Fraction of the error budget left; negative when the budget is exhausted. */
  budgetRemaining: nullableNumberSchema,
  burnRate: nullableNumberSchema.default(null),
  status: lenientEnum(SLO_STATUSES, 'unknown'),
});
export type SloSummary = z.infer<typeof sloSummarySchema>;

export const sloDetailSchema = sloSummarySchema.extend({
  description: z.string().optional(),
  performance: seriesSchema.optional(),
  budget: seriesSchema.optional(),
});
export type SloDetail = z.infer<typeof sloDetailSchema>;
