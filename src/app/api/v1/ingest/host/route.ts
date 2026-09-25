import { hostAcceptedSchema, hostReportSchema, HOST_REPORT_INTERVAL_SECONDS, INGEST_LIMITS } from '@opswatch/contract';
import { apiFailure, apiJson } from '@/lib/api/v1/envelope';
import { publicApiRoute } from '@/lib/api/v1/handler';
import { env } from '@/lib/env';
import { readBody } from '@/lib/ingest/decompress';
import { INTEGRATION_HEADER, verifyRequest, type RejectReason } from '@/lib/ingest/verify';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from '@/lib/notify/payload';
import { findHost, hostClaiming, hostSecret, pruneSamples, recordReport } from '@/lib/store/hosts';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/ingest/host` — where a Linux agent reports.
 *
 * The second endpoint authenticated by a signature rather than a session, and deliberately the **same**
 * signature: `v1:<timestamp>:<body>`, HMAC-SHA256, constant-time, fresh in both directions. One scheme
 * in the codebase rather than two, because a second implementation of a signature is a second chance to
 * get it wrong.
 *
 * The order is the same and for the same reason — nothing is done on behalf of a request that has not
 * proved who it is:
 *
 *   1. size, from `content-length`, before a byte is buffered;
 *   2. the body, decompressed under zlib's own bound;
 *   3. the host is looked up and its secret read;
 *   4. the signature, over the exact bytes received;
 *   5. the schema;
 *   6. the machine's identity is checked against what this host already claims.
 *
 * **The host comes from the signature, never from the body.** An agent says what machine it is; it does
 * not get to say which host record to write into. A report whose `machineId` belongs to a different
 * host is refused rather than moved, because an agent installed twice with one secret would otherwise
 * quietly attribute one machine's readings to another.
 *
 * What it does *not* do: accept anything that could change the machine. The secret signs reports. There
 * is no command channel, no shell, and nothing in this endpoint writes back to the agent.
 */

function refusal(reason: RejectReason) {
  if (reason === 'rate_limited') return apiFailure('rate_limited', { retryAfterSeconds: 60 });
  // Everything a signature could not establish answers alike: telling a caller which check it failed is
  // telling an attacker which half of their guess was right.
  const unauthorized: RejectReason[] = ['missing_headers', 'unknown_integration', 'not_enabled', 'bad_timestamp', 'stale_timestamp', 'bad_signature'];
  return apiFailure(unauthorized.includes(reason) ? 'unauthorized' : 'invalid_request');
}

export const POST = publicApiRoute({
  mutating: true,
  handler: async ({ request, db }) => {
    const nowMs = Date.now();

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > INGEST_LIMITS.maxBodyBytes) return refusal('too_large');

    const body = readBody(new Uint8Array(await request.arrayBuffer()), request.headers.get('content-encoding'));
    if (!body.ok) return refusal(body.reason);

    const hostId = request.headers.get(INTEGRATION_HEADER);
    if (hostId === null) return refusal('missing_headers');

    const host = findHost(db, hostId);
    const secret = host === null ? null : hostSecret(db, host.id, env().OPSWATCH_SECRET);
    // One answer for "no such host" and "that host's secret cannot be read", so a caller cannot
    // enumerate which host ids exist.
    if (host === null || secret === null) return refusal('unknown_integration');

    const verified = verifyRequest({
      headers: {
        integration: hostId,
        timestamp: request.headers.get(TIMESTAMP_HEADER),
        signature: request.headers.get(SIGNATURE_HEADER),
      },
      rawBody: body.text,
      secret,
      nowMs,
    });
    if (!verified.ok) return refusal(verified.reason);

    let parsed;
    try {
      parsed = hostReportSchema.safeParse(JSON.parse(body.text));
    } catch {
      return refusal('bad_body');
    }
    if (!parsed.success) return refusal('bad_body');

    /*
     * One machine, one host.
     *
     * `machine_id` is unique, so a second host claiming a machine another already has would fail on the
     * index. Refusing it here makes the failure a stated one: an agent installed on a machine that is
     * already enrolled is a mistake to tell somebody about, not a database error — and silently moving
     * the machine would attribute one host's readings to the other.
     */
    const machineId = parsed.data.identity.machineId;
    if (machineId !== undefined && host.machineId === null) {
      const claimed = hostClaiming(db, machineId);
      if (claimed !== null && claimed.id !== host.id) return apiFailure('conflict');
    }
    // And a machine id that changed is a different machine, which is an enrolment rather than a report.
    if (machineId !== undefined && host.machineId !== null && host.machineId !== machineId) return apiFailure('conflict');

    recordReport(db, {
      hostId: host.id,
      identity: parsed.data.identity,
      sample: parsed.data.sample,
      // Passed through only when present: an older agent that does not look for services must not
      // blank what the last one found, and one that looked and found none must clear it.
      ...(parsed.data.services === undefined ? {} : { services: parsed.data.services }),
      ...(parsed.data.redis === undefined ? {} : { redis: parsed.data.redis }),
      atMs: nowMs,
    });
    // Bounded here rather than by a job: one machine reporting every five minutes must not be able to
    // fill a self-hoster's disk between nightly passes.
    pruneSamples(db, host.id);

    // The interval comes back with the answer, so changing it is a server change rather than a fleet of
    // machines to go and edit by hand.
    return apiJson(hostAcceptedSchema, { accepted: 1, nextReportSeconds: HOST_REPORT_INTERVAL_SECONDS }, 202);
  },
});
