import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyFor, failureOf, headersFor, textOf } from '@/lib/ai/client';
import { AI_PROVIDER_SPECS, endpointOf, isProvider } from '@/lib/ai/providers';
import { createTestDb } from '../helpers/db';

/**
 * The optional AI provider (AI-2, AI-3).
 *
 * The rulings here are all about what must **not** happen: a key reaching a page, a provider's wording
 * reaching the database, a saved key being mistaken for a working one, and OpsWatch calling an address
 * inside the operator's own network because somebody typed it into a settings form.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const KEY = 'sk-super-secret-key-value-0123456789';

vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET }) }));

const connection = await import('@/lib/ai/connection');
const { credentialFor, listIntegrations } = await import('@/lib/store/repositories');

const save = (db: ReturnType<typeof createTestDb>, over: Partial<Parameters<typeof connection.saveAiConnection>[1]> = {}) =>
  connection.saveAiConnection(db, { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: KEY, ...over }, NOW);

describe('the request each provider shape expects', () => {
  it('speaks each API in its own shape, so a provider is a setting rather than a rewrite', () => {
    const anthropic = bodyFor({ provider: 'anthropic', model: 'm' }, { system: 's', prompt: 'p', maxTokens: 1 });
    expect(anthropic).toMatchObject({ model: 'm', system: 's', messages: [{ role: 'user', content: 'p' }] });

    const openai = bodyFor({ provider: 'openai', model: 'm' }, { system: 's', prompt: 'p', maxTokens: 1 });
    expect(openai.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'p' },
    ]);
  });

  it('reads an answer out of either shape, and says null when it recognises neither', () => {
    expect(textOf({ provider: 'anthropic', model: 'm' }, { content: [{ type: 'text', text: 'hello' }] })).toBe('hello');
    expect(textOf({ provider: 'openai', model: 'm' }, { choices: [{ message: { content: 'hello' } }] })).toBe('hello');
    // An unreadable reply is a failure, not an empty answer — an empty answer rendered as the assistant's
    // opinion would be OpsWatch putting words in a model's mouth.
    expect(textOf({ provider: 'openai', model: 'm' }, { nonsense: true })).toBeNull();
  });

  it('turns a status into a code, never into a provider’s sentence', () => {
    expect(failureOf(401)).toBe('unauthorized');
    expect(failureOf(429)).toBe('rate_limited');
    expect(failureOf(500)).toBe('bad_response');
  });

  it('lets an operator name their own endpoint, and only for the provider that allows it', () => {
    expect(endpointOf({ provider: 'anthropic', model: 'm' })).toBe('https://api.anthropic.com/v1/messages');
    expect(endpointOf({ provider: 'openai-compatible', model: 'm' })).toBeNull();
    expect(endpointOf({ provider: 'openai-compatible', model: 'm', baseUrl: 'https://models.example.com/' })).toBe(
      'https://models.example.com/v1/chat/completions',
    );
    // A base URL supplied for a provider that has its own is ignored rather than silently obeyed.
    expect(endpointOf({ provider: 'anthropic', model: 'm', baseUrl: 'https://evil.example.com' })).toBe(
      'https://api.anthropic.com/v1/messages',
    );
    expect(AI_PROVIDER_SPECS['openai-compatible'].customBaseUrl).toBe(true);
    expect(isProvider('nope')).toBe(false);
  });
});

describe('where the key is allowed to appear', () => {
  it('THE RULING: in a header, and nowhere else in the request', () => {
    const config = { provider: 'anthropic' as const, model: 'm' };
    expect(headersFor(config, KEY)['x-api-key']).toBe(KEY);
    expect(headersFor({ provider: 'openai' as const, model: 'm' }, KEY).authorization).toBe(`Bearer ${KEY}`);
    // Never in the body — and `bodyFor` is not even given the key, so it cannot be, which is a stronger
    // guarantee than this assertion can express on its own.
    expect(JSON.stringify(bodyFor(config, { system: 's', prompt: 'p', maxTokens: 1 }))).not.toContain(KEY);
    expect(bodyFor.length).toBe(2);
  });

  it('THE RULING: an endpoint the SSRF guard refuses is reported as refused, not as a network error', async () => {
    const db = createTestDb();
    save(db, { provider: 'openai-compatible', baseUrl: 'https://internal.example.com' });
    const { SsrfError } = await import('@/lib/net/safe-fetch');
    const refusing = (async () => {
      throw new SsrfError('not_public', 'internal.example.com');
    }) as unknown as typeof fetch;

    const result = await connection.runAi(db, { system: 's', prompt: 'p', maxTokens: 1 }, { fetch: refusing });
    // A distinct code, because "we would not call that address" and "that address did not answer" are
    // different facts and only one of them is the operator's to fix.
    expect(result).toEqual({ ok: false, error: 'refused_endpoint' });
  });

  it('never carries the operator’s endpoint into a failure a page renders', async () => {
    const db = createTestDb();
    save(db, { provider: 'openai-compatible', baseUrl: 'https://models.internal.example.com' });
    const broken = (async () => {
      throw new Error('connect ECONNREFUSED models.internal.example.com:443');
    }) as unknown as typeof fetch;

    const result = await connection.runAi(db, { system: 's', prompt: 'p', maxTokens: 1 }, { fetch: broken });
    expect(JSON.stringify(result)).not.toContain('internal.example.com');
    expect(result).toEqual({ ok: false, error: 'unreachable' });
  });
});

describe('THE RULING: the key never comes back', () => {
  it('is absent from everything a page can read', () => {
    const db = createTestDb();
    save(db);

    const view = connection.readAiConnection(db);
    expect(JSON.stringify(view)).not.toContain(KEY);
    // Nor from the generic integration listing, which has no ciphertext field at all.
    expect(JSON.stringify(listIntegrations(db, 'ai'))).not.toContain(KEY);
    // Only whether there is one.
    expect(connection.aiHasCredential(db)).toBe(true);
  });

  it('is stored encrypted, so the database file does not carry it in the clear', () => {
    const db = createTestDb();
    save(db);
    const row = listIntegrations(db, 'ai')[0];
    const ciphertext = credentialFor(db, row.id);
    expect(ciphertext).not.toBeNull();
    expect(ciphertext).not.toContain(KEY);
  });

  it('is encrypted under its own purpose, so an AWS key path cannot read it', async () => {
    const db = createTestDb();
    save(db);
    const { decrypt, DecryptionError } = await import('@/lib/crypto');
    const ciphertext = credentialFor(db, listIntegrations(db, 'ai')[0].id) ?? '';
    expect(() => decrypt(ciphertext, SECRET, 'access-keys')).toThrow(DecryptionError);
    expect(decrypt(ciphertext, SECRET, 'ai-provider')).toBe(KEY);
  });
});

describe('what the page is told', () => {
  it('THE RULING: a saved key is untested, not connected', () => {
    const db = createTestDb();
    expect(save(db)?.status).toBe('untested');
    // Which is exactly what `aiIsReady` refuses to call ready.
    expect(connection.aiIsReady(db)).toBe(false);
  });

  it('reports nothing configured on a fresh instance, which is the default and stays it', () => {
    const db = createTestDb();
    expect(connection.readAiConnection(db)).toBeNull();
    expect(connection.aiIsReady(db)).toBe(false);
  });

  it('THE RULING: changing the model makes the old test result meaningless again', async () => {
    const db = createTestDb();
    save(db);
    await connection.testAiConnection(db, NOW, { fetch: okFetch });
    expect(connection.aiIsReady(db)).toBe(true);

    // A different model is a different connection. Saying "connected" about the old one would be a claim.
    save(db, { model: 'claude-opus-5', apiKey: undefined });
    expect(connection.readAiConnection(db)?.status).toBe('untested');
    expect(connection.readAiConnection(db)?.model).toBe('claude-opus-5');
  });

  it('keeps the stored key when a save leaves it out', () => {
    const db = createTestDb();
    save(db);
    save(db, { model: 'claude-opus-5', apiKey: undefined });
    expect(connection.aiHasCredential(db)).toBe(true);
  });
});

/** A provider that answers. */
const okFetch = (async () =>
  new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 })) as unknown as typeof fetch;

