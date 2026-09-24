import { INGEST_LIMITS } from '@opswatch/contract';
import { verify } from '../notify/payload';

/**
 * Deciding whether to read a request at all.
 *
 * Everything here happens **before** the body is parsed as anything but bytes. A request that cannot prove
 * who sent it is refused unread, and so is one that is too large, too old or too far in the future.
 *
 * The signature scheme is the one the product already has for outbound webhooks — `v1:<timestamp>:<body>`,
 * HMAC-SHA256, compared in constant time. One scheme in the codebase rather than two: it is already tested
 * against fixed vectors, and a second implementation of a signature is a second chance to get it wrong.
 *
 * Pure apart from the HMAC: the clock is an argument.
 */

export const INTEGRATION_HEADER = 'x-opswatch-integration';

/**
 * Why a request was refused.
 *
 * Deliberately coarse on the wire. A caller that cannot sign learns that it cannot sign — not whether the
 * integration exists, not whether the secret is close, not whether the timestamp or the signature was the
 * problem. The instance's own logs carry the distinction; the response does not.
 */
export type RejectReason =
  | 'missing_headers'
  | 'unknown_integration'
  | 'not_enabled'
  | 'bad_timestamp'
  | 'stale_timestamp'
  | 'bad_signature'
  | 'too_large'
  | 'bad_body'
  | 'wrong_account'
  | 'unknown_region'
  | 'rate_limited';

export type Headers = {
  integration: string | null;
  timestamp: string | null;
  signature: string | null;
};

/**
 * Whether a timestamp is close enough to now.
 *
 * Both directions. A request from the future is not a harmless clock skew — a captured request replayed
 * with a timestamp far ahead would otherwise stay valid for as long as the attacker chose.
 */
export function timestampIsFresh(timestampMs: number, nowMs: number, skewMs = INGEST_LIMITS.clockSkewMs): boolean {
  return Number.isFinite(timestampMs) && Math.abs(nowMs - timestampMs) <= skewMs;
}

/**
 * The whole decision, given the raw body and the secret this integration signs with.
 *
 * The body is the **exact bytes received**. Re-serialising a parsed object before checking the signature
 * would be verifying a string the sender never saw, and is the classic way a signature check becomes
 * decorative.
 */
export function verifyRequest(input: {
  headers: Headers;
  rawBody: string;
  secret: string;
  nowMs: number;
}): { ok: true; timestampMs: number } | { ok: false; reason: RejectReason } {
  const { integration, timestamp, signature } = input.headers;
  if (integration === null || timestamp === null || signature === null) return { ok: false, reason: 'missing_headers' };

  const timestampMs = Number(timestamp);
  if (!Number.isInteger(timestampMs)) return { ok: false, reason: 'bad_timestamp' };
  if (!timestampIsFresh(timestampMs, input.nowMs)) return { ok: false, reason: 'stale_timestamp' };

  // Last, and only once the timestamp is known to be fresh: a signature check on an old request is work
  // done for an attacker.
  if (!verify(timestampMs, input.rawBody, input.secret, signature)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, timestampMs };
}

/**
 * How many requests one integration may make in a minute.
 *
 * Generous, because a busy account legitimately delivers often, and bounded, because an authenticated
 * client is still a client that can be wrong. A batch is up to a thousand records, so this is a million
 * records a minute before anything is refused.
 */
export const INGEST_RATE_PER_MINUTE = 1_000;
