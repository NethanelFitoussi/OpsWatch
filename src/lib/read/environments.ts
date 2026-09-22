import 'server-only';
import { type Environment, environmentId } from '@opswatch/contract';
import { listConnections } from '../connections/repository';
import type { Db } from '../db/client';

/**
 * Every environment of the instance: one per connection and region pair, which is exactly what `?env=` names.
 *
 * A read service, not a route: the API and any page that needs the same list call this, so neither holds a rule the
 * other cannot reach. It answers from the database alone and never touches AWS, so it is cheap and always available.
 */
export function listEnvironments(db: Db, label: (values: { connection: string; region: string }) => string): Environment[] {
  return listConnections(db).flatMap((connection) =>
    connection.regions.map((region) => ({
      id: environmentId(connection.id, region),
      name: label({ connection: connection.name, region }),
      // OpsWatch does not record what an environment is *for*, and guessing it from a name would be wrong as often
      // as right. `custom` is the honest answer until the operator is asked.
      kind: 'custom' as const,
    })),
  );
}
