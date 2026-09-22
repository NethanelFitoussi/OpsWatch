import 'server-only';
import type { Db } from '../../db/client';
import { listConnections } from '../../connections/repository';
import { parseEnvironmentParam } from './request';

/**
 * The `?env=<connectionId>:<scope>` every data endpoint is scoped to, resolved against what this instance
 * actually has.
 *
 * A pair that does not exist answers `not_found` rather than an empty list: "there is nothing wrong in that
 * environment" and "that environment is not one of mine" are different answers, and a client that cannot tell
 * them apart will show the first when it means the second.
 */
export type ResolvedEnvironment =
  | { ok: true; connectionId: string; scope: string }
  | { ok: false; error: 'invalid_request' | 'not_found' };

export function resolveEnvironment(db: Db, url: URL): ResolvedEnvironment {
  const parsed = parseEnvironmentParam(url);
  if (!parsed.ok) return { ok: false, error: 'invalid_request' };
  // Required here, unlike on the endpoints that are not scoped to one.
  if (parsed.environment === null) return { ok: false, error: 'invalid_request' };
  const { connectionId, scope } = parsed.environment;
  const known = listConnections(db).some(
    (connection) => connection.id === connectionId && connection.regions.includes(scope),
  );
  return known ? { ok: true, connectionId, scope } : { ok: false, error: 'not_found' };
}
