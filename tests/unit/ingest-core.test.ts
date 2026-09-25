import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { INGEST_LIMITS, ingestLogsRequestSchema } from '@opswatch/contract';
import { ingestEventId, minuteOf } from '@/lib/ingest/identity';
import { filterNameFor, isOpsWatchFilter } from '@/lib/monitoring/shared/filter-name';
import { INGEST_RATE_PER_MINUTE, timestampIsFresh, verifyRequest } from '@/lib/ingest/verify';
import { readBody } from '@/lib/ingest/decompress';
import { sign } from '@/lib/notify/payload';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const SECRET = 'ingest-secret-0123456789abcdef';

const event = (over: Record<string, string> = {}) => ({
  awsAccountId: '123456789012',
  connectionId: '6d293fe0d4b3',
  region: 'eu-west-1',
  logGroup: '/aws/ecs/api',
  logStream: 'api/api/abc',
  eventId: '38970284373683705373',
  ...over,
});

describe('giving a forwarded record an identity', () => {
  it('THE RULING: the same record twice is the same id, so a replay is a no-op', () => {
    // AWS delivers at least once. Exactly-once is not on offer; a stable id is the whole defence.
    expect(ingestEventId(event())).toBe(ingestEventId(event()));
  });

  it('THE RULING: the same CloudWatch event id in two accounts is two different records', () => {
    // An id that collides across two customers' accounts is the one failure this scheme exists to prevent.
    expect(ingestEventId(event())).not.toBe(ingestEventId(event({ awsAccountId: '210987654321' })));
    expect(ingestEventId(event())).not.toBe(ingestEventId(event({ region: 'us-east-1' })));
    expect(ingestEventId(event())).not.toBe(ingestEventId(event({ logGroup: '/aws/ecs/other' })));
    expect(ingestEventId(event())).not.toBe(ingestEventId(event({ logStream: 'other' })));
    expect(ingestEventId(event())).not.toBe(ingestEventId(event({ eventId: '1' })));
  });

  it('THE RULING: two OpsWatch connections on one AWS account keep their own copies of a record', () => {
    /*
     * Two connections may legitimately point at the same account — a role-based one and a break-glass
     * one with access keys, or two with overlapping regions. Both forward the same records and both
     * authenticate. Without the connection in the id the second one's records were swallowed as
     * duplicates of the first's, counted under `duplicates` for a connection that would never show a
     * single error group: silent data loss, of the kind that looks like everything working.
     */
    expect(ingestEventId(event())).not.toBe(ingestEventId(event({ connectionId: 'aaaaaaaaaaaa' })));
    // And it is still the same id for the same connection, so a replay is still a no-op insert.
    expect(ingestEventId(event({ connectionId: 'aaaaaaaaaaaa' }))).toBe(ingestEventId(event({ connectionId: 'aaaaaaaaaaaa' })));
  });

  it('THE RULING: two different splits of the same characters are two different ids', () => {
    // The separator must be a character that cannot appear in any part. Joined on `|`, a log group named
    // `a|b` beside stream `c` would hash identically to group `a` beside stream `b|c` — two different
    // records with one id. A log group name may contain `|`; it may not contain NUL.
    expect(ingestEventId(event({ logGroup: 'a|b', logStream: 'c' }))).not.toBe(
      ingestEventId(event({ logGroup: 'a', logStream: 'b|c' })),
    );
    expect(ingestEventId(event({ logGroup: 'a/b', logStream: 'c' }))).not.toBe(
      ingestEventId(event({ logGroup: 'a', logStream: 'b/c' })),
    );
  });

  it('is short enough to index and long enough not to collide', () => {
    expect(ingestEventId(event())).toMatch(/^[0-9a-f]{32}$/);
  });

  it('buckets traffic by the minute it arrived in', () => {
    expect(minuteOf(NOW + 59_999)).toBe(NOW);
    expect(minuteOf(NOW + 60_000)).toBe(NOW + 60_000);
  });
});

describe('a subscription filter OpsWatch owns', () => {
  it('carries the connection so two instances watching one account do not fight', () => {
    expect(filterNameFor('abc123def456')).toBe('OpsWatch-abc123def456');
    expect(isOpsWatchFilter(filterNameFor('abc123def456'))).toBe(true);
  });

  it('THE RULING: another vendor’s filter is never mistaken for one of ours', () => {
    for (const name of ['DatadogForwarder', 'my-opswatch-filter', 'opswatch-lowercase', '']) {
      expect(isOpsWatchFilter(name), name).toBe(false);
    }
  });
});

