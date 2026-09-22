/**
 * The environment every data call is scoped to with `?env=`.
 *
 * An environment is a connection and a scope: `"<connectionId>:<scope>"`, where the scope is an AWS region, a
 * Cloudflare zone id, or the literal `account` for something that is not regional. The pair is the id, so a client
 * never has to carry two parameters and the server never has to guess which connection a region belongs to.
 */
import { z } from 'zod';
import { idSchema, lenientEnum } from './primitives';

export const ENVIRONMENT_KINDS = ['production', 'staging', 'development', 'custom'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const environmentSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: lenientEnum(ENVIRONMENT_KINDS, 'custom'),
  description: z.string().optional(),
});
export type Environment = z.infer<typeof environmentSchema>;

/** `GET /environments`. Bounded: an instance has a handful of connections, so there is nothing to page through. */
export const environmentListSchema = z.object({
  items: z.array(environmentSchema),
  nextCursor: z.string().nullable().default(null),
});
export type EnvironmentList = z.infer<typeof environmentListSchema>;

/** The scope of a connection that is not regional. */
export const ACCOUNT_SCOPE = 'account';

export function environmentId(connectionId: string, scope: string): string {
  return `${connectionId}:${scope}`;
}

/** `null` for anything that is not a `<connectionId>:<scope>` pair, so a handler never splits a malformed id itself. */
export function parseEnvironmentId(value: string): { connectionId: string; scope: string } | null {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) return null;
  const connectionId = value.slice(0, separator);
  const scope = value.slice(separator + 1);
  // A second colon would make the pair ambiguous, and no scope OpsWatch knows contains one.
  return scope.includes(':') ? null : { connectionId, scope };
}
