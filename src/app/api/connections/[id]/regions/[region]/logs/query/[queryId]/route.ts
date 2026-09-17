import { NextResponse } from 'next/server';
import { apiError } from '@/lib/http/api-error';
import { authorizeLogsRoute, failureResponse } from '@/lib/monitoring/logs-route';
import { getLogsQueryResults, stopLogsQuery } from '@/lib/monitoring/logs';
import { queryBindings } from '@/lib/monitoring/query-bindings';
import { resolveTarget } from '@/lib/monitoring/target';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; region: string; queryId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { queryId, ...rest } = await params;
  const auth = await authorizeLogsRoute(request, rest, { mutating: false });
  if (!auth.ok) return auth.response;
  if (!queryBindings.matches(queryId, { ...auth.scope, sessionId: auth.sessionId })) return apiError('not_found');
  const target = await resolveTarget(auth.scope);
  if (!target.ok) return failureResponse(target);
  const results = await getLogsQueryResults(target.data, queryId);
  return results.ok ? NextResponse.json(results.data) : failureResponse(results);
}

export async function DELETE(request: Request, { params }: Context) {
  const { queryId, ...rest } = await params;
  const auth = await authorizeLogsRoute(request, rest, { mutating: true });
  if (!auth.ok) return auth.response;
  if (!queryBindings.matches(queryId, { ...auth.scope, sessionId: auth.sessionId })) return apiError('not_found');
  const target = await resolveTarget(auth.scope);
  // StopQuery failures are ignored (moto 5.2.3 does not implement it); the binding is dropped either way.
  if (target.ok) await stopLogsQuery(target.data, queryId);
  queryBindings.forget(queryId);
  return new NextResponse(null, { status: 204 });
}
