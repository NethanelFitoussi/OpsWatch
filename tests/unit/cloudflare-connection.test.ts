import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/db';

/**
 * The Cloudflare connection (§20, CF-1).
 *
 * The rulings are the two this integration turns on: **a token that can see forty zones does not mean
 * forty zones are read**, and Cloudflare's own error text never reaches the database or a page.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const TOKEN = 'cf-token-value-0123456789abcdefghij';

vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET }) }));

const cloudflare = await import('@/lib/cloudflare/connection');
const { ZONE_PAGE_SIZE } = await import('@/lib/cloudflare/api');
const { credentialFor, listIntegrations } = await import('@/lib/store/repositories');

/** A Cloudflare reply, in their envelope. */
const envelope = (result: unknown, status = 200, success = true) =>
  (async () => new Response(JSON.stringify({ success, result, errors: [] }), { status })) as unknown as typeof fetch;

const connect = (db: ReturnType<typeof createTestDb>) => cloudflare.saveCloudflareToken(db, TOKEN, NOW);

describe('THE RULING: the token never comes back', () => {
  it('is absent from everything a page can read', () => {
    const db = createTestDb();
    connect(db);
    expect(JSON.stringify(cloudflare.readCloudflareConnection(db))).not.toContain(TOKEN);
    expect(JSON.stringify(listIntegrations(db, 'cloudflare'))).not.toContain(TOKEN);
    expect(cloudflare.readCloudflareConnection(db)?.hasCredential).toBe(true);
  });

  it('is encrypted under its own purpose, so an AI or AWS path cannot read it', async () => {
    const db = createTestDb();
    connect(db);
    const { decrypt, DecryptionError } = await import('@/lib/crypto');
    const ciphertext = credentialFor(db, listIntegrations(db, 'cloudflare')[0].id) ?? '';
    expect(() => decrypt(ciphertext, SECRET, 'ai-provider')).toThrow(DecryptionError);
    expect(decrypt(ciphertext, SECRET, 'cloudflare')).toBe(TOKEN);
  });

  it('THE RULING: Cloudflare’s own error text never reaches the database', async () => {
    const db = createTestDb();
    connect(db);
    const leaky = (async () =>
      new Response(JSON.stringify({ success: false, errors: [{ message: `bad token ${TOKEN}` }] }), { status: 401 })) as unknown as typeof fetch;

    const result = await cloudflare.testCloudflareConnection(db, NOW, { fetch: leaky });
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(JSON.stringify(listIntegrations(db, 'cloudflare'))).not.toContain(TOKEN);
    expect(cloudflare.readCloudflareConnection(db)?.lastError).toBe('unauthorized');
  });
});

describe('verifying a token', () => {
  it('records a pass as connected', async () => {
    const db = createTestDb();
    connect(db);
    await expect(cloudflare.testCloudflareConnection(db, NOW, { fetch: envelope({ status: 'active' }) })).resolves.toEqual({ ok: true });
    expect(cloudflare.readCloudflareConnection(db)?.status).toBe('configured');
  });

  it('THE RULING: a 200 carrying success:false is a failure, not data', async () => {
    const db = createTestDb();
    connect(db);
    // The result is well-formed and the call still failed. Reading only the HTTP status — or only whether
    // the body parses — would report Cloudflare's own error as a successful verification.
    const result = await cloudflare.testCloudflareConnection(db, NOW, { fetch: envelope({ status: 'active' }, 200, false) });
    expect(result).toEqual({ ok: false, error: 'bad_response' });
    expect(cloudflare.readCloudflareConnection(db)?.status).toBe('failed');
  });

  it('tells a missing permission from a bad token, because only one is fixed the same way', async () => {
    const db = createTestDb();
    connect(db);
    const forbidden = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(cloudflare.testCloudflareConnection(db, NOW, { fetch: forbidden })).resolves.toEqual({ ok: false, error: 'forbidden' });
  });

  it('with nothing stored it says so, without pretending it tried', async () => {
    const db = createTestDb();
    const sent = vi.fn();
    await expect(cloudflare.testCloudflareConnection(db, NOW, { fetch: sent as unknown as typeof fetch })).resolves.toEqual({
      ok: false,
      error: 'not_configured',
    });
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('zones', () => {
  const discovered = [
    { id: 'z1', name: 'example.com', status: 'active' },
    { id: 'z2', name: 'other.example', status: 'active' },
  ];

  it('are discovered so an operator picks rather than pastes an id', async () => {
    const db = createTestDb();
    connect(db);
    const result = await cloudflare.discoverZones(db, { fetch: envelope(discovered) });
    expect(result).toEqual({ ok: true, zones: discovered });
  });

  it('THE RULING: seeing a zone is not watching it', async () => {
    const db = createTestDb();
    connect(db);
    await cloudflare.testCloudflareConnection(db, NOW, { fetch: envelope({ status: 'active' }) });
    await cloudflare.discoverZones(db, { fetch: envelope(discovered) });

    // Two zones are visible and none is read: nothing is watched until it is chosen.
    expect(cloudflare.readCloudflareConnection(db)?.zones).toEqual([]);
    expect(cloudflare.cloudflareIsReady(db)).toBe(false);

    cloudflare.saveCloudflareZones(db, [{ id: 'z1', name: 'example.com' }], NOW);
    expect(cloudflare.cloudflareIsReady(db)).toBe(true);
    expect(cloudflare.readCloudflareConnection(db)?.zones).toEqual([{ id: 'z1', name: 'example.com' }]);
  });

  it('THE RULING: choosing zones does not invalidate the verification', async () => {
    const db = createTestDb();
    connect(db);
    await cloudflare.testCloudflareConnection(db, NOW, { fetch: envelope({ status: 'active' }) });
    cloudflare.saveCloudflareZones(db, [{ id: 'z1', name: 'example.com' }], NOW);
    // Which zones are read says nothing about whether the token works, so the status stands.
    expect(cloudflare.readCloudflareConnection(db)?.status).toBe('configured');
  });

  it('asks for a bounded page, so an account with hundreds is not fetched at once', () => {
    expect(ZONE_PAGE_SIZE).toBeGreaterThan(0);
    expect(ZONE_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});

describe('disconnecting', () => {
  it('THE RULING: deletes the token rather than flipping a flag', () => {
    const db = createTestDb();
    connect(db);
    cloudflare.saveCloudflareZones(db, [{ id: 'z1', name: 'example.com' }], NOW);
    expect(cloudflare.removeCloudflareConnection(db)).toBe(true);
    expect(listIntegrations(db, 'cloudflare')).toEqual([]);
    expect(cloudflare.readCloudflareConnection(db)).toBeNull();
  });
});
