import { describe, expect, it } from 'vitest';
import { isAcceptableUrl } from '../../src/app/[locale]/(app)/c/[connectionId]/[region]/overview/synthetics/url-guard';
import {
  deleteCheck,
  enabledChecks,
  listChecks,
  recentRuns,
  recordRun,
  secretHeadersFor,
  toOutcome,
  upsertCheck,
} from '@/lib/store/synthetics';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const base = { ...env, name: 'checkout', url: 'https://example.com/healthz', enabled: true, assertions: [] };

describe('§14 — a URL is refused at save time too', () => {
  it('accepts http and https on ordinary ports', () => {
    for (const url of ['https://a.test/x', 'http://a.test/', 'https://a.test:8443/', 'http://a.test:8080/']) {
      expect(isAcceptableUrl(url), url).toBe(true);
    }
  });

  it('THE RULING: refuses a scheme or a port OpsWatch will not fetch', () => {
    // A URL nobody can ever check should not sit in the database looking configured.
    for (const url of ['file:///etc/passwd', 'ftp://a.test/', 'gopher://a.test/', 'https://a.test:22/', 'not a url', '']) {
      expect(isAcceptableUrl(url), url).toBe(false);
    }
  });
});

describe('§14 — secret headers never leave the store', () => {
  it('THE RULING: the listing says whether there are any, never what they are', () => {
    const db = createTestDb();
    upsertCheck(db, { ...base, secretHeadersCiphertext: 'SECRET-CIPHER' }, NOW);

    const listed = listChecks(db, env.connectionId, env.scope);
    expect(listed[0]).toMatchObject({ hasSecretHeaders: true });
    expect(JSON.stringify(listed)).not.toContain('SECRET-CIPHER');
    expect(listed[0]).not.toHaveProperty('secretHeadersCiphertext');
  });

  it('returns them only through the one function named for it', () => {
    const db = createTestDb();
    const check = upsertCheck(db, { ...base, secretHeadersCiphertext: 'CIPHER' }, NOW);
    expect(secretHeadersFor(db, check.id)).toBe('CIPHER');
  });

  it('THE RULING: saving without headers leaves the stored ones alone', () => {
    const db = createTestDb();
    const check = upsertCheck(db, { ...base, secretHeadersCiphertext: 'CIPHER' }, NOW);
    upsertCheck(db, { ...base, url: 'https://example.com/other' }, NOW);
    expect(secretHeadersFor(db, check.id)).toBe('CIPHER');
  });
});

describe('checks and their runs', () => {
  it('are off until enabled, so nothing is fetched from this host by default', () => {
    const db = createTestDb();
    upsertCheck(db, { ...base, enabled: false }, NOW);
    expect(listChecks(db, env.connectionId, env.scope)).toHaveLength(1);
    expect(enabledChecks(db, env.connectionId, env.scope)).toEqual([]);
  });

  it('are unique by name within an environment, so saving twice is an edit', () => {
    const db = createTestDb();
    upsertCheck(db, base, NOW);
    upsertCheck(db, { ...base, url: 'https://example.com/other' }, NOW);
    const checks = listChecks(db, env.connectionId, env.scope);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.url).toBe('https://example.com/other');
  });

  it('keep environments apart', () => {
    const db = createTestDb();
    upsertCheck(db, base, NOW);
    expect(listChecks(db, 'c1', 'eu-west-1')).toEqual([]);
  });

  it('record a run and read it back newest first', () => {
    const db = createTestDb();
    const check = upsertCheck(db, base, NOW);
    recordRun(db, { checkId: check.id, at: NOW - 60_000, ok: true, totalMs: 120, assertionResults: [] });
    recordRun(db, { checkId: check.id, at: NOW, ok: false, totalMs: null, failureReason: 'timeout', assertionResults: [] });

    const runs = recentRuns(db, check.id, 10);
    expect(runs[0]).toMatchObject({ ok: false, failureReason: 'timeout' });
    // Null, not zero: a run that never connected measured nothing.
    expect(runs[0]?.totalMs).toBeNull();
    expect(runs.map(toOutcome)[0]).toEqual({ at: NOW, ok: false, totalMs: null });
  });

  it('THE RULING: deleting a check takes its runs, leaving no history nobody can attribute', () => {
    const db = createTestDb();
    const check = upsertCheck(db, base, NOW);
    recordRun(db, { checkId: check.id, at: NOW, ok: true, totalMs: 100, assertionResults: [] });

    deleteCheck(db, check.id);
    expect(recentRuns(db, check.id, 10)).toEqual([]);
  });
});
