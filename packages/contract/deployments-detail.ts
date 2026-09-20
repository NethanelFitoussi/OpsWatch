/**
 * The detail of a deployment, which is the one schema of the deployments domain that refers back to problems.
 *
 * It sits in its own file so `problems.ts` can import `deployments.ts` without the two importing each other: an
 * import cycle between two modules that both build schemas at evaluation time is a crash, not a warning.
 */
import { z } from 'zod';
import { allowedActionsSchema } from './primitives';
import { deploymentSummarySchema } from './deployments';
import { problemSummarySchema } from './problems';
import { repositoryEvidenceSchema } from './repository';

export const deploymentDetailSchema = deploymentSummarySchema.extend({
  description: z.string().optional(),
  /** Problems that started after this deployment, with the delay. Correlation only. */
  relatedProblems: z.array(z.object({ problem: problemSummarySchema, minutesAfterDeployment: z.number() })).default([]),
  changes: z.object({ files: z.number(), additions: z.number(), deletions: z.number() }).optional(),
  evidence: z.array(repositoryEvidenceSchema).default([]),
  allowedActions: allowedActionsSchema,
});
export type DeploymentDetail = z.infer<typeof deploymentDetailSchema>;
