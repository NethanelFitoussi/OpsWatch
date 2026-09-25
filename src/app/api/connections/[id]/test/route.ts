import { NextResponse } from 'next/server';
import { recordAdminAction } from '@/lib/auth/audited';
import { getCurrentAdminId } from '@/lib/auth/current';
import { ConnectionNotFoundError } from '@/lib/connections/repository';
import { credentialResolver } from '@/lib/connections/resolver';
import { testConnection } from '@/lib/connections/test-connection';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { apiError } from '@/lib/http/api-error';
import { isSameOrigin } from '@/lib/http/origin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request, env().OPSWATCH_PUBLIC_URL)) {
    return apiError('forbidden_origin');
  }
  const adminId = await getCurrentAdminId();
  if (adminId === null) {
    return apiError('unauthorized');
  }
  const { id } = await params;
  try {
    const result = await testConnection(getDb(), id, {
      secret: env().OPSWATCH_SECRET,
      resolver: credentialResolver,
    });
    // `connection_test` was in the audit log's vocabulary and nothing ever wrote one. A permission test
    // reads across somebody's AWS account with their credential, which is exactly the kind of action the
    // log exists for — and with several accounts connected, which one it reached is the point.
    await recordAdminAction({
      adminId,
      action: 'connection_test',
      subjectType: 'connection',
      subjectId: id,
      connectionId: id,
      result: 'ok',
      details: { accountMatches: result.accountMatches },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return apiError('not_found');
    }
    await recordAdminAction({ adminId, action: 'connection_test', subjectType: 'connection', subjectId: id, connectionId: id, result: 'failed' });
    throw error;
  }
}
