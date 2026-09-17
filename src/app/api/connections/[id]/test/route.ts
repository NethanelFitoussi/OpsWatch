import { NextResponse } from 'next/server';
import { getCurrentAdminId } from '@/lib/auth/current';
import { ConnectionNotFoundError } from '@/lib/connections/repository';
import { credentialResolver } from '@/lib/connections/resolver';
import { testConnection } from '@/lib/connections/test-connection';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { isSameOrigin } from '@/lib/http/origin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request, env().OPSWATCH_PUBLIC_URL)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }
  if ((await getCurrentAdminId()) === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    throw error;
  }
}
