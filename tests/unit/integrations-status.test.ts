import { describe, expect, it, vi } from 'vitest';
import { INTEGRATIONS, INTEGRATION_SPECS, INTEGRATION_STATES, type CredentialHome } from '@/lib/integrations/catalogue';
import { createTestDb } from '../helpers/db';

/**
 * The Integrations page's statuses (§E, UX-9).
 *
 * Every one is measured. The failure this guards against is the one the roadmap counts were hiding: a
 * settings card existing being mistaken for a connection, and a stored credential being mistaken for a
 * working one.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET }) }));

const { integrationStatuses } = await import('@/lib/integrations/status');
const { saveAiConnection, testAiConnection } = await import('@/lib/ai/connection');
const { upsertRepository, upsertIntegration } = await import('@/lib/store/repositories');

const stateOf = (db: ReturnType<typeof createTestDb>, id: (typeof INTEGRATIONS)[number]) =>
  integrationStatuses(db).find((one) => one.id === id);

describe('the catalogue', () => {
  it('covers every integration exactly once, in a fixed order', () => {
    expect(new Set(INTEGRATIONS).size).toBe(INTEGRATIONS.length);
    for (const id of INTEGRATIONS) expect(INTEGRATION_SPECS[id].id).toBe(id);
  });

  it('THE RULING: an integration this build cannot complete says so instead of offering a link', () => {
    const db = createTestDb();
    const cloudflare = stateOf(db, 'cloudflare');
    expect(INTEGRATION_SPECS.cloudflare.available).toBe(false);
    expect(cloudflare?.state).toBe('unavailable');
    // No href, so there is no button that cannot work.
    expect(cloudflare?.href).toBeNull();
  });

  it('says where each credential lives, because disconnecting means two different things', () => {
    const homes: CredentialHome[] = [INTEGRATION_SPECS.ai.credentials, INTEGRATION_SPECS.google.credentials];
    expect(homes).toEqual(['stored', 'env']);
  });

  it('has a state for each of the four cases, and not_configured is its own', () => {
    expect([...INTEGRATION_STATES].sort()).toEqual(['connected', 'degraded', 'not_configured', 'unavailable']);
  });
});

describe('what a fresh instance reports', () => {
  it('nothing is connected, and nothing claims to be', () => {
    const db = createTestDb();
    const statuses = integrationStatuses(db);
    expect(statuses.map((one) => one.id)).toEqual([...INTEGRATIONS]);
    expect(stateOf(db, 'aws')?.state).toBe('not_configured');
    expect(stateOf(db, 'github')?.state).toBe('not_configured');
    expect(stateOf(db, 'ai')?.state).toBe('not_configured');
  });
});

describe('GitHub', () => {
  it('THE RULING: repositories without a token is "needs attention", not "connected"', () => {
    const db = createTestDb();
    upsertRepository(db, { owner: 'acme', name: 'web', defaultBranch: 'main' }, NOW);

    const status = stateOf(db, 'github');
    // Links and mapping work; file contents do not. Saying "connected" would promise the second.
    expect(status?.state).toBe('degraded');
    expect(status?.detailKey).toBe('githubNoToken');
    expect(status?.values.repositories).toBe(1);
  });

  it('is connected once a token is stored alongside the repositories', () => {
    const db = createTestDb();
    upsertRepository(db, { owner: 'acme', name: 'web', defaultBranch: 'main' }, NOW);
    upsertIntegration(db, { kind: 'github', name: 'github', credentialCiphertext: 'sealed' }, NOW);
    expect(stateOf(db, 'github')?.state).toBe('connected');
  });
});

describe('the AI provider', () => {
  it('THE RULING: a saved key that has never been tested is not connected', () => {
    const db = createTestDb();
    saveAiConnection(db, { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-0123456789abcdef' }, NOW);

    const status = stateOf(db, 'ai');
    expect(status?.state).toBe('degraded');
    expect(status?.detailKey).toBe('ai_untested');
  });

  it('is connected once a test has passed', async () => {
    const db = createTestDb();
    saveAiConnection(db, { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-0123456789abcdef' }, NOW);
    const ok = (async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 })) as unknown as typeof fetch;
    await testAiConnection(db, NOW, { fetch: ok });

    expect(stateOf(db, 'ai')?.state).toBe('connected');
    expect(stateOf(db, 'ai')?.values).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  it('THE RULING: no status anywhere carries a credential', () => {
    const db = createTestDb();
    const key = 'sk-secret-value-0123456789abcdef';
    saveAiConnection(db, { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: key }, NOW);
    upsertIntegration(db, { kind: 'github', name: 'github', credentialCiphertext: 'sealed-github-token' }, NOW);

    const serialised = JSON.stringify(integrationStatuses(db));
    expect(serialised).not.toContain(key);
    expect(serialised).not.toContain('sealed-github-token');
  });
});
