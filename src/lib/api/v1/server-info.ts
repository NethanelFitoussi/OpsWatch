import 'server-only';
import { API_VERSION, type ServerInfo } from '@opswatch/contract';
import { version } from '../../../../package.json';
import { googleSignInConfig } from '../../auth/google';
import { listConnections } from '../../connections/repository';
import type { Db } from '../../db/client';
import { env } from '../../env';
import { featureFlags } from './features';

/**
 * What `GET /api/v1/server` answers, the only thing OpsWatch says to a caller who has not signed in.
 *
 * It names the product, the version, the API version and which sign-in methods are offered, and nothing else: no
 * account, no connection, no host, no path, nothing that would tell an unauthenticated caller what is inside.
 */
export function serverInfo(db: Db): ServerInfo {
  return {
    product: 'opswatch',
    version,
    apiVersion: API_VERSION,
    demo: false,
    auth: { password: true, google: googleSignInConfig(env()) !== null },
    features: featureFlags({
      hasConnection: listConnections(db).length > 0,
      // Neither exists yet; they become a read of the instance's configuration in the phase that adds them.
      aiConfigured: false,
      pushConfigured: false,
    }),
  };
}
