import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '../auth/current';
import { findConnection } from '../connections/repository';
import { getDb } from '../db/client';
import { env } from '../env';
import { apiError, type ApiErrorCode } from '../http/api-error';
import { isSameOrigin } from '../http/origin';
import type { MonitoringScope } from './call';
import type { FailureReason, MonitoringFailure } from './result';
import { checkSelection } from './selection';

export type LogsRouteParams = { id: string; region: string };

type LogsRouteAuth = { ok: true; sessionId: string; scope: MonitoringScope } | { ok: false; response: Response };

/** Origin (mutating methods), then session, then connection and region: nothing touches AWS before all three pass. */
export async function authorizeLogsRoute(request: Request, params: LogsRouteParams, options: { mutating: boolean }): Promise<LogsRouteAuth> {
  if (options.mutating && !isSameOrigin(request, env().OPSWATCH_PUBLIC_URL)) return { ok: false as const, response: apiError('forbidden_origin') };
  const session = await getCurrentSession();
  if (!session) return { ok: false as const, response: apiError('unauthorized') };
  const check = checkSelection(findConnection(getDb(), params.id), params.region);
  if (check.kind === 'not_found') return { ok: false as const, response: apiError('not_found') };
  if (check.kind === 'unusable') return { ok: false as const, response: apiError('connection_unusable') };
  return { ok: true as const, sessionId: session.sessionId, scope: { connectionId: params.id, region: params.region } satisfies MonitoringScope };
}

const FAILURE_CODES: Record<FailureReason, ApiErrorCode> = { denied: 'aws_denied', throttled: 'aws_throttled', error: 'aws_error' };
const FAILURE_STATUS: Record<FailureReason, number> = { denied: 403, throttled: 429, error: 502 };

/** The AWS action and error code reach the browser so the UI can name the missing permission; nothing else does. */
export function failureResponse(failure: MonitoringFailure): Response {
  return NextResponse.json({ error: FAILURE_CODES[failure.reason], action: failure.action, code: failure.code }, { status: FAILURE_STATUS[failure.reason] });
}
