import { NextResponse } from 'next/server';
import { publicApiRoute } from '@/lib/api/v1/handler';
import { openApiDocument } from '@/lib/api/v1/openapi';

export const dynamic = 'force-dynamic';

/**
 * The generated description of the API. It is built from the shared contract schemas, so it cannot drift from what
 * the routes answer, and `tests/unit/api-openapi.test.ts` fails if a route is missing from it.
 */
export const GET = publicApiRoute({
  handler: () => NextResponse.json(openApiDocument(), { headers: { 'cache-control': 'no-store' } }),
});
