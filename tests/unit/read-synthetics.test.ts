import { describe, expect, it } from 'vitest';
import { syntheticSummarySchema } from '@opswatch/contract';
import { listSyntheticSummaries, successShare, sslOf } from '@/lib/read/synthetics';
import { recordRun, upsertCheck } from '@/lib/store/synthetics';
import { createTestDb } from '../helpers/db';

/**
 * What a client is told about a synthetic check (§14, SYN-1).
 *
 * The rule that shapes it: a check that has never run is `unknown`, and every ratio is `null` until there
 * is a run to compute it from. "Up" and "we have not looked" must never render the same (§2.4).
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };

const check = (db: ReturnType<typeof createTestDb>, over: Partial<Parameters<typeof upsertCheck>[1]> = {}) =>
  upsertCheck(db, { ...env, name: 'Checkout', url: 'https://example.com/healthz', enabled: true, assertions: [], ...over }, NOW);

const run = (db: ReturnType<typeof createTestDb>, checkId: string, over: Partial<Parameters<typeof recordRun>[1]> = {}) =>
  recordRun(db, { checkId, at: NOW - MINUTE, ok: true, totalMs: 120, assertionResults: [], ...over });

describe('the share of runs that passed', () => {
  it('THE RULING: no runs is null, which is neither nought nor one', () => {
    expect(successShare([])).toBeNull();
    expect(successShare([{ ok: false }])).toBe(0);
    expect(successShare([{ ok: true }])).toBe(1);
  });
});

describe('the certificate a run saw', () => {
  it('is absent for a check with none, because no certificate is not a healthy certificate', () => {
    expect(sslOf(undefined, NOW)).toBeNull();
  });

  it('decides validity against the clock rather than storing it', () => {
    const db = createTestDb();
    const one = check(db);
    const future = run(db, one.id, { certificateExpiresAt: NOW + 30 * 24 * 60 * 60_000 });
    expect(sslOf(future, NOW)).toMatchObject({ valid: true });
    // The same stored row, read after it expired. The expiry is still true; "valid" is not.
    expect(sslOf(future, NOW + 60 * 24 * 60 * 60_000)).toMatchObject({ valid: false });
  });
});

describe('a check on the wire', () => {
  it('is exactly what every client parses', () => {
    const db = createTestDb();
    const one = check(db);
    run(db, one.id);
    const [summary] = listSyntheticSummaries(db, env, NOW);
    expect(() => syntheticSummarySchema.parse(summary)).not.toThrow();
  });

  it('THE RULING: a check that has never run is unknown, with no figures at all', () => {
    const db = createTestDb();
    check(db);

    const [summary] = listSyntheticSummaries(db, env, NOW);
    expect(summary).toMatchObject({
      status: 'unknown',
      availability24h: null,
      uptime30d: null,
      latencyMs: null,
      ssl: null,
      lastCheckedAt: null,
    });
  });

  it('is listed even when it is switched off, so a forgotten check is visible', () => {
    const db = createTestDb();
    check(db, { name: 'Paused', enabled: false });
    expect(listSyntheticSummaries(db, env, NOW)).toHaveLength(1);
  });

  it('reports availability over a day and uptime over a month separately', () => {
    const db = createTestDb();
    const one = check(db);
    // Today: one of two passed. Three weeks ago: one more failure, outside the day and inside the month.
    run(db, one.id, { at: NOW - MINUTE, ok: true });
    run(db, one.id, { at: NOW - 2 * MINUTE, ok: false });
    run(db, one.id, { at: NOW - 21 * 24 * 60 * 60_000, ok: false });

    const [summary] = listSyntheticSummaries(db, env, NOW);
    expect(summary.availability24h).toBe(0.5);
    expect(summary.uptime30d).toBeCloseTo(1 / 3, 6);
  });

  it('THE RULING: two consecutive failures is down, and one is not (§14)', () => {
    const db = createTestDb();
    const one = check(db);
    run(db, one.id, { at: NOW - MINUTE, ok: false });
    expect(listSyntheticSummaries(db, env, NOW)[0].status).not.toBe('down');

    run(db, one.id, { at: NOW - 30_000, ok: false });
    expect(listSyntheticSummaries(db, env, NOW)[0].status).toBe('down');
  });

  it('says when it was last checked, which is what tells a stale check from a passing one', () => {
    const db = createTestDb();
    const one = check(db);
    run(db, one.id, { at: NOW - 5 * MINUTE });
    expect(listSyntheticSummaries(db, env, NOW)[0].lastCheckedAt).toBe(NOW - 5 * MINUTE);
  });

  it('is scoped to its environment', () => {
    const db = createTestDb();
    check(db);
    expect(listSyntheticSummaries(db, { connectionId: 'c1', scope: 'eu-west-1' }, NOW)).toEqual([]);
  });
});
