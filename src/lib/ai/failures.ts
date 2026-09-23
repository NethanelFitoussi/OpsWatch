/**
 * Everything that can go wrong talking to a provider, as codes.
 *
 * Client-safe and separate from `lib/ai/client.ts` on purpose: the settings page renders these, and the
 * module that sends the request is server-only. A closed list is what keeps a provider's own wording — which
 * can echo an API key back — out of the database and off the page (§12.6).
 */
export const AI_FAILURES = [
  'unauthorized',
  'rate_limited',
  'unreachable',
  'refused_endpoint',
  'bad_response',
  'timeout',
  'not_configured',
] as const;
export type AiFailure = (typeof AI_FAILURES)[number];
