export function awsErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' && error.name) {
    return error.name;
  }
  return 'UnknownError';
}

/** Reports both ways an AWS call can time out (our own timer or an aborted request) as `Timeout`. */
export function normalizeAwsErrorCode(code: string): string {
  return code === 'TimeoutError' || code === 'AbortError' ? 'Timeout' : code;
}

const DENIED = /^(AccessDenied|UnauthorizedOperation|AuthorizationError|NotAuthorized)/;

/** AWS error names that mean "the identity lacks this permission". */
export function isDeniedErrorCode(code: string): boolean {
  return DENIED.test(code);
}
