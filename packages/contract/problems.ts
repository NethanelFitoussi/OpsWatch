/**
 * Problems, the evidence behind them, and the investigation that gathered it.
 *
 * A problem is the unit of attention: everything else in OpsWatch either feeds one or hangs off one.
 */
import { z } from 'zod';
import {
  allowedActionsSchema,
  epochSchema,
  idSchema,
  lenientEnum,
  nullableNumberSchema,
  refSchema,
  seriesSchema,
  severitySchema,
  trendSchema,
} from './primitives';
import { alertSummarySchema } from './alerts';
import { deploymentSummarySchema } from './deployments';
import { errorSummarySchema } from './errors';
import { repositoryEvidenceSchema } from './repository';

export const PROBLEM_STATUSES = ['new', 'active', 'acknowledged', 'resolved'] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export const problemSummarySchema = z.object({
  id: idSchema,
  /**
   * The dedupe key the detector assigned. Two sightings of the same trouble carry the same key, so a client can
   * recognise "this one again" across a restart without keeping the id.
   */
  key: z.string().optional(),
  title: z.string(),
  severity: severitySchema,
  /** The score behind `severity`, as an integer, for ordering within one severity band. */
  score: z.number().int().optional(),
  status: lenientEnum(PROBLEM_STATUSES, 'active'),
  category: z.string(),
  service: refSchema.optional(),
  resource: z.string().optional(),
  firstSeenAt: epochSchema,
  lastSeenAt: epochSchema,
  occurrences: nullableNumberSchema.default(null),
  trend: trendSchema,
  summary: z.string().optional(),
});
export type ProblemSummary = z.infer<typeof problemSummarySchema>;

export const EVIDENCE_KINDS = ['fact', 'correlation', 'hypothesis'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const evidenceSchema = z.object({
  id: idSchema,
  at: epochSchema,
  /** Observed fact, correlation between facts, or hypothesis. Screens keep the three visibly apart. */
  // An unknown kind from a newer server must never be presented as an observed fact.
  kind: lenientEnum(EVIDENCE_KINDS, 'hypothesis'),
  type: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  ref: refSchema.optional(),
  series: seriesSchema.optional(),
  confidence: lenientEnum(['low', 'medium', 'high'] as const, 'low').optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const problemDetailSchema = problemSummarySchema.extend({
  description: z.string().optional(),
  evidence: z.array(evidenceSchema).default([]),
  errors: z.array(errorSummarySchema).default([]),
  metrics: z.array(seriesSchema).default([]),
  /** Deployments that happened shortly before the problem started. Correlation, never a claim of causation. */
  deployments: z.array(z.object({ deployment: deploymentSummarySchema, minutesBeforeProblem: z.number() })).default([]),
  repository: z.array(repositoryEvidenceSchema).default([]),
  possibleCauses: z.array(evidenceSchema).default([]),
  alerts: z.array(alertSummarySchema).default([]),
  incident: refSchema.optional(),
  investigationId: idSchema.optional(),
  allowedActions: allowedActionsSchema,
});
export type ProblemDetail = z.infer<typeof problemDetailSchema>;

export const investigationSchema = z.object({
  id: idSchema,
  title: z.string(),
  subject: refSchema,
  status: lenientEnum(['open', 'concluded'] as const, 'open'),
  startedAt: epochSchema,
  /** When it ended, so a concluded investigation can say how long it took. Absent while it is still open. */
  concludedAt: epochSchema.optional(),
  summary: z.string().optional(),
  timeline: z.array(evidenceSchema),
});
export type Investigation = z.infer<typeof investigationSchema>;
