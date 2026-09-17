import { NextResponse } from 'next/server';

/** Error codes of the JSON API. API and form error codes are snake_case; identity error codes follow AWS PascalCase. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden_origin'
  | 'not_found'
  | 'not_a_role_connection'
  | 'no_base_identity'
  | 'invalid_query'
  | 'range_too_long'
  | 'connection_unusable'
  | 'aws_denied'
  | 'aws_throttled'
  | 'aws_error';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden_origin: 403,
  not_found: 404,
  not_a_role_connection: 400,
  no_base_identity: 409,
  invalid_query: 400,
  range_too_long: 400,
  connection_unusable: 409,
  aws_denied: 403,
  aws_throttled: 429,
  aws_error: 502,
};

export function apiError(code: ApiErrorCode): NextResponse<{ error: ApiErrorCode }> {
  return NextResponse.json({ error: code }, { status: STATUS[code] });
}
