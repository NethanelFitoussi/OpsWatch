/**
 * Services and the infrastructure underneath them.
 *
 * A service is what the operator cares about; a resource is what AWS bills for. The dependency map hangs off the
 * service detail, so a screen can walk from "checkout is slow" to the database it waits on.
 */
import { z } from 'zod';
import {
  allowedActionsSchema,
  healthStatusSchema,
  idSchema,
  lenientEnum,
  metricValueSchema,
  nullableNumberSchema,
  refSchema,
  seriesSchema,
} from './primitives';
import { alertSummarySchema } from './alerts';
import { deploymentSummarySchema } from './deployments';
import { problemSummarySchema } from './problems';

export const serviceSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: z.string().optional(),
  health: healthStatusSchema,
  errorRate: metricValueSchema,
  latencyP95: metricValueSchema,
  requests: metricValueSchema,
  openProblems: nullableNumberSchema.default(null),
  firingAlerts: nullableNumberSchema.default(null),
});
export type ServiceSummary = z.infer<typeof serviceSummarySchema>;

export const INFRA_CATEGORIES = ['ecs', 'ec2', 'rds', 'redis', 'load-balancer', 'storage', 'network', 'other'] as const;
export type InfraCategory = (typeof INFRA_CATEGORIES)[number];

export const infraResourceSchema = z.object({
  id: idSchema,
  name: z.string(),
  category: lenientEnum(INFRA_CATEGORIES, 'other'),
  health: healthStatusSchema,
  /** The provider's own status word (for example `available`, `ACTIVE`), shown as is. */
  status: z.string().optional(),
  summary: z.string().optional(),
  keyMetrics: z.array(z.object({ label: z.string(), value: metricValueSchema })).default([]),
  anomalies: z.array(z.string()).default([]),
});
export type InfraResource = z.infer<typeof infraResourceSchema>;

export const infraDetailSchema = infraResourceSchema.extend({
  properties: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  series: z.array(seriesSchema).default([]),
  related: z.array(refSchema).default([]),
  problems: z.array(problemSummarySchema).default([]),
});
export type InfraDetail = z.infer<typeof infraDetailSchema>;

export const serviceDetailSchema = serviceSummarySchema.extend({
  description: z.string().optional(),
  series: z.array(seriesSchema).default([]),
  infrastructure: z.array(infraResourceSchema).default([]),
  dependencies: z.array(z.object({ ref: refSchema, health: healthStatusSchema })).default([]),
  deployments: z.array(deploymentSummarySchema).default([]),
  problems: z.array(problemSummarySchema).default([]),
  alerts: z.array(alertSummarySchema).default([]),
  allowedActions: allowedActionsSchema,
});
export type ServiceDetail = z.infer<typeof serviceDetailSchema>;
