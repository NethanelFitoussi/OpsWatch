import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/db';


let db: ReturnType<typeof createTestDb>;
const requireAdmin = vi.fn(async () => 7);

vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => db,
}));
vi.mock('@/lib/auth/current', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/current')>()),
  requireAdmin: () => requireAdmin(),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (Test)' }),
}));

const { auditedAdmin } = await import('@/lib/auth/audited');
const { listAudit } = await import('@/lib/store/audit');

beforeEach(() => {
  db = createTestDb();
  requireAdmin.mockClear();
});

describe('§21 — an administrator action records its outcome', () => {
  it('records a success', async () => {
    const result = await auditedAdmin('en', 'history_update', 'settings', async () => ({ saved: true }));
    expect(result).toEqual({ saved: true });

    const [row] = listAudit(db, {}, 10);
    expect(row).toMatchObject({ action: 'history_update', subjectType: 'settings', result: 'ok', actorUserId: 7 });
  });

  it('THE RULING: a validation refusal is `denied`, not `ok` and not `failed`', async () => {
    // A form action that returned an error was refused, not broken. The two read very differently to
    // somebody reviewing a log, and the helper reads it from the result so no caller can get it wrong.
    await auditedAdmin('en', 'history_update', 'settings', async () => ({ error: 'invalid_interval' }));
    const [row] = listAudit(db, {}, 10);
    expect(row).toMatchObject({ result: 'denied', details: { reason: 'invalid_interval' } });
  });

  it('THE RULING: a crash mid-action is a row, not a silence', async () => {
    await expect(
      auditedAdmin('en', 'synthetic_update', 'synthetic', async () => {
        throw new TypeError('secret path /etc/opswatch/key');
      }),
    ).rejects.toThrow();

    const [row] = listAudit(db, {}, 10);
    expect(row).toMatchObject({ result: 'failed' });
    // The error's name, never its message: a message can carry a path, a query or a credential.
    expect(JSON.stringify(row.details)).toBe(JSON.stringify({ error: 'TypeError' }));
    expect(JSON.stringify(row)).not.toContain('/etc/opswatch/key');
  });

  it('takes the first hop of x-forwarded-for, which is the client', async () => {
    await auditedAdmin('en', 'history_update', 'settings', async () => ({ saved: true }));
    // The rest of the chain is proxies, and recording them as the caller would be wrong.
    expect(listAudit(db, {}, 1)[0]?.ip).toBe('203.0.113.7');
  });

  it('hashes the user agent rather than storing it', async () => {
    await auditedAdmin('en', 'history_update', 'settings', async () => ({ saved: true }));
    const [row] = listAudit(db, {}, 1);
    expect(row.userAgentHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain('Mozilla');
  });

  it('requires an administrator before it does anything', async () => {
    await auditedAdmin('en', 'history_update', 'settings', async () => ({ saved: true }));
    expect(requireAdmin).toHaveBeenCalled();
  });
});

describe('MC-12 — the account an action was about', () => {
  it('THE RULING: a redirect is how a successful action ends, not how one fails', async () => {
    // `redirect()` and `notFound()` work by throwing, and the throw reaches the same `catch` a crash
    // does. Recorded as `failed`, the log would say an administrator's successful change had broken —
    // which is worse than no row, because somebody would believe it.
    const redirecting = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/en/accounts;307;' });
    await expect(
      auditedAdmin('en', 'connection_update', 'connection', async () => {
        throw redirecting;
      }),
    ).rejects.toBe(redirecting);

    expect(listAudit(db, {}, 1)[0]).toMatchObject({ result: 'ok' });
  });

  it('still records a real crash as failed, by its name and never its message', async () => {
    const boom = Object.assign(new Error('secret-bearing message'), { name: 'RangeError' });
    await expect(
      auditedAdmin('en', 'connection_update', 'connection', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const [row] = listAudit(db, {}, 1);
    expect(row).toMatchObject({ result: 'failed', details: { error: 'RangeError' } });
    expect(JSON.stringify(row)).not.toContain('secret-bearing');
  });

  it('carries the connection when it is given one, and nothing when it is not', async () => {
    await auditedAdmin('en', 'log_source_update', 'log_source', async () => ({}), { connectionId: 'abc123def456' });
    await auditedAdmin('en', 'history_update', 'settings', async () => ({}));

    const rows = listAudit(db, {}, 10);
    expect(rows.find((row) => row.action === 'log_source_update')?.connectionId).toBe('abc123def456');
    expect(rows.find((row) => row.action === 'history_update')?.connectionId).toBeNull();
  });

  it('keeps the old positional subject id working, so no caller had to be rewritten to stay correct', async () => {
    await auditedAdmin('en', 'host_update', 'host', async () => ({}), 'host-1');
    expect(listAudit(db, {}, 1)[0]).toMatchObject({ subjectId: 'host-1', connectionId: null });
  });

  it('asks for one account’s actions, or for the ones belonging to no account at all', async () => {
    await auditedAdmin('en', 'log_source_update', 'log_source', async () => ({}), { connectionId: 'abc123def456' });
    await auditedAdmin('en', 'history_update', 'settings', async () => ({}));

    expect(listAudit(db, { connectionId: 'abc123def456' }, 10).map((row) => row.action)).toEqual(['log_source_update']);
    // `null` is a question, not a missing filter: "what was done to this installation itself".
    expect(listAudit(db, { connectionId: null }, 10).map((row) => row.action)).toEqual(['history_update']);
    expect(listAudit(db, {}, 10)).toHaveLength(2);
  });
});
