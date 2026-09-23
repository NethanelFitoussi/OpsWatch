import { userPreferencesSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { readPreferences, writePreferences } from '@/lib/store/preferences';

export const dynamic = 'force-dynamic';

/** The shape both verbs answer with, from a stored row. */
function toWire(row: ReturnType<typeof readPreferences>) {
  return {
    ...(row.locale === null ? {} : { locale: row.locale }),
    ...(row.defaultEnvironmentId === null ? {} : { defaultEnvironmentId: row.defaultEnvironmentId }),
    notifications: { minSeverity: row.minSeverity, categories: row.categories as ('critical_problem' | 'alert' | 'synthetic_failure' | 'incident' | 'recovery')[] },
  };
}

/** `GET /api/v1/me/preferences`. A user who has never set any gets the defaults, not an empty object. */
export const GET = apiRoute({
  handler: ({ db, actor }) => apiJson(userPreferencesSchema, toWire(readPreferences(db, actor.adminId))),
});

/**
 * `POST /api/v1/me/preferences`.
 *
 * A **partial** update, because the contract says a client sends only what it is changing. A phone that
 * knows nothing about `defaultEnvironmentId` must not erase it by leaving it out.
 */
export const POST = apiRoute({
  handler: async ({ db, request, actor }) => {
    const parsed = userPreferencesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiFailure('invalid_request');

    const row = writePreferences(
      db,
      actor.adminId,
      {
        ...(parsed.data.locale === undefined ? {} : { locale: parsed.data.locale }),
        ...(parsed.data.defaultEnvironmentId === undefined ? {} : { defaultEnvironmentId: parsed.data.defaultEnvironmentId }),
        ...(parsed.data.notifications === undefined
          ? {}
          : { minSeverity: parsed.data.notifications.minSeverity, categories: [...parsed.data.notifications.categories] }),
      },
      Date.now(),
    );
    return apiJson(userPreferencesSchema, toWire(row));
  },
});
