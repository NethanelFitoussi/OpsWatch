import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { batches, decode, retryable, send, sign } from '../../forwarder/index.mjs';

const SECRET = 'forwarder-secret-0123456789abcdef';
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

const config = { endpoint: 'https://opswatch.example.com/api/v1/ingest/aws/logs', integration: 'abc123def456', secret: SECRET, version: '1.0.0' };

const payload = (over = {}) => ({
  owner: '123456789012',
  logGroup: '/aws/ecs/api',
  logStream: 'api/api/abc',
  messageType: 'DATA_MESSAGE',
  logEvents: [{ id: '38970284373683705373', timestamp: NOW, message: 'ERROR boom' }],
  ...over,
});

const encoded = (over = {}) => gzipSync(Buffer.from(JSON.stringify(payload(over)))).toString('base64');

describe('reading what CloudWatch delivers', () => {
  it('decodes base64 of gzip of JSON', () => {
    expect(decode(encoded())).toMatchObject({ owner: '123456789012', logGroup: '/aws/ecs/api' });
  });

  it('THE RULING: a control message is not forwarded, because nobody wrote it', () => {
    // CloudWatch sends one to confirm a subscription. Forwarding it would deliver a record that is not a
    // log line, and OpsWatch would have no honest thing to do with it.
    expect(batches(payload({ messageType: 'CONTROL_MESSAGE' }), '1.0.0')).toEqual([]);
  });

  it('carries the account, the region, the group and the stream, so the record can be placed', () => {
    process.env.AWS_REGION = 'eu-west-1';
    const [batch] = batches(payload(), '1.0.0');
    expect(batch).toMatchObject({ source: 'aws.logs', awsAccountId: '123456789012', region: 'eu-west-1', logGroup: '/aws/ecs/api', forwarderVersion: '1.0.0' });
    expect(batch.records[0]).toMatchObject({ eventId: '38970284373683705373', logStream: 'api/api/abc', message: 'ERROR boom' });
  });

  it('splits a delivery larger than one batch, rather than sending something that will be refused', () => {
    const many = Array.from({ length: 2_500 }, (_, i) => ({ id: String(i), timestamp: NOW, message: 'x' }));
    const out = batches(payload({ logEvents: many }), '1.0.0');
    expect(out).toHaveLength(3);
    expect(out[0].records).toHaveLength(1_000);
    expect(out[2].records).toHaveLength(500);
  });

  it('truncates a line too long to accept rather than losing it', () => {
    const [batch] = batches(payload({ logEvents: [{ id: '1', timestamp: NOW, message: 'y'.repeat(50_000) }] }), '1.0.0');
    expect(batch.records[0].message).toHaveLength(32_768);
  });

  it('handles a delivery with no events at all', () => {
    expect(batches(payload({ logEvents: [] }), '1.0.0')).toEqual([]);
  });
});

describe('signing', () => {
  it('produces what OpsWatch verifies, over the uncompressed bytes', async () => {
    const { verify } = await import('@/lib/notify/payload');
    const body = JSON.stringify({ hello: 'world' });
    expect(verify(NOW, body, SECRET, sign(NOW, body, SECRET))).toBe(true);
  });

  it('THE RULING: a different body or a different secret does not verify', async () => {
    const { verify } = await import('@/lib/notify/payload');
    const body = JSON.stringify({ hello: 'world' });
    expect(verify(NOW, '{"hello":"WORLD"}', SECRET, sign(NOW, body, SECRET))).toBe(false);
    expect(verify(NOW, body, 'other-secret', sign(NOW, body, SECRET))).toBe(false);
  });
});

describe('delivering', () => {
  const ok = () => new Response(JSON.stringify({ accepted: 1, duplicate: 0 }), { status: 200 });
  const sleep = () => Promise.resolve();

  it('sends the batch gzipped, signed, and with the headers OpsWatch reads', async () => {
    let seen: { url: string; init: { headers: Record<string, string> } } = { url: '', init: { headers: {} } };
    const fetchSpy = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      seen = { url, init };
      return ok();
    });
    await send(batches(payload(), '1.0.0')[0], config, { fetch: fetchSpy, sleep });

    expect(seen.url).toBe(config.endpoint);
    expect(seen.init.headers['content-encoding']).toBe('gzip');
    expect(seen.init.headers['x-opswatch-integration']).toBe('abc123def456');
    expect(seen.init.headers['x-opswatch-signature']).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(seen.init.headers['user-agent']).toBe('OpsWatchForwarder/1.0.0');
  });

  it('THE RULING: the secret is never in a header, a body or an error', async () => {
    // A Lambda writes its logs to CloudWatch, and a secret in CloudWatch is a secret in the customer's
    // log retention policy for ever.
    let seen: unknown;
    const fetchSpy = vi.fn(async (url: string, init: unknown) => {
      seen = { url, init };
      return new Response('nope', { status: 401 });
    });
    await expect(send(batches(payload(), '1.0.0')[0], config, { fetch: fetchSpy, sleep })).rejects.toThrow();
    expect(JSON.stringify(seen)).not.toContain(SECRET);

    const error = await send(batches(payload(), '1.0.0')[0], config, { fetch: fetchSpy, sleep }).catch((e) => e);
    expect(String(error.message)).not.toContain(SECRET);
    expect(String(error.stack ?? '')).not.toContain(SECRET);
  });

  it('THE RULING: it retries what is worth retrying and gives up on what is not', async () => {
    expect(retryable(429)).toBe(true);
    expect(retryable(500)).toBe(true);
    expect(retryable(503)).toBe(true);
    // A 400 or a 401 is a configuration mistake. Retrying it wastes an invocation and delays the error
    // being noticed.
    expect(retryable(400)).toBe(false);
    expect(retryable(401)).toBe(false);
    expect(retryable(403)).toBe(false);

    const refuses = vi.fn(async () => new Response('bad', { status: 400 }));
    await expect(send(batches(payload(), '1.0.0')[0], config, { fetch: refuses, sleep })).rejects.toThrow(/HTTP 400/);
    expect(refuses).toHaveBeenCalledTimes(1);
  });

  it('succeeds on a retry after a throttle, rather than losing the batch', async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? new Response('slow down', { status: 429 }) : ok();
    });
    expect(await send(batches(payload(), '1.0.0')[0], config, { fetch: flaky, sleep })).toMatchObject({ accepted: 1 });
    expect(flaky).toHaveBeenCalledTimes(3);
  });

  it('THE RULING: it gives up rather than looping, so the dead-letter queue gets its turn', async () => {
    const always = vi.fn(async () => new Response('busy', { status: 503 }));
    await expect(send(batches(payload(), '1.0.0')[0], config, { fetch: always, sleep })).rejects.toThrow(/HTTP 503/);
    // Bounded: four attempts, not an invocation that times out with no record of why.
    expect(always).toHaveBeenCalledTimes(4);
  });

  it('treats a network failure as retryable, and names the class rather than the cause', async () => {
    const broken = vi.fn(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND opswatch.example.com'), { name: 'TypeError' });
    });
    const error = await send(batches(payload(), '1.0.0')[0], config, { fetch: broken, sleep }).catch((e) => e);
    expect(broken).toHaveBeenCalledTimes(4);
    expect(error.message).toContain('network');
    // Not the resolver's message, which is the habit that eventually puts a request detail in a log.
    expect(error.message).not.toContain('ENOTFOUND');
  });

  it('names a timeout as a timeout', async () => {
    const slow = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    const error = await send(batches(payload(), '1.0.0')[0], config, { fetch: slow, sleep }).catch((e) => e);
    expect(error.message).toContain('timeout');
  });
});
