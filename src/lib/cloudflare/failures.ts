/**
 * Everything that can go wrong talking to Cloudflare, as codes.
 *
 * Client-safe and separate from the API client on purpose: the settings page renders these, and the module
 * that sends the request is server-only. A closed list keeps Cloudflare's own wording — which can quote a
 * token id — out of the database and off the page (§12.6).
 */
export const CLOUDFLARE_FAILURES = [
  'unauthorized',
  'forbidden',
  'rate_limited',
  'unreachable',
  'bad_response',
  'timeout',
  'not_configured',
] as const;
