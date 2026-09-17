export function awsErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' && error.name) {
    return error.name;
  }
  return 'UnknownError';
}
