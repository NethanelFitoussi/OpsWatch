// Shared by next.config.ts and proxy.ts, so this module must not import server-only code.

/** Clickjacking defence: no page of OpsWatch may be shown inside a frame. */
export const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
];

function hostOf(publicUrl: string | undefined): string | null {
  if (!publicUrl) return null;
  try {
    return new URL(publicUrl).host;
  } catch {
    return null;
  }
}

/** Extra hosts allowed to call Server Actions: the host of OPSWATCH_PUBLIC_URL, if any. */
export function serverActionAllowedOrigins(publicUrl: string | undefined): string[] {
  const host = hostOf(publicUrl);
  return host ? [host] : [];
}

/**
 * next.config.ts is frozen into the standalone server at build time, so a Docker image built
 * without OPSWATCH_PUBLIC_URL cannot rely on `serverActions.allowedOrigins`. At run time, a
 * Server Action whose Origin is exactly the public URL gets that host as `x-forwarded-host`,
 * which is what Next.js compares the Origin with. Returns null when nothing needs to change.
 */
export function withPublicHostForAction(request: Request, publicUrl: string | undefined): Headers | null {
  const host = hostOf(publicUrl);
  if (!host || request.method !== 'POST' || !request.headers.has('next-action')) return null;
  const origin = request.headers.get('origin');
  if (!origin || hostOf(origin) !== host) return null;
  if (request.headers.get('x-forwarded-host') === host) return null;
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', host);
  return headers;
}
