import { describe, expect, it, vi } from 'vitest';
import { ANALYTICS_DAYS, analyticsQuery, dayKey, errorsFrom, fetchZoneDays, parseDays } from '@/lib/cloudflare/analytics';
import { createTestDb } from '../helpers/db';

/**
 * What Cloudflare reported, and what OpsWatch refuses to turn it into (CF-2).
 *
 * Every figure on the page is a count the provider gave or a ratio of two of them. These tests are about
 * the places where a count is absent and the temptation is to render a zero.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET }) }));

const day = (over: Record<string, unknown> = {}) => ({
  dimensions: { date: '2026-09-20' },
  sum: {
    requests: 1000,
    bytes: 500_000,
    cachedRequests: 700,
    cachedBytes: 300_000,
    threats: 4,
    responseStatusMap: [
      { edgeResponseStatus: 200, requests: 900 },
      { edgeResponseStatus: 404, requests: 60 },
      { edgeResponseStatus: 503, requests: 40 },
    ],
  },
  uniq: { uniques: 120 },
  ...over,
});

const envelope = (payload: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;

describe('the query', () => {
  it('passes the zone through GraphQL variables, so an id cannot become query syntax', () => {
    const query = analyticsQuery();
    expect(query).toContain('$zone: String!');
    expect(query).toContain('zoneTag: $zone');
    // Nothing is interpolated but the limit, which is our own constant.
    expect(query).toContain(`limit: ${ANALYTICS_DAYS}`);
  });

  it('groups by the day Cloudflare groups by, in UTC', () => {
    expect(dayKey(Date.UTC(2026, 8, 23, 23, 59, 59))).toBe('2026-09-23');
  });
});

describe('splitting the status map', () => {
  it('THE RULING: a 4xx and a 5xx are counted apart, because they are acted on differently', () => {
    // A 4xx is usually somebody else's mistake; a 5xx is usually yours. One number would hide that.
    expect(errorsFrom(day().sum.responseStatusMap)).toEqual({ clientErrors: 60, serverErrors: 40 });
  });

  it('ignores a malformed entry rather than counting it as zero of something', () => {
    expect(errorsFrom([{ edgeResponseStatus: 500, requests: 3 }, null, 'nonsense'])).toEqual({ clientErrors: 0, serverErrors: 3 });
    expect(errorsFrom(undefined)).toEqual({ clientErrors: 0, serverErrors: 0 });
  });
});

describe('reading the answer', () => {
  it('turns a day into counts, with the two error ranges split out', () => {
    const days = parseDays({ data: { viewer: { zones: [{ httpRequests1dGroups: [day()] }] } } });
    expect(days).toEqual([
      {
        date: '2026-09-20',
        requests: 1000,
        cachedRequests: 700,
        bytes: 500_000,
        cachedBytes: 300_000,
        threats: 4,
        uniques: 120,
        clientErrors: 60,
        serverErrors: 40,
      },
    ]);
  });

  it('THE RULING: a plan that does not report uniques has not measured none', () => {
    const days = parseDays({ data: { viewer: { zones: [{ httpRequests1dGroups: [day({ uniq: {} })] }] } } });
    expect(days?.[0].uniques).toBeNull();
  });

  it('THE RULING: a 200 carrying GraphQL errors is a failure, not data', () => {
    // Reading only the HTTP status would report Cloudflare's own error as a successful read.
    expect(parseDays({ data: { viewer: { zones: [] } }, errors: [{ message: 'no access' }] })).toBeNull();
  });

  it('a zone with no traffic answers an empty list, which is data', () => {
    expect(parseDays({ data: { viewer: { zones: [] } } })).toEqual([]);
  });

  it('refuses a shape it does not recognise rather than inventing a day', () => {
    expect(parseDays({ data: { viewer: {} } })).toBeNull();
    expect(parseDays(null)).toBeNull();
    expect(parseDays({ data: { viewer: { zones: [{ httpRequests1dGroups: [{ sum: {} }] }] } } })).toEqual([]);
  });
});

describe('the request', () => {
  it('tells a refused permission from a bad token, because they are fixed differently', async () => {
    await expect(fetchZoneDays('t', 'z', NOW, { fetch: envelope({}, 403) })).resolves.toEqual({ ok: false, error: 'forbidden' });
    await expect(fetchZoneDays('t', 'z', NOW, { fetch: envelope({}, 401) })).resolves.toEqual({ ok: false, error: 'unauthorized' });
    await expect(fetchZoneDays('t', 'z', NOW, { fetch: envelope({}, 429) })).resolves.toEqual({ ok: false, error: 'rate_limited' });
  });

  it('THE RULING: the token is a header and never anything else', async () => {
    const seen: { headers?: unknown; body?: unknown } = {};
    const watching = (async (_url: string, init: RequestInit) => {
      seen.headers = init.headers;
      seen.body = init.body;
      return new Response(JSON.stringify({ data: { viewer: { zones: [] } } }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchZoneDays('cf-secret-token', 'zone-1', NOW, { fetch: watching });
    expect((seen.headers as Record<string, string>).authorization).toBe('Bearer cf-secret-token');
    // A proxy that logs request bodies must not capture it.
    expect(String(seen.body)).not.toContain('cf-secret-token');
    expect(String(seen.body)).toContain('zone-1');
  });

  it('never carries the provider’s own words into a failure', async () => {
    const leaky = envelope({ errors: [{ message: 'token cf-secret-token is invalid' }] });
    const result = await fetchZoneDays('cf-secret-token', 'z', NOW, { fetch: leaky });
    expect(result).toEqual({ ok: false, error: 'bad_response' });
    expect(JSON.stringify(result)).not.toContain('cf-secret-token');
  });
});

describe('the collector job', () => {
  it('THE RULING: does nothing without a verified token and a chosen zone', async () => {
    const { runCloudflareJob } = await import('@/lib/collector/cloudflare-job');
    const db = createTestDb();
    const sent = vi.fn();
    await expect(runCloudflareJob({ db, nowMs: NOW }, { fetch: sent as unknown as typeof fetch })).resolves.toEqual({ covered: 0, total: 0 });
    expect(sent).not.toHaveBeenCalled();
  });

  it('stores what it read, and a re-read corrects rather than duplicates', async () => {
    const { runCloudflareJob } = await import('@/lib/collector/cloudflare-job');
    const { saveCloudflareToken, saveCloudflareZones, testCloudflareConnection } = await import('@/lib/cloudflare/connection');
    const { listZoneDays } = await import('@/lib/store/cloudflare');

    const db = createTestDb();
    saveCloudflareToken(db, 'cf-token-0123456789abcdefghijklmnop', NOW);
    await testCloudflareConnection(db, NOW, {
      fetch: (async () => new Response(JSON.stringify({ success: true, result: { status: 'active' } }), { status: 200 })) as unknown as typeof fetch,
    });
    saveCloudflareZones(db, [{ id: 'z1', name: 'example.com' }], NOW);

    await runCloudflareJob({ db, nowMs: NOW }, { fetch: envelope({ data: { viewer: { zones: [{ httpRequests1dGroups: [day()] }] } } }) });
    expect(listZoneDays(db, 'z1', '2026-09-01')).toHaveLength(1);

    // Cloudflare revises recent days, so the same day read again is the same row corrected.
    await runCloudflareJob({ db, nowMs: NOW }, {
      fetch: envelope({ data: { viewer: { zones: [{ httpRequests1dGroups: [day({ sum: { ...day().sum, requests: 2000 } })] }] } } }),
    });
    const stored = listZoneDays(db, 'z1', '2026-09-01');
    expect(stored).toHaveLength(1);
    expect(stored[0].requests).toBe(2000);
  });
});
