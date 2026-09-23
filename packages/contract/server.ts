/**
 * What the server says about itself, before anyone has signed in.
 *
 * `GET /api/v1/server` is the only unauthenticated endpoint. A client reads it first and hides whatever the server
 * says it cannot do, so a new client against an old server degrades instead of failing.
 */
import { z } from 'zod';
import { epochSchema, lenientEnum } from './primitives';

export const API_PREFIX = '/api/v1';
export const API_VERSION = 1;

export const FEATURES = [
  'health',
  'brief',
  'problems',
  'errors',
  'services',
  'infrastructure',
  'logs',
  'alerts',
  'incidents',
  'synthetics',
  'slos',
  'cloudflare',
  'deployments',
  'reports',
  'checkup',
  'investigations',
  'repository',
  'ai',
  'search',
  'favorites',
  'environments',
  'push',
] as const;
export type Feature = (typeof FEATURES)[number];

/**
 * A flag is true only when the server both implements the capability and the operator has enabled it, so a client
 * never has to tell "not built yet" apart from "switched off here": in either case it is not there.
 */
const featureFlags = z
  .record(z.string(), z.boolean())
  .transform((flags) => Object.fromEntries(FEATURES.map((f) => [f, flags[f] === true])) as Record<Feature, boolean>)
  .meta({ type: 'object', additionalProperties: { type: 'boolean' }, propertyNames: { enum: [...FEATURES] } });

export const serverInfoSchema = z.object({
  product: z.literal('opswatch'),
  version: z.string(),
  apiVersion: z.number().int(),
  name: z.string().optional(),
  /** True when the instance answers from fixtures rather than from a real account. */
  demo: z.boolean().optional().default(false),
  auth: z.object({ password: z.boolean(), google: z.boolean() }),
  features: featureFlags,
});
export type ServerInfo = z.infer<typeof serverInfoSchema>;

/**
 * What OpsWatch knows about itself (§21). Admin-only, and the one page that must keep working when the thing
 * it reports on is broken — so it names what has *not* happened as carefully as what has.
 */
export const jobStatusSchema = z.object({
  job: z.string(),
  everyMs: z.number(),
  /** `null` means this job has never run on this instance, which is different from having run and failed. */
  lastRunAt: epochSchema.nullable(),
  lastStatus: lenientEnum(['running', 'ok', 'failed', 'skipped'] as const, 'failed').nullable(),
  durationMs: z.number().nullable(),
  covered: z.number().nullable(),
  total: z.number().nullable(),
  truncated: z.boolean(),
  errorCode: z.string().nullable(),
  nextRunAt: epochSchema.nullable(),
});
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const environmentStatusSchema = z.object({
  connectionId: z.string(),
  scope: z.string(),
  lastReadAt: epochSchema.nullable(),
  familiesRead: z.number(),
  familiesTotal: z.number(),
});
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

export const systemStatusSchema = z.object({
  version: z.string(),
  generatedAt: epochSchema,
  collector: z.object({
    owner: z.string().nullable(),
    heartbeatAt: epochSchema.nullable(),
    alive: z.boolean(),
    /** True when nothing has ever collected: every other page is then reporting on no knowledge at all. */
    neverRan: z.boolean(),
  }),
  jobs: z.array(jobStatusSchema),
  environments: z.array(environmentStatusSchema),
  database: z.object({ sizeBytes: z.number().nullable(), schemaVersion: z.number().nullable() }),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

