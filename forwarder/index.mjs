import { createHmac } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * The OpsWatch Forwarder.
 *
 * A CloudWatch Logs subscription filter invokes this with a batch of log events; it hands them to one
 * OpsWatch instance over HTTPS, signed. That is the whole job. Everything about what a log line *means*
 * lives in OpsWatch, where it can be changed without redeploying a Lambda into somebody's account.
 *
 * Four things it is careful about:
 *
 *   - **It never logs the secret.** Not on success, not on failure, not in an error it rethrows. A Lambda
 *     writes its logs to CloudWatch, and a secret in CloudWatch is a secret in the customer's log
 *     retention policy for ever.
 *   - **It retries only what is worth retrying.** 429 and 5xx and a network failure, with bounded
 *     exponential backoff. A 400 or a 401 is a configuration mistake; retrying it wastes an invocation
 *     and delays the error being noticed.
 *   - **It gives up rather than looping.** After the last attempt it throws, which is how Lambda's own
 *     retry and the dead-letter queue get their turn. An infinite retry inside one invocation is a
 *     timeout with no record of why.
 *   - **It sends no more than OpsWatch accepts.** The batch size here is the endpoint's own limit.
 */

const MAX_RECORDS = 1000;
const MAX_MESSAGE = 32768;
const ATTEMPTS = 4;
const BACKOFF_MS = [200, 1000, 4000];
const TIMEOUT_MS = 10000;

/** The signed material, exactly as OpsWatch verifies it: version, timestamp, and the bytes of the body. */
export function sign(timestampMs, body, secret) {
  return `v1=${createHmac('sha256', secret).update(`v1:${timestampMs}:${body}`).digest('hex')}`;
}

/** A CloudWatch Logs subscription payload: base64 of gzip of JSON. */
export function decode(data) {
  return JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString('utf8'));
}

/**
 * The batches to send for one decoded payload.
 *
 * A control message is CloudWatch confirming the subscription and carries no log data; forwarding it
 * would be delivering a record nobody wrote. Messages are truncated here rather than rejected by
 * OpsWatch, because a line too long to accept is still a line worth seeing the start of.
 */
export function batches(payload, version) {
  if (payload.messageType === 'CONTROL_MESSAGE') return [];
  const events = payload.logEvents ?? [];
  const out = [];
  for (let i = 0; i < events.length; i += MAX_RECORDS) {
    out.push({
      source: 'aws.logs',
      forwarderVersion: version,
      awsAccountId: payload.owner,
      region: process.env.AWS_REGION,
      logGroup: payload.logGroup,
      sentAt: Date.now(),
      records: events.slice(i, i + MAX_RECORDS).map((event) => ({
        eventId: String(event.id),
        at: event.timestamp,
        message: String(event.message).slice(0, MAX_MESSAGE),
        logStream: payload.logStream,
      })),
    });
  }
  return out;
}

/** Whether an answer is worth trying again. Everything else is a mistake, and repeating it will not fix it. */
export const retryable = (status) => status === 429 || status >= 500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one batch, retrying what is worth retrying.
 *
 * `fetchImpl` and `sleep` are arguments so the retry behaviour can be tested without a network and
 * without waiting seconds for a backoff.
 */
export async function send(batch, config, deps = {}) {
  const post = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? wait;
  const body = JSON.stringify(batch);
  const compressed = gzipSync(Buffer.from(body));
  let last = 'no attempt was made';

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const at = Date.now();
    try {
      const response = await post(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'x-opswatch-integration': config.integration,
          'x-opswatch-timestamp': String(at),
          // Signed over the uncompressed bytes, which is what OpsWatch reads after decompressing.
          'x-opswatch-signature': sign(at, body, config.secret),
          'user-agent': `OpsWatchForwarder/${config.version}`,
        },
        body: compressed,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return await response.json().catch(() => ({}));
      last = `HTTP ${response.status}`;
      if (!retryable(response.status)) break;
    } catch (error) {
      // The class of failure, never the message: a fetch error can carry the URL, and the URL is not a
      // secret but the habit of putting request detail into logs is how one eventually appears there.
      last = error?.name === 'TimeoutError' ? 'timeout' : 'network';
    }
    if (attempt < ATTEMPTS - 1) await sleep(BACKOFF_MS[attempt]);
  }
  // Thrown, so Lambda retries the invocation and then sends it to the dead-letter queue. The message
  // names what happened and nothing else.
  throw new Error(`OpsWatch ingestion failed: ${last}`);
}

export const handler = async (event) => {
  const config = {
    endpoint: process.env.OPSWATCH_ENDPOINT,
    integration: process.env.OPSWATCH_INTEGRATION,
    secret: process.env.OPSWATCH_SECRET,
    version: process.env.OPSWATCH_FORWARDER_VERSION ?? '0.0.0',
  };
  if (!config.endpoint || !config.integration || !config.secret) {
    throw new Error('OpsWatch forwarder is not configured');
  }
  // HTTPS only. A subscription that somehow pointed at plain HTTP would be signing a request anybody on
  // the path could read, and the signature protects integrity rather than confidentiality.
  if (!config.endpoint.startsWith('https://')) throw new Error('OpsWatch endpoint must be https');

  let accepted = 0;
  for (const batch of batches(decode(event.awslogs.data), config.version)) {
    const answer = await send(batch, config);
    accepted += answer?.accepted ?? 0;
  }
  return { accepted };
};
