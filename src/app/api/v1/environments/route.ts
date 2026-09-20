import { getTranslations } from 'next-intl/server';
import { environmentListSchema } from '@opswatch/contract';
import { apiJson } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { listEnvironments } from '@/lib/read/environments';

export const dynamic = 'force-dynamic';

/**
 * Bounded, not cursored: an instance has a handful of connections, so there is nothing to page through and
 * `nextCursor` is always null.
 */
export const GET = apiRoute({
  handler: async ({ db, actor }) => {
    const t = await getTranslations({ locale: actor.locale, namespace: 'Api' });
    const items = listEnvironments(db, (values) => t('environmentName', values));
    return apiJson(environmentListSchema, { items });
  },
});
