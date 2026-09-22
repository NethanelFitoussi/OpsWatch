import { serverInfoSchema } from '@opswatch/contract';
import { publicApiRoute } from '@/lib/api/v1/handler';
import { apiJson } from '@/lib/api/v1/envelope';
import { serverInfo } from '@/lib/api/v1/server-info';

export const dynamic = 'force-dynamic';

/** Unauthenticated on purpose, and it says nothing an unauthenticated caller should not know. */
export const GET = publicApiRoute({ handler: ({ db }) => apiJson(serverInfoSchema, serverInfo(db)) });
