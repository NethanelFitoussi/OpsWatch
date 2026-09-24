import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * What OpsWatch sends, and how a receiver knows it was OpsWatch.
 *
 * Pure: no clock of its own, no database, no network. That is what lets the signature be tested against
 * a fixed vector rather than against itself.
 *
 * **The payload carries no credential and no raw log line.** It is the alert, the problem behind it, and
 * a link back into OpsWatch. Anything a receiver needs beyond that, it can come and read.
 */

export const SIGNATURE_HEADER = 'x-opswatch-signature';
export const TIMESTAMP_HEADER = 'x-opswatch-timestamp';
/** The signature scheme, in the signature itself, so a future one can be told apart from this one. */
export const SIGNATURE_VERSION = 'v1';

export type AlertPayload = {
  id: string;
  alertId: string;
  kind: 'alert.fired';
  severity: string;
  title: string;
  subject: string;
  environment: string;
  firedAt: number;
  /** An absolute link into this installation, or null when no public URL is configured. */
  url: string | null;
};

/**
 * The signed material: the timestamp and the exact bytes of the body.
 *
 * The timestamp is inside the signature on purpose — without it, a captured request could be replayed for
 * ever, and a receiver would have no way to notice.
 */
export function signingInput(timestampMs: number, body: string): string {
  return `${SIGNATURE_VERSION}:${timestampMs}:${body}`;
}

export function sign(timestampMs: number, body: string, secret: string): string {
  return `${SIGNATURE_VERSION}=${createHmac('sha256', secret).update(signingInput(timestampMs, body)).digest('hex')}`;
}

/**
 * Whether a signature matches — compared in constant time, because a byte-by-byte comparison tells an
 * attacker how much of their guess was right.
 */
export function verify(timestampMs: number, body: string, secret: string, presented: string): boolean {
  const expected = Buffer.from(sign(timestampMs, body, secret), 'utf8');
  const given = Buffer.from(presented, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
