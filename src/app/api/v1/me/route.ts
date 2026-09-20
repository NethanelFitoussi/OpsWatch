import { meSchema } from '@opswatch/contract';
import { apiJson } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';

export const dynamic = 'force-dynamic';

/** The caller, and what the server will let them do. Never the credential they presented. */
export const GET = apiRoute({
  handler: ({ actor }) =>
    apiJson(meSchema, {
      id: String(actor.adminId),
      email: actor.email,
      role: actor.role,
      locale: actor.locale,
      allowedActions: actor.allowedActions,
    }),
});
