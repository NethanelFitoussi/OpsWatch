import { z } from 'zod';
import { CONNECTION_METHODS } from './types';

export const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ca-central-1', 'sa-east-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2',
  'me-south-1', 'me-central-1', 'il-central-1', 'af-south-1',
  'ap-south-1', 'ap-south-2', 'ap-east-1',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
] as const;
export type AwsRegion = (typeof AWS_REGIONS)[number];

export const nameSchema = z.string().trim().min(1).max(80);
export const accountIdSchema = z.string().regex(/^\d{12}$/);
export const regionsSchema = z.array(z.enum(AWS_REGIONS)).min(1);
export const methodSchema = z.enum(CONNECTION_METHODS);
export const accessKeysSchema = z.object({
  accessKeyId: z.string().regex(/^(AKIA|ASIA)[A-Z0-9]{16}$/),
  secretAccessKey: z.string().min(30).max(128),
});

const ROLE_ARN = /^arn:aws[\w-]*:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]+)$/;

export function parseRoleArn(arn: string): { account: string; roleName: string } | null {
  const match = arn.trim().match(ROLE_ARN);
  return match ? { account: match[1], roleName: match[2] } : null;
}
