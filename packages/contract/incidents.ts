/**
 * Incidents: the human-declared umbrella over one or more problems, with the timeline and the notes.
 */
import { z } from 'zod';
import { allowedActionsSchema, epochSchema, idSchema, lenientEnum, refSchema, severitySchema } from './primitives';
import { problemSummarySchema } from './problems';

export const INCIDENT_STATUSES = ['open', 'investigating', 'mitigated', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const incidentSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  severity: severitySchema,
  status: lenientEnum(INCIDENT_STATUSES, 'open'),
  startedAt: epochSchema,
  resolvedAt: epochSchema.nullable().default(null),
  affectedServices: z.array(refSchema).default([]),
});
export type IncidentSummary = z.infer<typeof incidentSummarySchema>;

export const incidentDetailSchema = incidentSummarySchema.extend({
  summary: z.string().optional(),
  timeline: z.array(z.object({ at: epochSchema, type: z.string(), text: z.string(), ref: refSchema.optional() })).default([]),
  problems: z.array(problemSummarySchema).default([]),
  notes: z.array(z.object({ at: epochSchema, author: z.string().optional(), text: z.string() })).default([]),
  resolution: z.string().optional(),
  allowedActions: allowedActionsSchema,
});
export type IncidentDetail = z.infer<typeof incidentDetailSchema>;
