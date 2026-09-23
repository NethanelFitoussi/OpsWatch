/**
 * Whether a provider endpoint may be stored at all.
 *
 * The same reasoning as the synthetics URL guard, and it lives in its own module for the same reason: a
 * `'use server'` file may only export async functions, so a plain predicate beside the actions makes every
 * other export in the file unresolvable. The fetch-time SSRF guard still applies — this one refuses the URL
 * before it is written down, so nothing sits in the database looking configured that could never be called.
 */
export function isAcceptableEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // https only. An API key on a plaintext connection is a key somebody else has.
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.search !== '' || url.hash !== '') return false;
  return url.hostname.length > 0 && value.length <= 500;
}