describe('deciding whether to read a request at all', () => {
  const headersFor = (body: string, atMs = NOW, secret = SECRET) => ({
    integration: 'abc123def456',
    timestamp: String(atMs),
    signature: sign(atMs, body, secret),
  });

  it('accepts a request signed with this integration’s secret', () => {
    const body = '{"hello":"world"}';
    expect(verifyRequest({ headers: headersFor(body), rawBody: body, secret: SECRET, nowMs: NOW })).toEqual({
      ok: true,
      timestampMs: NOW,
    });
  });

  it('THE RULING: a signature over different bytes than were sent does not verify', () => {
    // Re-serialising a parsed body before checking would verify a string the sender never saw.
    const body = '{"hello":"world"}';
    const tampered = '{"hello":"WORLD"}';
    expect(verifyRequest({ headers: headersFor(body), rawBody: tampered, secret: SECRET, nowMs: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('THE RULING: another integration’s secret does not sign for this one', () => {
    const body = '{}';
    expect(verifyRequest({ headers: headersFor(body, NOW, 'someone-elses-secret'), rawBody: body, secret: SECRET, nowMs: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('THE RULING: a captured request stops working, in both directions', () => {
    const body = '{}';
    const old = NOW - INGEST_LIMITS.clockSkewMs - 1000;
    expect(verifyRequest({ headers: headersFor(body, old), rawBody: body, secret: SECRET, nowMs: NOW })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
    // And from the future: without this, a captured request replayed with a timestamp far ahead would
    // stay valid for as long as the attacker chose.
    const ahead = NOW + INGEST_LIMITS.clockSkewMs + 1000;
    expect(verifyRequest({ headers: headersFor(body, ahead), rawBody: body, secret: SECRET, nowMs: NOW })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
  });

  it('refuses a request with no headers, without saying which one was missing', () => {
    const body = '{}';
    for (const headers of [
      { integration: null, timestamp: String(NOW), signature: 'x' },
      { integration: 'a', timestamp: null, signature: 'x' },
      { integration: 'a', timestamp: String(NOW), signature: null },
    ]) {
      expect(verifyRequest({ headers, rawBody: body, secret: SECRET, nowMs: NOW })).toEqual({ ok: false, reason: 'missing_headers' });
    }
  });

  it('refuses a timestamp that is not a whole number of milliseconds', () => {
    const body = '{}';
    const headers = { integration: 'a', timestamp: 'yesterday', signature: 'x' };
    expect(verifyRequest({ headers, rawBody: body, secret: SECRET, nowMs: NOW })).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  it('bounds how much one integration may send in a minute', () => {
    expect(INGEST_RATE_PER_MINUTE).toBeGreaterThan(0);
    expect(timestampIsFresh(NOW, NOW)).toBe(true);
  });
});

describe('reading a compressed body', () => {
  it('reads plain and gzipped bodies alike', () => {
    const text = '{"records":[]}';
    expect(readBody(Buffer.from(text), null)).toEqual({ ok: true, text });
    expect(readBody(gzipSync(Buffer.from(text)), 'gzip')).toEqual({ ok: true, text });
  });

  it('THE RULING: a gzip bomb is refused by the decompressor, not by the heap', () => {
    // A few kilobytes of zeros expand to far more than the limit. The bound is given to zlib, so it stops
    // there rather than allocating past it and checking afterwards.
    const bomb = gzipSync(Buffer.alloc(INGEST_LIMITS.maxDecompressedBytes + 1_000_000, 0));
    expect(bomb.byteLength).toBeLessThan(INGEST_LIMITS.maxBodyBytes);
    expect(readBody(bomb, 'gzip')).toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses a body larger than the limit before decompressing anything', () => {
    const big = Buffer.alloc(INGEST_LIMITS.maxBodyBytes + 1);
    expect(readBody(big, 'gzip')).toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses an encoding it does not implement, rather than guessing', () => {
    expect(readBody(Buffer.from('{}'), 'br')).toEqual({ ok: false, reason: 'bad_body' });
    expect(readBody(Buffer.from('not gzip at all'), 'gzip')).toEqual({ ok: false, reason: 'bad_body' });
  });
});

describe('the batch a forwarder may send', () => {
  const batch = (over: Record<string, unknown> = {}) => ({
    source: 'aws.logs',
    forwarderVersion: '1.0.0',
    awsAccountId: '123456789012',
    region: 'eu-west-1',
    logGroup: '/aws/ecs/api',
    sentAt: NOW,
    records: [{ eventId: '1', at: NOW, message: 'hello', logStream: 'api/api/abc' }],
    ...over,
  });

  it('accepts the shape the forwarder sends', () => {
    expect(ingestLogsRequestSchema.parse(batch()).records).toHaveLength(1);
  });

  it('THE RULING: an account id that is not one is refused before anything is stored', () => {
    expect(() => ingestLogsRequestSchema.parse(batch({ awsAccountId: 'not-an-account' }))).toThrow();
    expect(() => ingestLogsRequestSchema.parse(batch({ awsAccountId: '12345678901' }))).toThrow();
  });

  it('bounds the batch, the message and the empty case', () => {
    const many = Array.from({ length: INGEST_LIMITS.maxRecords + 1 }, (_, i) => ({
      eventId: String(i),
      at: NOW,
      message: 'x',
      logStream: 's',
    }));
    expect(() => ingestLogsRequestSchema.parse(batch({ records: many }))).toThrow();
    expect(() => ingestLogsRequestSchema.parse(batch({ records: [] }))).toThrow();
    expect(() =>
      ingestLogsRequestSchema.parse(batch({ records: [{ eventId: '1', at: NOW, message: 'x'.repeat(INGEST_LIMITS.maxMessageChars + 1), logStream: 's' }] })),
    ).toThrow();
  });

  it('THE RULING: a source OpsWatch does not ingest is refused, never coerced into one it does', () => {
    // `aws.metrics` is reserved for a future Firehose delivery. A lenient enum — which is right for a
    // client reading a newer server — would file metrics as log lines and nobody would see why.
    expect(() => ingestLogsRequestSchema.parse(batch({ source: 'aws.metrics' }))).toThrow();
    expect(() => ingestLogsRequestSchema.parse(batch({ source: 'anything' }))).toThrow();
  });
});
