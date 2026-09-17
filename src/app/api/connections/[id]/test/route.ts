import { NextResponse } from 'next/server';
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
  if ((await getCurrentAdminId()) === null) {
    return apiError('unauthorized');
  }
  const { id } = await params;
  try {
    const result = await testConnection(getDb(), id, {
      secret: env().OPSWATCH_SECRET,
      resolver: credentialResolver,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return apiError('not_found');
    }
    throw error;
  }
}
