export function isSameOrigin(request: Request, publicUrl?: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }
  if (publicUrl) {
    return origin === new URL(publicUrl).origin;
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) {
    return false;
  }
  const protocol = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  return origin === `${protocol}://${host}`;
}
