import type { NextRequest } from 'next/server';
import { getCurrentAdminId } from '@/lib/auth/current';
import { renderCollectionTemplateYaml } from '@/lib/aws/collection-template';
import { resourcePrefix } from '@/lib/aws/template';
import { findConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { apiError } from '@/lib/http/api-error';
import { browserLocale, isBrowserNavigation, seeOther } from '@/lib/http/browser';

export const dynamic = 'force-dynamic';

/**
 * The optional collection stack, as a file to run.
 *
 * It carries no secret: the signing secret is a `NoEcho` parameter the operator supplies when they deploy,
 * so this document can be downloaded, read, diffed and kept without being a credential.
 *
 * It is refused entirely when `OPSWATCH_PUBLIC_URL` is not set, because a forwarder needs an address AWS
 * can reach — and a template pointing at nothing is a stack that installs and never delivers.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const browser = isBrowserNavigation(request);
  const locale = browserLocale(request);
  if ((await getCurrentAdminId()) === null) return browser ? seeOther(`/${locale}/login`) : apiError('unauthorized');

  const { id } = await params;
  const row = findConnection(getDb(), id);
  if (!row) return browser ? seeOther(`/${locale}/accounts`) : apiError('not_found');

  const endpoint = env().OPSWATCH_PUBLIC_URL;
  if (endpoint === undefined || endpoint.length === 0) {
    return browser ? seeOther(`/${locale}/accounts/${row.id}/collection?error=no_public_url`) : apiError('not_found');
  }

  return new Response(renderCollectionTemplateYaml({ connectionId: row.id, endpoint: endpoint.replace(/\/$/, '') }), {
    headers: {
      'content-type': 'application/x-yaml; charset=utf-8',
      'content-disposition': `attachment; filename="${resourcePrefix(row.id)}-collection.yaml"`,
      'cache-control': 'no-store',
    },
  });
}
