import { NextResponse } from 'next/server';
import { version } from '../../../../package.json';

export const dynamic = 'force-dynamic';

/**
 * The liveness endpoint a reverse proxy or an orchestrator polls. `{ status, version }` and nothing else.
 *
 * Unauthenticated on purpose, which is why it says nothing about the instance: no account, no connection, no
 * host, no path, no counts. A probe needs to know the process is up; anyone else learns nothing from it.
 */
export function GET() {
  return NextResponse.json({ status: 'ok', version }, { headers: { 'cache-control': 'no-store' } });
}
