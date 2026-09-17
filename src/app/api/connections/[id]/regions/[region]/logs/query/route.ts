import { NextResponse } from 'next/server';
import { apiError } from '@/lib/http/api-error';
import { authorizeLogsRoute, failureResponse } from '@/lib/monitoring/logs-route';
import { parseLogsQueryInput, startLogsQuery } from '@/lib/monitoring/logs';
import { queryBindings } from '@/lib/monitoring/query-bindings';
import { resolveTarget } from '@/lib/monitoring/target';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string; region: string }> }) {
  const auth = await authorizeLogsRoute(request, await params, { mutating: true });
  if (!auth.ok) return auth.response;
  const input = parseLogsQueryInput(await request.json().catch(() => null), Date.now());
  if (!input.ok) return apiError(input.error);
  const target = await resolveTarget(auth.scope);
  if (!target.ok) return failureResponse(target);
  const started = await startLogsQuery(target.data, input.value);
  if (!started.ok) return failureResponse(started);
  queryBindings.bind(started.data.queryId, { ...auth.scope, sessionId: auth.sessionId });
  return NextResponse.json({ queryId: started.data.queryId });
}
