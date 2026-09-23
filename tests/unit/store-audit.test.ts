import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, appendAudit, countAudit, hashUserAgent, listAudit } from '@/lib/store/audit';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;

const entry = (over: Partial<Parameters<typeof appendAudit>[1]> = {}) => ({
  at: NOW,
  actorUserId: 1,
  actorKind: 'user' as const,
  action: 'sign_in' as const,
  result: 'ok' as const,
  ...over,
});

describe('§21 — the log is append-only, and that is structural', () => {
  it('THE RULING: the store contains no update and no delete against the audit table', () => {
    /**
     * A log somebody can edit is not evidence. The only way to be sure of that is for the statements not
     * to exist, so a reviewer checking the claim reads this file and finds `insert` and `select` and
     * nothing else. This test is that reviewer.
     */
    const source = readFileSync(new URL('../../src/lib/store/audit.ts', import.meta.url), 'utf8');
    // The database-builder form specifically: a bare `.update(` also matches `createHash().update()`,
    // which is a hash and not a mutation. Matching that would be a test that fails for the wrong reason.
    expect(source).not.toMatch(/\b(?:db|tx)\s*\.\s*update\(/);
    expect(source).not.toMatch(/\b(?:db|tx)\s*\.\s*delete\(/);
    expect(source).toMatch(/\bdb\s*\.\s*insert\(/);
  });

  it('records a failure as readily as a success, or the log proves nothing', () => {
    const db = createTestDb();
    appendAudit(db, entry({ result: 'denied' }));
    appendAudit(db, entry({ result: 'ok', at: NOW + MINUTE }));
    // A log that only holds successes cannot answer "did somebody try and fail?", which is the question.
    expect(listAudit(db, {}, 10).map((row) => row.result)).toEqual(['ok', 'denied']);
  });
});

describe('§21 — what a row may and may not carry', () => {
  it('THE RULING: the user agent is hashed, never stored', () => {
    const agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    const db = createTestDb();
    appendAudit(db, entry({ userAgent: agent }));

    const [row] = listAudit(db, {}, 1);
    // Enough to tell two devices apart; not enough to fingerprint one, and not a record of somebody's
    // browser and device model kept forever.
    expect(row.userAgentHash).not.toBe(agent);
    expect(row.userAgentHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain('Macintosh');
  });

  it('hashes consistently, so the same device reads as the same device', () => {
    expect(hashUserAgent('a')).toBe(hashUserAgent('a'));
    expect(hashUserAgent('a')).not.toBe(hashUserAgent('b'));
  });

  it('answers null for no user agent rather than hashing an empty string', () => {
    expect(hashUserAgent(null)).toBeNull();
    expect(hashUserAgent('   ')).toBeNull();
  });

  it('records a system actor with no user', () => {
    const db = createTestDb();
    appendAudit(db, entry({ actorKind: 'system', actorUserId: null, action: 'retention_purge' }));
    expect(listAudit(db, {}, 1)[0]).toMatchObject({ actorKind: 'system', actorUserId: null });
  });
});

describe('reading it back', () => {
  it('is newest first', () => {
    const db = createTestDb();
    appendAudit(db, entry({ at: NOW - MINUTE, action: 'sign_in' }));
    appendAudit(db, entry({ at: NOW, action: 'sign_out' }));
    expect(listAudit(db, {}, 10).map((row) => row.action)).toEqual(['sign_out', 'sign_in']);
  });

  it('filters by action, by actor and by window', () => {
    const db = createTestDb();
    appendAudit(db, entry({ action: 'sign_in', actorUserId: 1 }));
    appendAudit(db, entry({ action: 'token_create', actorUserId: 2, at: NOW + MINUTE }));

    expect(listAudit(db, { action: 'token_create' }, 10)).toHaveLength(1);
    expect(listAudit(db, { actorUserId: 1 }, 10)).toHaveLength(1);
    expect(listAudit(db, { sinceMs: NOW + MINUTE }, 10)).toHaveLength(1);
    expect(countAudit(db)).toBe(2);
  });

  it('names every action as a closed list, so a typo is a compile error', () => {
    expect(AUDIT_ACTIONS).toContain('sign_in');
    expect(AUDIT_ACTIONS).toContain('retention_purge');
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});
