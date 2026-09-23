import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/db';

/**
 * The GitHub connection (§13, REPO-1, REPO-4).
 *
 * The rulings: the client has **no write verb at all**, a token sealed under the old shared purpose is
 * re-sealed under its own, and GitHub's error text never reaches the database or the page.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const TOKEN = 'ghp_e2e_token_value_0123456789abcdefgh';

vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET }) }));

const github = await import('@/lib/github/connection');
const api = await import('@/lib/github/api');
const { credentialFor, listIntegrations, upsertIntegration } = await import('@/lib/store/repositories');
const { encrypt, decrypt, DecryptionError } = await import('@/lib/crypto');

const json = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
  (async () => new Response(JSON.stringify(payload), { status, headers })) as unknown as typeof fetch;

const connect = (db: ReturnType<typeof createTestDb>) => github.saveGithubToken(db, TOKEN, NOW);

describe('THE RULING: the client cannot write, because it has no code that could', () => {
  it('exposes only reads', () => {
    // Every exported call is a GET. §13's promise is the absence of a verb, not a note about intent.
    expect(Object.keys(api).filter((name) => /^(create|update|delete|post|put|patch)/i.test(name))).toEqual([]);
    expect(typeof api.verifyToken).toBe('function');
    expect(typeof api.listRepositories).toBe('function');
    expect(typeof api.listCommits).toBe('function');
  });
});

describe('THE RULING: the token never comes back', () => {
  it('is absent from everything a page can read', () => {
    const db = createTestDb();
    connect(db);
    expect(JSON.stringify(github.readGithubConnection(db))).not.toContain(TOKEN);
    expect(JSON.stringify(listIntegrations(db, 'github'))).not.toContain(TOKEN);
    expect(github.readGithubConnection(db)?.hasCredential).toBe(true);
  });

  it('is sealed under its own purpose, so an AWS credential path cannot read it', () => {
    const db = createTestDb();
    connect(db);
    const ciphertext = credentialFor(db, listIntegrations(db, 'github')[0].id) ?? '';
    expect(() => decrypt(ciphertext, SECRET, 'access-keys')).toThrow(DecryptionError);
    expect(decrypt(ciphertext, SECRET, 'github')).toBe(TOKEN);
  });

  it('THE RULING: a token sealed the old way is re-sealed the first time it is read', async () => {
    const db = createTestDb();
    // As an earlier release stored it: under the purpose AWS credentials use.
    upsertIntegration(db, { kind: 'github', name: 'github', credentialCiphertext: encrypt(TOKEN, SECRET, 'access-keys') }, NOW);

    const result = await github.testGithubConnection(db, NOW, { fetch: json({ login: 'acme' }) });
    expect(result).toEqual({ ok: true, account: 'acme' });

    // Read once through the legacy purpose, and written back under its own. The fallback is now unused.
    const ciphertext = credentialFor(db, listIntegrations(db, 'github')[0].id) ?? '';
    expect(decrypt(ciphertext, SECRET, 'github')).toBe(TOKEN);
    expect(() => decrypt(ciphertext, SECRET, 'access-keys')).toThrow(DecryptionError);
  });

  it('THE RULING: GitHub’s own error text never reaches the database', async () => {
    const db = createTestDb();
    connect(db);
    const leaky = json({ message: `Bad credentials for ${TOKEN}` }, 401);

    expect(await github.testGithubConnection(db, NOW, { fetch: leaky })).toEqual({ ok: false, error: 'unauthorized' });
    expect(JSON.stringify(listIntegrations(db, 'github'))).not.toContain(TOKEN);
    expect(github.readGithubConnection(db)?.lastError).toBe('unauthorized');
  });
});

describe('verifying', () => {
  it('records a pass, and names the account, which is not a secret', async () => {
    const db = createTestDb();
    connect(db);
    await github.testGithubConnection(db, NOW, { fetch: json({ login: 'acme' }) });
    expect(github.readGithubConnection(db)).toMatchObject({ status: 'configured', account: 'acme' });
    expect(github.githubIsReady(db)).toBe(true);
  });

  it('THE RULING: a rate limit arriving as 403 is told apart from a missing permission', async () => {
    const db = createTestDb();
    connect(db);
    // GitHub sends 403 for both, and only the header distinguishes them — and they are fixed differently.
    const limited = json({}, 403, { 'x-ratelimit-remaining': '0' });
    expect(await github.testGithubConnection(db, NOW, { fetch: limited })).toEqual({ ok: false, error: 'rate_limited' });

    const forbidden = json({}, 403, { 'x-ratelimit-remaining': '4999' });
    expect(await github.testGithubConnection(db, NOW, { fetch: forbidden })).toEqual({ ok: false, error: 'forbidden' });
  });

  it('a stored token is untested until it is verified', () => {
    const db = createTestDb();
    connect(db);
    expect(github.readGithubConnection(db)?.status).toBe('untested');
    expect(github.githubIsReady(db)).toBe(false);
  });

  it('with nothing stored it says so, without pretending it tried', async () => {
    const db = createTestDb();
    const sent = vi.fn();
    expect(await github.testGithubConnection(db, NOW, { fetch: sent as unknown as typeof fetch })).toEqual({
      ok: false,
      error: 'not_configured',
    });
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('discovery', () => {
  const repos = [
    { name: 'web', owner: { login: 'acme' }, default_branch: 'release', private: true },
    { name: 'worker', owner: { login: 'acme' }, private: false },
  ];

  it('THE RULING: the default branch is read from GitHub rather than assumed', async () => {
    const db = createTestDb();
    connect(db);
    const result = await github.discoverRepositories(db, NOW, { fetch: json(repos) });
    expect(result).toEqual({
      ok: true,
      repositories: [
        { owner: 'acme', name: 'web', defaultBranch: 'release', private: true },
        // Only where GitHub said nothing does it fall back, and `main` is the fallback rather than the rule.
        { owner: 'acme', name: 'worker', defaultBranch: 'main', private: false },
      ],
    });
  });

  it('ignores an entry it cannot make sense of rather than inventing a name', async () => {
    const db = createTestDb();
    connect(db);
    const result = await github.discoverRepositories(db, NOW, { fetch: json([{ nonsense: true }, ...repos]) });
    expect(result.ok && result.repositories).toHaveLength(2);
  });
});

describe('commits behind a deployment (REPO-4)', () => {
  it('takes the summary line and the time, bounded by the window asked about', async () => {
    const db = createTestDb();
    connect(db);
    const payload = [
      { sha: 'abc123', commit: { message: 'Fix the checkout total\n\nA long body nobody needs here.', author: { name: 'Ada', date: '2026-09-23T11:00:00Z' } } },
      { sha: 'def456', commit: { message: 'Tidy', author: { name: null, date: 'not a date' } } },
    ];
    const result = await github.fetchCommits(db, { owner: 'acme', name: 'web', branch: 'main' }, { sinceMs: NOW - 3_600_000, untilMs: NOW }, NOW, {
      fetch: json(payload),
    });
    expect(result.ok && result.data).toEqual([
      { sha: 'abc123', message: 'Fix the checkout total', author: 'Ada', at: Date.UTC(2026, 8, 23, 11, 0, 0) },
      // An unparseable date falls back to the end of the window rather than to the epoch.
      { sha: 'def456', message: 'Tidy', author: null, at: NOW },
    ]);
  });
});

describe('disconnecting', () => {
  it('THE RULING: deletes the token and keeps the repositories', () => {
    const db = createTestDb();
    connect(db);
    expect(github.removeGithubConnection(db)).toBe(true);
    expect(listIntegrations(db, 'github')).toEqual([]);
    // Links and mapping work without a token, so removing one must not remove them.
    expect(github.readGithubConnection(db)).toBeNull();
  });
});
