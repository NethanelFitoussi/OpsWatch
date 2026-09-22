/**
 * Validation of the OpsWatch server URL typed by the user.
 *
 * HTTPS is required. Plain HTTP is only accepted for loopback and private-network hosts, only in development builds,
 * and only after the user explicitly allows it: this is how contributors reach a server on their laptop. There is no
 * code path that disables TLS certificate verification.
 */

export type ServerUrlResult =
  | { ok: true; url: string; insecure: boolean }
  | { ok: false; reason: 'empty' | 'invalid' | 'unsupported_scheme' | 'insecure_not_allowed' | 'credentials_in_url' | 'has_query' };

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127(?:\.\d{1,3}){3}$/,
  /^10(?:\.\d{1,3}){3}$/,
  /^192\.168(?:\.\d{1,3}){2}$/,
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/,
  /^\[?::1\]?$/,
  /\.local$/i,
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

/**
 * Normalises and validates a server URL. Accepts `ops.example.com` (https is assumed), keeps a sub-path (OpsWatch
 * behind `/ops`), and drops a trailing slash.
 */
export function parseServerUrl(input: string, options: { allowInsecureLocal: boolean }): ServerUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!url.hostname) return { ok: false, reason: 'invalid' };
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' };
  if (url.search || url.hash) return { ok: false, reason: 'has_query' };

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') return { ok: false, reason: 'unsupported_scheme' };

  const insecure = protocol === 'http:';
  if (insecure && !(options.allowInsecureLocal && isPrivateHost(url.hostname))) {
    return { ok: false, reason: 'insecure_not_allowed' };
  }

  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${url.protocol}//${url.host}${path}`, insecure };
}

/** Short display form: `ops.example.com` or `ops.example.com/ops`. */
export function displayServer(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
