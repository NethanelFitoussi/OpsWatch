import { z } from 'zod';
import { AWS_REGIONS } from '../aws/regions';
import { CONNECTION_NAME_MAX } from '../limits';
import { CONNECTION_METHODS } from './types';

export const nameSchema = z.string().trim().min(1).max(CONNECTION_NAME_MAX);
export const accountIdSchema = z.string().regex(/^\d{12}$/);
export const regionsSchema = z.array(z.enum(AWS_REGIONS)).min(1);
export const methodSchema = z.enum(CONNECTION_METHODS);

/*
 * Google Cloud's own identifier shapes, checked here so nothing an operator typed reaches a URL
 * unchecked. A project *number* is digits and a project *id* is a name: Google uses both, and the
 * workload identity resource name takes the number.
 */
export const gcpProjectIdSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
export const gcpProjectNumberSchema = z.string().trim().regex(/^[0-9]{1,30}$/);
export const gcpResourceIdSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{2,62}$/);
export const gcpServiceAccountSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/);
export const accessKeysSchema = z.object({
  accessKeyId: z.string().regex(/^(AKIA|ASIA)[A-Z0-9]{16}$/),
  secretAccessKey: z.string().min(30).max(128),
});
export type AccessKeys = z.infer<typeof accessKeysSchema>;

const ROLE_ARN = /^arn:aws[\w-]*:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]+)$/;

export function parseRoleArn(arn: string): { account: string; roleName: string } | null {
  const match = arn.trim().match(ROLE_ARN);
  return match ? { account: match[1], roleName: match[2] } : null;
}
