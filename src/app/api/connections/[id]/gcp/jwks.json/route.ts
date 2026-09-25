import { NextResponse } from 'next/server';
import { findConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { jwkSet, openConnectionKey } from '@/lib/gcp/issuer';
import { apiError } from '@/lib/http/api-error';

export const dynamic = 'force-dynamic';

/**
 * This connection's public key, as a JWK set.
 *
 * **Unauthenticated, deliberately.** A JWK set is public keys: that is the whole of what it is for, and
 * Google fetches it without any credential of ours if the operator chose discovery rather than
 * uploading the set. Serving it proves nothing and grants nothing — the private half is encrypted in
 * the row and never leaves it.
 *
 * It answers for Google connections only. A connection that has no such key has no key set, and saying
 * so is better than an empty one, which would read as "this key set is empty" rather than "wrong
 * connection".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = findConnection(getDb(), id);
  if (row === null || row.provider !== 'gcp' || row.gcpKeyCiphertext === null) {
    return apiError('not_found');
  }

  const key = openConnectionKey(row.gcpKeyCiphertext, env().OPSWATCH_SECRET);
  // A key that cannot be opened is not a key. Refusing beats serving something that is not the one
  // this connection signs with, which would send the operator hunting for a mismatch that is here.
  if (key === null) return apiError('not_found');

  return NextResponse.json(jwkSet(key), {
    headers: {
      // Google re-reads a discovery set periodically; a short cache keeps a rotation from taking a day.
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json',
    },
  });
}
