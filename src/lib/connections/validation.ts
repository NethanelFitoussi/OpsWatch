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
/**
 * Google Cloud regions, by shape rather than by list.
 *
 * The AWS side validates against a fixed list because its region grid offers one. Google adds regions
 * often, and a list baked in here would quietly refuse a region that exists — so the shape is checked,
 * and whether the region is real is answered by Google when the instances are read. Being wrong about
 * that is a message on a page, not a field that cannot be typed into.
 */
export const gcpRegionSchema = z.string().trim().regex(/^[a-z]+-[a-z]+[0-9]$/);
export const gcpRegionsSchema = z.array(gcpRegionSchema).min(1).max(20);

/**
 * A DigitalOcean personal access token, by shape.
 *
 * Long, opaque and prefixed — the shape is checked so an obvious paste error is a message rather than
 * a call to DigitalOcean, and whether the token is *real* is answered by DigitalOcean.
 */
export const doTokenSchema = z.string().trim().min(40).max(256).regex(/^[A-Za-z0-9_-]+$/);

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
