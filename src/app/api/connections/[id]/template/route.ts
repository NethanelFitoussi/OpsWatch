import { NextResponse } from 'next/server';
import { detectBaseIdentity, trustFor } from '@/lib/aws/identity';
import { renderTemplateYaml, templateFileNameFor } from '@/lib/aws/template';
import { getCurrentAdminId } from '@/lib/auth/current';
import { ConnectionNotFoundError, getConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { browserLocale, isBrowserNavigation, seeOther } from '@/lib/http/browser';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // A click on the download link must land on a page, not on a JSON error.
  const browser = isBrowserNavigation(request);
  const locale = browserLocale(request);
  if ((await getCurrentAdminId()) === null) {
    return browser ? seeOther(`/${locale}/login`) : NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let row;
  try {
    row = getConnection(getDb(), id);
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    throw error;
  }
  if (row.method !== 'role' || !row.externalId) {
    return NextResponse.json({ error: 'not_a_role_connection' }, { status: 400 });
  }

  let identity;
  try {
    identity = await detectBaseIdentity(row.regions[0]);
  } catch {
    return browser
      ? seeOther(`/${locale}/accounts/${row.id}?error=no_base_identity`)
      : NextResponse.json({ error: 'no_base_identity' }, { status: 409 });
  }

  const yaml = renderTemplateYaml({ connectionId: row.id, externalId: row.externalId, trust: trustFor(identity) });
  return new Response(yaml, {
    headers: {
      'content-type': 'application/x-yaml; charset=utf-8',
      'content-disposition': `attachment; filename="${templateFileNameFor(row.id)}"`,
      'cache-control': 'no-store',
    },
  });
}
