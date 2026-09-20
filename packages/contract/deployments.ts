/**
 * Deployments, as a problem or a service refers to them.
 *
 * The detail of a deployment refers back to problems, and the detail of a problem refers to deployments, so the two
 * would import each other. The summary — everything another domain needs — lives here, and `deployments-detail.ts`
 * holds the one schema that needs `problemSummarySchema`.
 */
import { z } from 'zod';
import { epochSchema, idSchema, lenientEnum, refSchema } from './primitives';
import { commitSchema } from './repository';

export const DEPLOYMENT_STATUSES = ['in_progress', 'completed', 'failed', 'rolled_back', 'unknown'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const deploymentSummarySchema = z.object({
  id: idSchema,
  service: refSchema,
  environment: z.string().optional(),
  version: z.string(),
  at: epochSchema,
  status: lenientEnum(DEPLOYMENT_STATUSES, 'unknown'),
  commit: commitSchema.optional(),
  repository: z.string().optional(),
});
export type DeploymentSummary = z.infer<typeof deploymentSummarySchema>;