describe('testing and disconnecting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a pass as connected', async () => {
    const db = createTestDb();
    save(db);
    await expect(connection.testAiConnection(db, NOW, { fetch: okFetch })).resolves.toEqual({ ok: true });
    expect(connection.readAiConnection(db)?.status).toBe('configured');
  });

  it('THE RULING: a provider’s own error text never reaches the database', async () => {
    const db = createTestDb();
    save(db);
    const leaky = (async () =>
      new Response(JSON.stringify({ error: `invalid key ${KEY}` }), { status: 401 })) as unknown as typeof fetch;

    const result = await connection.testAiConnection(db, NOW, { fetch: leaky });
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    // The stored reason is a code. A provider that echoes a key into its message cannot put it here.
    const stored = JSON.stringify(listIntegrations(db, 'ai'));
    expect(stored).not.toContain(KEY);
    expect(connection.readAiConnection(db)?.lastError).toBe('unauthorized');
  });

  it('THE RULING: disconnecting deletes the key rather than flipping a flag', () => {
    const db = createTestDb();
    save(db);
    expect(connection.removeAiConnection(db)).toBe(true);
    expect(listIntegrations(db, 'ai')).toEqual([]);
    expect(connection.readAiConnection(db)).toBeNull();
  });

  it('a request with nothing configured is refused before anything is sent', async () => {
    const db = createTestDb();
    const sent = vi.fn();
    await expect(
      connection.runAi(db, { system: 's', prompt: 'p', maxTokens: 1 }, { fetch: sent as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, error: 'not_configured' });
    expect(sent).not.toHaveBeenCalled();
  });
});
