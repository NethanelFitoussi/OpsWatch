import { INGEST_LIMITS, ingestAcceptedSchema, ingestLogsRequestSchema } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { publicApiRoute } from '@/lib/api/v1/handler';
import { findConnection } from '@/lib/connections/repository';
import { DecryptionError, decrypt } from '@/lib/crypto';
import type { Db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { readBody } from '@/lib/ingest/decompress';
import { FORWARDER_VERSION } from '@/lib/ingest/forwarder-version';
import { ingestEventId } from '@/lib/ingest/identity';
import { INGEST_RATE_PER_MINUTE, INTEGRATION_HEADER, verifyRequest, type RejectReason } from '@/lib/ingest/verify';
import {
  listForwardedGroups,
  readCollection,
  recordIngestStat,
  requestsThisMinute,
  storeIngestEvents,
} from '@/lib/store/collection';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from '@/lib/notify/payload';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/ingest/aws/logs` — where a forwarder delivers.
 *
 * **The only endpoint in OpsWatch that is authenticated by a signature rather than by a session**, because
 * the caller is a Lambda in somebody else's AWS account and there is nobody to sign in as. Everything it
 * does, it does in an order chosen so that work is never done on behalf of a request that has not proved
 * who it is:
 *
 *   1. size, from `content-length`, before a byte is buffered;
 *   2. the body is read — decompressed under zlib's own bound, so a gzip bomb dies in the decompressor;
 *   3. the integration is looked up, and must have managed collection **and** the log source switched on;
 *   4. the signature, over the exact bytes received, with a timestamp fresh in both directions;
 *   5. the rate limit, which is per integration and therefore only knowable once step 3 succeeded;
 *   6. the schema;
 *   7. the account, the region and the log group are checked against what this integration actually has.
 *      A forwarder copied into a second AWS account cannot deliver into the first one's data by claiming
 *      to be there, and a log group nobody ticked is refused even from a perfectly signed request.
 *
 * Only then is anything stored, and what is stored is a bounded insert that ignores what it already has.
 *
 * **What the answer says.** A caller that cannot prove who it is gets `unauthorized` and learns nothing
 * else: not whether the integration exists, not whether the timestamp or the signature was the problem.
 * The distinction is in this instance's own counters, not in the response.
 */

function refusal(reason: RejectReason) {
  if (reason === 'rate_limited') return apiFailure('rate_limited', { retryAfterSeconds: 60 });
  // Everything a signature could not establish answers alike. Telling a caller which check it failed is
  // telling an attacker which half of their guess was right.
  const unauthorized: RejectReason[] = ['missing_headers', 'unknown_integration', 'not_enabled', 'bad_timestamp', 'stale_timestamp', 'bad_signature'];
  return apiFailure(unauthorized.includes(reason) ? 'unauthorized' : 'invalid_request');
}

/** The integration's signing secret, or null. Null for every reason a forwarder must not be able to tell apart. */
function secretOf(db: Db, connectionId: string): string | null {
  const collection = readCollection(db, connectionId);
  // Both switches, not one: a connection with managed collection on and real-time logs off is not
  // expecting log records, and accepting them would be accepting data nobody asked to send.
  if (!collection.managed || !collection.realtimeLogs || collection.ingestSecretCiphertext === null) return null;
  try {
    return decrypt(collection.ingestSecretCiphertext, env().OPSWATCH_SECRET, 'aws-ingest');
  } catch (error) {
    // A secret encrypted under a different OPSWATCH_SECRET cannot be read, which is a configuration fact
    // rather than an authentication failure — but it is still a forwarder that cannot be authenticated.
    if (error instanceof DecryptionError) return null;
    throw error;
  }
}

export const POST = publicApiRoute({
  mutating: true,
  handler: async ({ request, db }) => {
    const nowMs = Date.now();

    // Refused unread. A `content-length` that lies is caught by the byte length below.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > INGEST_LIMITS.maxBodyBytes) return refusal('too_large');

    const body = readBody(new Uint8Array(await request.arrayBuffer()), request.headers.get('content-encoding'));
    if (!body.ok) return refusal(body.reason);

    const integration = request.headers.get(INTEGRATION_HEADER);
    if (integration === null) return refusal('missing_headers');

    const connection = findConnection(db, integration);
    const secret = connection === null ? null : secretOf(db, connection.id);
    // Identical answers for "no such integration" and "that integration is not accepting anything", so a
    // caller cannot enumerate which connection ids exist.
    if (connection === null || secret === null) return refusal('unknown_integration');

    const verified = verifyRequest({
      headers: {
        integration,
        timestamp: request.headers.get(TIMESTAMP_HEADER),
        signature: request.headers.get(SIGNATURE_HEADER),
      },
      rawBody: body.text,
      secret,
      nowMs,
    });
    if (!verified.ok) return refusal(verified.reason);

    // Per integration, and therefore only knowable now. An authenticated client is still a client that
    // can be wrong, and an unbounded one can fill a disk.
    if (requestsThisMinute(db, connection.id, nowMs) >= INGEST_RATE_PER_MINUTE) return refusal('rate_limited');

    let parsed;
    try {
      parsed = ingestLogsRequestSchema.parse(JSON.parse(body.text));
    } catch {
      recordIngestStat(db, connection.id, 'unknown', nowMs, { rejected: 1 });
      return refusal('bad_body');
    }

    // The signature proves which integration sent this. These three prove it is talking about itself.
    if (parsed.awsAccountId !== connection.awsAccountId) {
      recordIngestStat(db, connection.id, parsed.region, nowMs, { rejected: 1 });
      return refusal('wrong_account');
    }
    if (!connection.regions.includes(parsed.region)) {
      recordIngestStat(db, connection.id, parsed.region, nowMs, { rejected: 1 });
      return refusal('unknown_region');
    }
    // A log group nobody ticked is refused even from a perfectly signed request: the operator chose which
    // groups may be forwarded, and a forwarder cannot widen that by sending more.
    const enabled = listForwardedGroups(db, connection.id, parsed.region).some(
      (group) => group.logGroup === parsed.logGroup && group.state === 'active',
    );
    if (!enabled) {
      recordIngestStat(db, connection.id, parsed.region, nowMs, { rejected: 1 });
      return refusal('bad_body');
    }

    const stored = storeIngestEvents(
      db,
      parsed.records.map((record) => ({
        id: ingestEventId({
          awsAccountId: parsed.awsAccountId,
          region: parsed.region,
          logGroup: parsed.logGroup,
          logStream: record.logStream,
          eventId: record.eventId,
        }),
        connectionId: connection.id,
        region: parsed.region,
        source: parsed.source,
        logGroup: parsed.logGroup,
        logStream: record.logStream,
        at: record.at,
        message: record.message,
        receivedAt: nowMs,
      })),
    );

    recordIngestStat(db, connection.id, parsed.region, nowMs, {
      events: stored.accepted,
      duplicates: stored.duplicate,
      bytes: body.text.length,
    });

    // 202: it is queued, not processed. The drain job is what processes it, and saying "created" would be
    // claiming work that has not happened.
    return apiJson(ingestAcceptedSchema, { ...stored, serverForwarderVersion: FORWARDER_VERSION }, 202);
  },
});
