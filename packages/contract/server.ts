/**
 * What the server says about itself, before anyone has signed in.
 *
 * `GET /api/v1/server` is the only unauthenticated endpoint. A client reads it first and hides whatever the server
 * says it cannot do, so a new client against an old server degrades instead of failing.
 */
import { z } from 'zod';

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
  'deployments',
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
