import { aiAnswerSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { resolveEnvironment } from '@/lib/api/v1/environment';
import { apiRoute } from '@/lib/api/v1/handler';
import { askOpsWatch } from '@/lib/ai/ask';
import { insightRenderer } from '@/lib/read/render';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/ai/ask`.
 *
 * A question, answered from evidence OpsWatch already measured. The answer is a **hypothesis** — the
 * contract gives it citations precisely so a client can show what it was built from rather than ask a
 * reader to believe it.
 *
 * `not_found` when no provider is configured: a caller that was told `features.ai` is false and asked
 * anyway gets the same answer as one asking about an environment that is not there.
 */
export const POST = apiRoute({
  handler: async ({ db, url, request, actor }) => {
    const environment = resolveEnvironment(db, url);
    if (!environment.ok) return apiFailure(environment.error);

    const body: unknown = await request.json().catch(() => null);
    const question = typeof body === 'object' && body !== null ? (body as { question?: unknown }).question : undefined;
    if (typeof question !== 'string') return apiFailure('invalid_request');

    const result = await askOpsWatch(
      db,
      { connectionId: environment.connectionId, scope: environment.scope, question },
      { nowMs: Date.now(), render: await insightRenderer(actor.locale) },
    );
    if (!result.ok) {
      // A provider that is not configured is not a bad request, and a question with nothing to answer from
      // is not a server fault. Both are told apart so a client can say something useful.
      if (result.error === 'invalid_question') return apiFailure('invalid_request');
      if (result.error === 'not_configured') return apiFailure('not_found');
      return apiFailure('unavailable');
    }
    return apiJson(aiAnswerSchema, result.answer);
  },
});
