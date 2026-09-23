import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

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
