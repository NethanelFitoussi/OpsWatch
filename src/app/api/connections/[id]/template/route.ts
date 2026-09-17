import type { NextRequest } from 'next/server';
import { templateFileNameFor } from '@/lib/aws/template';
import { awsErrorCode } from '@/lib/aws/errors';
import { getCurrentAdminId } from '@/lib/auth/current';
import { findConnection } from '@/lib/connections/repository';
import { isTemplateReady, renderConnectionTemplate } from '@/lib/connections/template';
import { getDb } from '@/lib/db/client';
import { apiError } from '@/lib/http/api-error';
import { browserLocale, isBrowserNavigation, seeOther } from '@/lib/http/browser';
import { logConnectionEvent } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // A click on the download link must land on a page, not on a JSON error.
  const browser = isBrowserNavigation(request);
  const locale = browserLocale(request);
  if ((await getCurrentAdminId()) === null) {
    return browser ? seeOther(`/${locale}/login`) : apiError('unauthorized');
  }
  const { id } = await params;

  const row = findConnection(getDb(), id);
  if (!row) {
    return browser ? seeOther(`/${locale}/accounts`) : apiError('not_found');
  }
  if (!isTemplateReady(row)) {
    return browser ? seeOther(`/${locale}/accounts/${row.id}`) : apiError('not_a_role_connection');
  }

  let yaml: string;
  try {
    yaml = await renderConnectionTemplate(row);
  } catch (error) {
    logConnectionEvent({ event: 'template_download', connectionId: row.id, ok: false, errorCode: awsErrorCode(error) });
    return browser ? seeOther(`/${locale}/accounts/${row.id}?error=no_base_identity`) : apiError('no_base_identity');
  }

  return new Response(yaml, {
    headers: {
      'content-type': 'application/x-yaml; charset=utf-8',
      'content-disposition': `attachment; filename="${templateFileNameFor(row.id)}"`,
      'cache-control': 'no-store',
    },
  });
}
