/**
 * Whether a URL is one OpsWatch will fetch (§14).
 *
 * Beside the action rather than inside it, because a `'use server'` module may only export async functions
 * — a plain one there makes every other export in the file unresolvable, with an error that names the
 * actions rather than the constant. This is the second time that rule has caught this codebase out.
 *
 * The check is deliberately duplicated: `safeFetch` refuses a bad target at fetch time, and this refuses it
 * at save time. A URL nobody can ever check should not sit in the database looking configured.
 */

/** §14: ports 80, 443, 8080 and 8443. An empty port means the scheme's default, which is 80 or 443. */
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

export function isAcceptableUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return ALLOWED_PORTS.has(url.port);
}
