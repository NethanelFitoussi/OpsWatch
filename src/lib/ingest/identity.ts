import { createHash } from 'node:crypto';

/**
 * Giving a forwarded record an identity AWS did not give it.
 *
 * CloudWatch delivers **at least once**: a Lambda that times out after OpsWatch has already stored the
 * batch is retried, and the same records arrive again. Exactly-once delivery is not on offer, so the
 * defence is a stable id and a unique index — a replay becomes a no-op insert rather than a duplicate log
 * line an operator has to reason about.
 *
 * The id is *derived*, never generated: two deliveries of the same record must produce the same id on two
 * different days, in two different processes, without either of them having seen the other.
 *
 * Pure: no clock, no database, no network.
 */

/**
 * The id of one forwarded record.
 *
 * Every part that identifies where a record came from is in it. `eventId` alone would be enough within one
 * log group — CloudWatch's ids are unique there — but not across accounts, and an id that collides across
 * two customers' accounts is the one failure this whole scheme exists to prevent.
 *
 * The separator is a character that cannot appear in any of the parts, so `a|b` and `ab|` cannot hash the
 * same: an account id is digits, a region and a log group and a stream have no NUL in them, and AWS's
 * event ids are decimal.
 */
export function ingestEventId(input: {
  awsAccountId: string;
  region: string;
  logGroup: string;
  logStream: string;
  eventId: string;
}): string {
  const material = [input.awsAccountId, input.region, input.logGroup, input.logStream, input.eventId].join('\u0000');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/** The minute a record was received in, UTC, which is the bucket its traffic is counted in. */
export const MINUTE_MS = 60_000;
export const minuteOf = (atMs: number) => Math.floor(atMs / MINUTE_MS) * MINUTE_MS;
