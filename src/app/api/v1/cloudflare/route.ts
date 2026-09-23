import { cloudflareOverviewSchema } from '@opswatch/contract';
import { apiJson } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { readCloudflareOverview } from '@/lib/read/cloudflare';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/cloudflare`.
 *
 * Not scoped to an environment: a Cloudflare zone belongs to the installation rather than to one AWS
 * account and region. Bounded — an instance has the zones somebody chose, not a stream of them.
 *
 * The `state` field carries which of the four emptinesses applies, so a client can say what to do next
 * rather than rendering an empty dashboard for four different reasons.
 */
export const GET = apiRoute({
  handler: async ({ db }) => apiJson(cloudflareOverviewSchema, readCloudflareOverview(db, Date.now())),
});
