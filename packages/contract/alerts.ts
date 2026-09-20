/**
 * Alerts: a rule that fired, whoever owns the rule.
 */
import { z } from 'zod';
import { allowedActionsSchema, epochSchema, idSchema, lenientEnum, refSchema, seriesSchema, severitySchema } from './primitives';

export const ALERT_STATUSES = ['firing', 'acknowledged', 'resolved', 'insufficient_data'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const alertSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  severity: severitySchema,
  status: lenientEnum(ALERT_STATUSES, 'insufficient_data'),
  source: z.string(),
  reason: z.string().optional(),
  since: epochSchema.nullable(),
  service: refSchema.optional(),
  problemId: idSchema.optional(),
  incidentId: idSchema.optional(),
});
export type AlertSummary = z.infer<typeof alertSummarySchema>;

export const alertDetailSchema = alertSummarySchema.extend({
  description: z.string().optional(),
  condition: z.string().optional(),
  metric: seriesSchema.optional(),
  history: z.array(z.object({ at: epochSchema, status: z.string(), reason: z.string().optional() })).default([]),
  acknowledgedBy: z.string().optional(),
  acknowledgedAt: epochSchema.optional(),
  allowedActions: allowedActionsSchema,
});
export type AlertDetail = z.infer<typeof alertDetailSchema>;
