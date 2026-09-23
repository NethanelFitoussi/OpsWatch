import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/db';

/**
 * The Cloudflare overview (CF-2).
 *
 * Four emptinesses, kept apart because each needs a different thing from the operator — and one refusal:
 * a ratio with nothing to divide by is absent, never zero.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET }) }));

const { readCloudflareOverview } = await import('@/lib/read/cloudflare');
const { saveCloudflareToken, saveCloudflareZones, testCloudflareConnection } = await import('@/lib/cloudflare/connection');
const { recordZoneDays } = await import('@/lib/store/cloudflare');

const verified = async (db: ReturnType<typeof createTestDb>) => {
  saveCloudflareToken(db, 'cf-token-0123456789abcdefghijklmnop', NOW);
  await testCloudflareConnection(db, NOW, {
    fetch: (async () => new Response(JSON.stringify({ success: true, result: { status: 'active' } }), { status: 200 })) as unknown as typeof fetch,
  });
};

const zoneDay = (date: string, over: Record<string, number | null> = {}) => ({
  zoneId: 'z1',
  date,
  requests: 1000,
  cachedRequests: 700,
  bytes: 500_000,
  cachedBytes: 300_000,
  threats: 4,
  uniques: 120,
  clientErrors: 60,
  serverErrors: 40,
  ...over,
});

describe('THE RULING: four emptinesses, each needing something different', () => {
  it('not connected', () => {
    expect(readCloudflareOverview(createTestDb(), NOW).state).toBe('not_connected');
  });

  it('a token stored but never verified is not a connection', () => {
    const db = createTestDb();
    saveCloudflareToken(db, 'cf-token-0123456789abcdefghijklmnop', NOW);
    expect(readCloudflareOverview(db, NOW).state).toBe('unverified');
  });

  it('verified and watching nothing reads nothing, and says which', async () => {
    const db = createTestDb();
    await verified(db);
    expect(readCloudflareOverview(db, NOW).state).toBe('no_zones');
  });

  it('watching but not fetched yet is not the same as having no traffic', async () => {
    const db = createTestDb();
    await verified(db);
    saveCloudflareZones(db, [{ id: 'z1', name: 'example.com' }], NOW);
    expect(readCloudflareOverview(db, NOW).state).toBe('no_data');
  });
});

describe('the figures', () => {
  const ready = async () => {
    const db = createTestDb();
    await verified(db);
    saveCloudflareZones(db, [{ id: 'z1', name: 'example.com' }], NOW);
    return db;
  };

  it('sums counts and divides them into rates, and nothing else', async () => {
    const db = await ready();
    recordZoneDays(db, [zoneDay('2026-09-20'), zoneDay('2026-09-21')], NOW);

    const overview = readCloudflareOverview(db, NOW);
    expect(overview.state).toBe('ready');
    const zone = overview.zones[0];
    expect(zone.requests).toBe(2000);
    expect(zone.cacheHitRate).toBeCloseTo(0.7, 6);
    expect(zone.serverErrorRate).toBeCloseTo(0.04, 6);
    expect(zone.clientErrorRate).toBeCloseTo(0.06, 6);
    expect(overview.totals.requests).toBe(2000);
  });

  it('THE RULING: a zone with no traffic has no cache hit rate, not a zero one', async () => {
    const db = await ready();
    recordZoneDays(db, [zoneDay('2026-09-20', { requests: 0, cachedRequests: 0, bytes: 0, cachedBytes: 0, serverErrors: 0, clientErrors: 0 })], NOW);

    const zone = readCloudflareOverview(db, NOW).zones[0];
    // Nothing to divide by. A 0 % cache hit rate would be a measurement nobody took.
    expect(zone.cacheHitRate).toBeNull();
    expect(zone.serverErrorRate).toBeNull();
    expect(zone.cachedByteShare).toBeNull();
    expect(zone.requests).toBe(0);
  });

  it('THE RULING: one day is not a trend', async () => {
    const db = await ready();
    recordZoneDays(db, [zoneDay('2026-09-20')], NOW);
    expect(readCloudflareOverview(db, NOW).zones[0].requestsTrend).toBeNull();

    recordZoneDays(db, [zoneDay('2026-09-21', { requests: 1500 })], NOW);
    expect(readCloudflareOverview(db, NOW).zones[0].requestsTrend).toBeCloseTo(0.5, 6);
  });

  it('a zone that was selected but never read is listed with zeroes and no rates', async () => {
    const db = await ready();
    saveCloudflareZones(db, [{ id: 'z1', name: 'example.com' }, { id: 'z2', name: 'other.example' }], NOW);
    recordZoneDays(db, [zoneDay('2026-09-20')], NOW);

    const zones = readCloudflareOverview(db, NOW).zones;
    // It is still listed: a selected zone nobody can see is how one ends up silently unwatched.
    expect(zones.map((one) => one.name)).toEqual(['example.com', 'other.example']);
    expect(zones[1]).toMatchObject({ requests: 0, cacheHitRate: null, requestsTrend: null });
  });
});
