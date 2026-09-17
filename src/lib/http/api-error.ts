import { NextResponse } from 'next/server';

/** Error codes of the JSON API. API and form error codes are snake_case; identity error codes follow AWS PascalCase. */
export type ApiErrorCode = 'unauthorized' | 'forbidden_origin' | 'not_found' | 'not_a_role_connection' | 'no_base_identity';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden_origin: 403,
  not_found: 404,
  not_a_role_connection: 400,
  no_base_identity: 409,
};

export function apiError(code: ApiErrorCode): NextResponse<{ error: ApiErrorCode }> {
  return NextResponse.json({ error: code }, { status: STATUS[code] });
}
