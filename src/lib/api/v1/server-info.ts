import 'server-only';
import { API_VERSION, type ServerInfo } from '@opswatch/contract';
import { version } from '../../../../package.json';
import { aiIsReady } from '../../ai/connection';
import { cloudflareIsReady } from '../../cloudflare/connection';
import { githubIsReady } from '../../github/connection';
import { googleSignInConfig } from '../../auth/google';
import { listConnections } from '../../connections/repository';
import { listRepositories } from '../../store/repositories';
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
      // Configured **and tested**: a saved key that has never answered is not a capability a client should
      // be told it has. `IMPLEMENTED.ai` gates it besides, so the flag is true only when both halves are.
      aiConfigured: aiIsReady(db),
      // Push needs FCM/APNs credentials and an account nobody has created; it becomes a read when they exist.
      pushConfigured: false,
      // Verified, and with a zone to read. Either half alone reads nothing.
      cloudflareReady: cloudflareIsReady(db),
      // Verified, and with somewhere to look. Either half alone reads nothing.
      repositoryConnected: githubIsReady(db) && listRepositories(db).length > 0,
    }),
  };
}
