/**
 * Everything that can go wrong talking to GitHub, as codes.
 *
 * Client-safe and separate from the API client, which is server-only: the settings page renders these. A
 * closed list is what keeps GitHub's own wording — which quotes the token's prefix in some errors — out of
 * the database and off the page (§12.6).
 */
export const GITHUB_FAILURES = [
  'unauthorized',
  'forbidden',
  'rate_limited',
  'not_found',
  'unreachable',
  'bad_response',
  'timeout',
  'not_configured',
] as const;
export type GithubFailure = (typeof GITHUB_FAILURES)[number];
