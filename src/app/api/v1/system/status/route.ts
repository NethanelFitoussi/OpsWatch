import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { systemStatusSchema } from '@opswatch/contract';
import { listConnections } from '@/lib/connections/repository';
import { env } from '@/lib/env';
import { can } from '@opswatch/contract';
import { readSystemStatus } from '@/lib/read/system';

export const dynamic = 'force-dynamic';

/** Admin-only: it names the collector's owner and the database's size, which is operator information. */
export const GET = apiRoute({
  handler: ({ db, actor }) => {
    if (!can(actor.role, 'audit.read')) return apiFailure('forbidden');
    const environments = listConnections(db).flatMap((connection) =>
      connection.regions.map((scope) => ({ connectionId: connection.id, scope })),
    );
    return apiJson(
      systemStatusSchema,
      readSystemStatus(db, { nowMs: Date.now(), environments, dataDir: env().OPSWATCH_DATA_DIR }),
    );
  },
});
