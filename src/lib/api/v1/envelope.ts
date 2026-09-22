import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { API_ERROR_STATUS, type ApiErrorBody, type ApiErrorCode } from '@opswatch/contract';

/**
 * Every response of `/api/v1` is built here, so the conventions of §12.2 are decided once and inherited by every
 * endpoint that ships later: one JSON envelope, snake-case error codes with a fixed status, epoch milliseconds and
 * `null` for anything unmeasurable (both carried by the schemas), and nothing cached anywhere.
 *
 * There is deliberately no CORS header on any of them. The API is called by this instance's own pages and by native
 * clients, neither of which needs one, and adding one would hand a browser on another origin the session cookie.
 */
const HEADERS = { 'cache-control': 'no-store' } as const;

/** A JSON success, validated against the contract schema the endpoint promises. */
export function apiJson<T extends z.ZodType>(schema: T, value: z.input<T>, status = 200): NextResponse {
  return NextResponse.json(validate(schema, value), { status, headers: HEADERS });
}

/** A success with nothing to say: logout, revocation, acknowledgement. */
export function apiNoContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}

export type FailureDetail = {
  /** The provider action behind the failure, for example `logs:StartQuery`, so a client can name the permission. */
  action?: string;
  /** The provider's own error code, for example `AccessDeniedException`. */
  awsCode?: string;
  /** Seconds to wait, sent as `Retry-After`: a header a client library already understands, not a new field. */
  retryAfterSeconds?: number;
};

export function apiFailure(error: ApiErrorCode, detail: FailureDetail = {}): NextResponse {
  const body: ApiErrorBody = { error };
  if (detail.action !== undefined) body.action = detail.action;
  if (detail.awsCode !== undefined) body.code = detail.awsCode;
  const headers: Record<string, string> = { ...HEADERS };
  if (detail.retryAfterSeconds !== undefined) headers['retry-after'] = String(detail.retryAfterSeconds);
  return NextResponse.json(body, { status: API_ERROR_STATUS[error], headers });
}

/**
 * The server holds itself to the contract: outside production a response the schema rejects throws, so the drift
 * fails the test suite instead of reaching a client. In production the value is sent as it is and the mismatch is
 * logged, because a running instance answering 500 is worse than one answering a field a client will ignore.
 */
function validate<T extends z.ZodType>(schema: T, value: z.input<T>): unknown {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`API response does not match the contract: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  console.info(JSON.stringify({ event: 'api_contract_drift', paths: parsed.error.issues.map((i) => i.path.join('.')) }));
  return value;
}
