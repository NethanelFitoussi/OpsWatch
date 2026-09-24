import { gzipSync } from 'node:zlib';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INGEST_LIMITS } from '@opswatch/contract';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

const state = vi.hoisted(() => ({ db: undefined as unknown as Db }));

vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'https://opswatch.example.com' }) }));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.db,
}));

const { POST } = await import('@/app/api/v1/ingest/aws/logs/route');
const { createConnection } = await import('@/lib/connections/repository');
const { encrypt } = await import('@/lib/crypto');
const { sign } = await import('@/lib/notify/payload');
const { dueIngestEvents, readIngestTraffic, upsertForwardedGroup, writeCollection } = await import('@/lib/store/collection');

const ACCOUNT = '123456789012';
const REGION = 'eu-west-1';
const GROUP = '/aws/ecs/api';
const INGEST_SECRET = 'forwarder-secret-0123456789';

/**
 * A connection with managed collection on, real-time logs on, a secret, and one enabled log group.
 * Every test that wants a refusal takes something away from this.
 */
function ready(over: { managed?: boolean; realtimeLogs?: boolean; secret?: string | null; groupState?: 'active' | 'pending' } = {}) {
  const db = state.db;
  const connection = createConnection(db, { name: 'prod', method: 'role', awsAccountId: ACCOUNT, regions: [REGION] });
  writeCollection(
    db,
    connection.id,
    {
      managed: over.managed ?? true,
      realtimeLogs: over.realtimeLogs ?? true,
      ingestSecretCiphertext:
        over.secret === null ? null : encrypt(over.secret ?? INGEST_SECRET, SECRET, 'aws-ingest'),
    },
    NOW,
  );
  upsertForwardedGroup(
    db,
    { connectionId: connection.id, region: REGION, logGroup: GROUP, filterName: `OpsWatch-${connection.id}`, state: over.groupState ?? 'active', lastError: null },
    NOW,
  );
  return connection.id;
}

const batch = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    source: 'aws.logs',
    forwarderVersion: '1.0.0',
    awsAccountId: ACCOUNT,
    region: REGION,
    logGroup: GROUP,
    sentAt: Date.now(),
    records: [{ eventId: '1', at: Date.now(), message: 'ERROR boom', logStream: 'api/api/abc' }],
    ...over,
  });

function post(
  integration: string | null,
  body: string | Uint8Array,
  options: { secret?: string; at?: number; headers?: Record<string, string>; signOver?: string } = {},
) {
  const at = options.at ?? Date.now();
  const signed = options.signOver ?? (typeof body === 'string' ? body : '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-opswatch-timestamp': String(at),
    'x-opswatch-signature': sign(at, signed, options.secret ?? INGEST_SECRET),
    ...options.headers,
  };
  if (integration !== null) headers['x-opswatch-integration'] = integration;
  return POST(new NextRequest('http://localhost/api/v1/ingest/aws/logs', { method: 'POST', headers, body: body as BodyInit }), {
    params: Promise.resolve({} as Record<string, never>),
  });
}

beforeEach(() => {
  state.db = createTestDb();
});

describe('a forwarder that proves who it is', () => {
  it('queues the records and says how many were new', async () => {
    const id = ready();
    const response = await post(id, batch());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1, duplicate: 0, serverForwarderVersion: '1.0.0' });
    // Queued, not processed: 202 rather than 201, because the work has not happened yet.
    expect(dueIngestEvents(state.db, 10)).toHaveLength(1);
  });

  it('THE RULING: a replayed batch is recognised, not stored twice', async () => {
    const id = ready();
    const body = batch();
    await post(id, body);
    const again = await post(id, body);
    expect(await again.json()).toMatchObject({ accepted: 0, duplicate: 1 });
    expect(dueIngestEvents(state.db, 10)).toHaveLength(1);
  });

  it('reads a gzipped body, because egress costs the operator money', async () => {
    const id = ready();
    const body = batch();
    const response = await post(id, gzipSync(Buffer.from(body)), {
      headers: { 'content-encoding': 'gzip' },
      signOver: body,
    });
    expect(response.status).toBe(202);
  });

  it('counts what arrived, so health survives the records being discarded', async () => {
    const id = ready();
    await post(id, batch());
    expect(readIngestTraffic(state.db, id, Date.now() - 60_000)).toMatchObject({ events: 1, rejected: 0 });
  });
});

