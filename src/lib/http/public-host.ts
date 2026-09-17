// Imported by next.config.ts, so this module must not import server-only code.

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

/**
 * Extra hosts allowed to call Server Actions: the host of OPSWATCH_PUBLIC_URL, if any. The standalone
 * server freezes next.config.ts at build time, so the Docker build receives OPSWATCH_PUBLIC_URL as a
 * build argument (see Dockerfile and docker-compose.yml).
 */
export function serverActionAllowedOrigins(publicUrl: string | undefined): string[] {
  const host = hostOf(publicUrl);
  return host ? [host] : [];
}
