/**
 * Every failure the app can meet talking to OpsWatch, normalised. Screens switch on `kind`, never on raw statuses.
 */
export type ApiErrorKind =
  /** No connectivity, DNS failure, TLS failure, connection refused. */
  | 'network'
  | 'timeout'
  /** Session missing, expired or revoked. The session layer signs the user out. */
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  /** 4xx the client should not retry, with the server's error code. */
  | 'validation'
  | 'server'
  /** The response did not match the contract (older or newer server, proxy page). */
  | 'invalid_response'
  /** The server does not implement this capability. */
  | 'unsupported'
  | 'cancelled';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  /** The server's snake_case error code when it sent one, for example `invalid_credentials`. */
  readonly code: string | undefined;
  /** The provider permission behind an access failure, for example `logs:StartQuery`, when the server names it. */
  readonly action: string | undefined;

  constructor(kind: ApiErrorKind, options: { status?: number; code?: string; message?: string; action?: string } = {}) {
    super(options.message ?? kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.code = options.code;
    this.action = options.action;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 501) return 'unsupported';
  if (status >= 500) return 'server';
  return 'validation';
}

/** Whether a failed request may succeed if simply repeated. */
export function isTransient(error: ApiError): boolean {
  return (
    error.kind === 'network' ||
    error.kind === 'timeout' ||
    error.kind === 'rate_limited' ||
    (error.kind === 'server' && error.status !== undefined && [502, 503, 504].includes(error.status))
  );
}

/** Coerces anything thrown into an ApiError so callers handle a single type. */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  return new ApiError('network', { message: 'Unexpected failure' });
}