describe('THE RULING: a caller that cannot prove who it is learns nothing else', () => {
  it('answers the same for an unknown integration and one that is not accepting anything', async () => {
    const off = ready({ managed: false });
    const unknown = await post('does-not-exist-at-all', batch());
    const disabled = await post(off, batch());
    expect(unknown.status).toBe(401);
    expect(disabled.status).toBe(401);
    // Identical bodies: a caller must not be able to enumerate which connection ids exist.
    expect(await unknown.json()).toEqual(await disabled.json());
  });

  it('refuses a forged signature, a stale one and a missing one alike', async () => {
    const id = ready();
    for (const attempt of [
      () => post(id, batch(), { secret: 'not-the-secret' }),
      () => post(id, batch(), { at: Date.now() - INGEST_LIMITS.clockSkewMs - 10_000 }),
      () => post(id, batch(), { at: Date.now() + INGEST_LIMITS.clockSkewMs + 10_000 }),
      () => post(id, batch(), { headers: { 'x-opswatch-signature': '' } }),
      () => post(null, batch()),
    ]) {
      const response = await attempt();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('THE RULING: a signature over different bytes than were sent does not pass', async () => {
    const id = ready();
    const response = await post(id, batch({ logGroup: '/somewhere/else' }), { signOver: batch() });
    expect(response.status).toBe(401);
  });

  it('refuses everything while real-time logs are off, even with a perfect signature', async () => {
    // Managed collection on and the log source off is not a connection expecting log records.
    const id = ready({ realtimeLogs: false });
    expect((await post(id, batch())).status).toBe(401);
  });

  it('refuses when no secret has ever been issued', async () => {
    const id = ready({ secret: null });
    expect((await post(id, batch())).status).toBe(401);
  });
});

describe('THE RULING: a forwarder cannot deliver into an account or a group that is not its own', () => {
  it('refuses a body claiming a different AWS account', async () => {
    const id = ready();
    // A forwarder copied into a second account must not reach the first one's data by saying it is there.
    const response = await post(id, batch({ awsAccountId: '210987654321' }));
    expect(response.status).toBe(400);
    expect(dueIngestEvents(state.db, 10)).toEqual([]);
  });

  it('refuses a region this connection does not have', async () => {
    const id = ready();
    // The group is enabled in that region too, so only the region check can refuse this: without it the
    // record would be filed under a region the operator never connected.
    upsertForwardedGroup(
      state.db,
      { connectionId: id, region: 'ap-south-1', logGroup: GROUP, filterName: `OpsWatch-${id}`, state: 'active', lastError: null },
      NOW,
    );
    expect((await post(id, batch({ region: 'ap-south-1' }))).status).toBe(400);
    expect(dueIngestEvents(state.db, 10)).toEqual([]);
  });

  it('refuses a log group nobody ticked, and one that is not active yet', async () => {
    const id = ready();
    expect((await post(id, batch({ logGroup: '/aws/ecs/never-selected' }))).status).toBe(400);
    expect(dueIngestEvents(state.db, 10)).toEqual([]);

    const pending = ready({ groupState: 'pending' });
    expect((await post(pending, batch())).status).toBe(400);
  });

  it('counts a refusal it could attribute, so a misconfigured forwarder is visible', async () => {
    const id = ready();
    await post(id, batch({ awsAccountId: '210987654321' }));
    expect(readIngestTraffic(state.db, id, Date.now() - 60_000)).toMatchObject({ rejected: 1, events: 0 });
  });
});

describe('THE RULING: an authenticated caller is still bounded', () => {
  it('refuses a body larger than the limit', async () => {
    const id = ready();
    const huge = 'x'.repeat(INGEST_LIMITS.maxBodyBytes + 10);
    expect((await post(id, huge)).status).toBe(400);
  });

  it('THE RULING: a declared size over the limit is refused before the body is buffered', async () => {
    // Everything else about this request is perfect, and the only thing wrong is what it says it weighs.
    // Without the header check it would be accepted — and in production a caller could declare a gigabyte
    // and have it buffered before anybody objected.
    const id = ready();
    const response = await post(id, batch(), { headers: { 'content-length': String(INGEST_LIMITS.maxBodyBytes + 1) } });
    expect(response.status).toBe(400);
    expect(dueIngestEvents(state.db, 10)).toEqual([]);
  });

  it('refuses a gzip bomb at the decompressor', async () => {
    const id = ready();
    const bomb = gzipSync(Buffer.alloc(INGEST_LIMITS.maxDecompressedBytes + 1_000_000, 0));
    const response = await post(id, bomb, { headers: { 'content-encoding': 'gzip' } });
    expect(response.status).toBe(400);
  });

  it('refuses a body that is not the shape it promised', async () => {
    const id = ready();
    for (const body of ['not json at all', '{}', batch({ records: [] }), batch({ source: 'aws.metrics' })]) {
      const response = await post(id, body);
      expect(response.status, body.slice(0, 30)).toBe(400);
    }
    expect(dueIngestEvents(state.db, 10)).toEqual([]);
  });

  it('rate limits per integration, and says how long to wait', async () => {
    const id = ready();
    const { recordIngestStat } = await import('@/lib/store/collection');
    // Fill this minute's budget without sending a thousand requests.
    recordIngestStat(state.db, id, REGION, Date.now(), { events: 1_000 });
    const response = await post(id, batch());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });
});

describe('THE RULING: one integration’s forwarder cannot reach another’s data', () => {
  it('stores under the integration the signature identified, never the one the body claims', async () => {
    const first = ready();
    const second = createConnection(state.db, { name: 'other', method: 'role', awsAccountId: '210987654321', regions: [REGION] });
    writeCollection(state.db, second.id, { managed: true, realtimeLogs: true, ingestSecretCiphertext: encrypt('other-secret', SECRET, 'aws-ingest') }, NOW);
    upsertForwardedGroup(
      state.db,
      { connectionId: second.id, region: REGION, logGroup: GROUP, filterName: `OpsWatch-${second.id}`, state: 'active', lastError: null },
      NOW,
    );

    // The second integration's own forwarder, correctly signed, talking about its own account.
    await post(second.id, batch({ awsAccountId: '210987654321' }), { secret: 'other-secret' });
    const stored = dueIngestEvents(state.db, 10);
    expect(stored).toHaveLength(1);
    expect(stored[0].connectionId).toBe(second.id);
    expect(readIngestTraffic(state.db, first, Date.now() - 60_000).events).toBe(0);
  });

  it('cannot sign for another integration with its own secret', async () => {
    const first = ready();
    const second = createConnection(state.db, { name: 'other', method: 'role', awsAccountId: '210987654321', regions: [REGION] });
    writeCollection(state.db, second.id, { managed: true, realtimeLogs: true, ingestSecretCiphertext: encrypt('other-secret', SECRET, 'aws-ingest') }, NOW);
    // Presenting the first integration's id, signed with the second's secret.
    expect((await post(first, batch(), { secret: 'other-secret' })).status).toBe(401);
  });
});
