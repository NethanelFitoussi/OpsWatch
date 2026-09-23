import { describe, expect, it } from 'vitest';
import {
  clearMapping,
  credentialFor,
  deleteRepository,
  findMapping,
  listIntegrations,
  listMappings,
  listRepositories,
  recordIntegrationTest,
  setMapping,
  upsertIntegration,
  upsertRepository,
} from '@/lib/store/repositories';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };

describe('§13 — the credential never leaves the store', () => {
  it('THE RULING: no listing carries the ciphertext, only whether there is one', () => {
    const db = createTestDb();
    upsertIntegration(db, { kind: 'github', name: 'acme', credentialCiphertext: 'SECRET-CIPHERTEXT' }, NOW);

    const listed = listIntegrations(db);
    expect(listed[0]).toMatchObject({ name: 'acme', hasCredential: true });
    // There is no field a page could render or a log line could serialise by accident.
    expect(JSON.stringify(listed)).not.toContain('SECRET-CIPHERTEXT');
    expect(listed[0]).not.toHaveProperty('credentialCiphertext');
  });

  it('returns it only through the one function named for doing so', () => {
    const db = createTestDb();
    const integration = upsertIntegration(db, { kind: 'github', name: 'acme', credentialCiphertext: 'CIPHER' }, NOW);
    expect(credentialFor(db, integration.id)).toBe('CIPHER');
  });

  it('reports an integration with no credential as having none, rather than as broken', () => {
    const db = createTestDb();
    upsertIntegration(db, { kind: 'github', name: 'declared-only' }, NOW);
    expect(listIntegrations(db)[0]).toMatchObject({ hasCredential: false, status: 'untested' });
  });

  it('THE RULING: editing without a credential leaves the stored one alone', () => {
    const db = createTestDb();
    const first = upsertIntegration(db, { kind: 'github', name: 'acme', credentialCiphertext: 'CIPHER' }, NOW);
    // Saving a form that does not include the token must not silently clear it.
    upsertIntegration(db, { kind: 'github', name: 'acme' }, NOW);
    expect(credentialFor(db, first.id)).toBe('CIPHER');
  });

  it('a replaced credential is untested again, because the old result says nothing about the new token', () => {
    const db = createTestDb();
    const integration = upsertIntegration(db, { kind: 'github', name: 'acme', credentialCiphertext: 'A' }, NOW);
    recordIntegrationTest(db, integration.id, { ok: true }, NOW);
    expect(listIntegrations(db)[0]?.status).toBe('configured');

    upsertIntegration(db, { kind: 'github', name: 'acme', credentialCiphertext: 'B' }, NOW);
    expect(listIntegrations(db)[0]?.status).toBe('untested');
  });

  it('keeps a failure reason so a reader can act on it', () => {
    const db = createTestDb();
    const integration = upsertIntegration(db, { kind: 'github', name: 'acme', credentialCiphertext: 'A' }, NOW);
    recordIntegrationTest(db, integration.id, { ok: false, error: 'Bad credentials' }, NOW);
    expect(listIntegrations(db)[0]).toMatchObject({ status: 'failed', lastError: 'Bad credentials' });
  });
});

describe('repositories', () => {
  it('are unique by owner and name, so the same one twice is an edit', () => {
    const db = createTestDb();
    upsertRepository(db, { owner: 'acme', name: 'web' }, NOW);
    upsertRepository(db, { owner: 'acme', name: 'web', defaultBranch: 'trunk' }, NOW);
    expect(listRepositories(db)).toHaveLength(1);
    expect(listRepositories(db)[0]?.defaultBranch).toBe('trunk');
  });

  it('default to main, because most do and a wrong branch is a broken link', () => {
    const db = createTestDb();
    expect(upsertRepository(db, { owner: 'acme', name: 'web' }, NOW).defaultBranch).toBe('main');
  });
});

describe('§13 — the mapping is declared, never applied', () => {
  it('records who decided it', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'web' }, NOW);
    const mapping = setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: repository.id }, NOW);
    // Saving means a person decided, so `declared` is the default rather than something a caller opts into.
    expect(mapping.source).toBe('declared');
  });

  it('keeps one mapping per service, so a service cannot point at two repositories', () => {
    const db = createTestDb();
    const a = upsertRepository(db, { owner: 'acme', name: 'web' }, NOW);
    const b = upsertRepository(db, { owner: 'acme', name: 'storefront' }, NOW);
    setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: a.id }, NOW);
    setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: b.id }, NOW);

    expect(listMappings(db, env.connectionId, env.scope)).toHaveLength(1);
    expect(findMapping(db, env.connectionId, env.scope, 'prod/web')?.repositoryId).toBe(b.id);
  });

  it('carries a monorepo prefix when there is one', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'mono' }, NOW);
    const mapping = setMapping(db, { ...env, serviceId: 'prod/pay', repositoryId: repository.id, pathPrefix: 'services/pay' }, NOW);
    expect(mapping.pathPrefix).toBe('services/pay');
  });

  it('keeps environments apart', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'web' }, NOW);
    setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: repository.id }, NOW);
    expect(findMapping(db, 'c1', 'eu-west-1', 'prod/web')).toBeNull();
  });

  it('THE RULING: deleting a repository cannot leave a service pointing at nothing', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'web' }, NOW);
    setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: repository.id }, NOW);

    deleteRepository(db, repository.id);
    expect(findMapping(db, env.connectionId, env.scope, 'prod/web')).toBeNull();
  });

  it('can be cleared, so a wrong mapping is undoable', () => {
    const db = createTestDb();
    const repository = upsertRepository(db, { owner: 'acme', name: 'web' }, NOW);
    setMapping(db, { ...env, serviceId: 'prod/web', repositoryId: repository.id }, NOW);
    expect(clearMapping(db, env.connectionId, env.scope, 'prod/web')).toBe(1);
    expect(findMapping(db, env.connectionId, env.scope, 'prod/web')).toBeNull();
  });
});
