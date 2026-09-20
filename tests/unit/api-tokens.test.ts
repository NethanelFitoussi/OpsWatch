import { describe, expect, it } from 'vitest';
import {
  API_SESSION_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TTL_MS,
  createSession,
  listSessions,
  revokeSession,
  validateSession,
} from '@/lib/auth/sessions';
import { createAdmin } from '@/lib/auth/admin';
import { createTestDb } from '../helpers/db';
import { NOW, PASSWORD, TEST_SECRET as SECRET } from '../helpers/fixtures';

const at = (ms: number) => new Date(NOW.getTime() + ms);
const admin = async () => {
  const db = createTestDb();
  return { db, adminId: await createAdmin(db, { email: 'a@example.com', password: PASSWORD }, NOW) };
};

describe('bearer tokens carry an audience', () => {
  it('refuses a bearer token presented as a browser session, and the reverse', async () => {
    const { db, adminId } = await admin();
    const bearer = createSession(db, adminId, SECRET, NOW, 'api');
    const cookie = createSession(db, adminId, SECRET, NOW, 'web');

    expect(validateSession(db, bearer, SECRET, NOW, 'api')).toBe(adminId);
    expect(validateSession(db, cookie, SECRET, NOW, 'web')).toBe(adminId);

    expect(validateSession(db, bearer, SECRET, NOW, 'web')).toBeNull();
    expect(validateSession(db, cookie, SECRET, NOW, 'api')).toBeNull();
  });

  it('does not destroy the session it refused', async () => {
    const { db, adminId } = await admin();
    const bearer = createSession(db, adminId, SECRET, NOW, 'api');
    expect(validateSession(db, bearer, SECRET, NOW, 'web')).toBeNull();
    expect(validateSession(db, bearer, SECRET, NOW, 'api')).toBe(adminId);
  });

  it('defaults to the browser audience, so existing callers are unchanged', async () => {
    const { db, adminId } = await admin();
    const token = createSession(db, adminId, SECRET, NOW);
    expect(validateSession(db, token, SECRET, NOW)).toBe(adminId);
    expect(validateSession(db, token, SECRET, NOW, 'api')).toBeNull();
  });
});

describe('the absolute lifetime ceiling', () => {
  it('sits above the rolling window of both audiences', () => {
    expect(SESSION_ABSOLUTE_TTL_MS.web).toBeGreaterThan(SESSION_TTL_MS);
    expect(SESSION_ABSOLUTE_TTL_MS.api).toBeGreaterThan(API_SESSION_TTL_MS);
  });

  it('ends a bearer token that has been kept alive by use', async () => {
    const { db, adminId } = await admin();
    const token = createSession(db, adminId, SECRET, NOW, 'api');
    // Used every day, so the rolling window never runs out on its own.
    for (let day = 1; day * 86_400_000 < SESSION_ABSOLUTE_TTL_MS.api; day += 1) {
      expect(validateSession(db, token, SECRET, at(day * 86_400_000), 'api')).toBe(adminId);
    }
    expect(validateSession(db, token, SECRET, at(SESSION_ABSOLUTE_TTL_MS.api + 1), 'api')).toBeNull();
  });

  it('still ends a session that goes unused for the rolling window', async () => {
    const { db, adminId } = await admin();
    const token = createSession(db, adminId, SECRET, NOW, 'api');
    expect(validateSession(db, token, SECRET, at(API_SESSION_TTL_MS + 1), 'api')).toBeNull();
  });
});

describe('listing and revoking sessions', () => {
  it('lists every session of the user with the current one marked, and no credential', async () => {
    const { db, adminId } = await admin();
    const cookie = createSession(db, adminId, SECRET, NOW, 'web');
    const bearer = createSession(db, adminId, SECRET, at(1000), 'api');
    validateSession(db, bearer, SECRET, at(2000), 'api');

    const items = listSessions(db, adminId, SECRET, { token: bearer, audience: 'api' });
    expect(items).toHaveLength(2);
    const current = items.find((item) => item.current);
    expect(current?.audience).toBe('api');
    expect(current?.createdAt).toBe(NOW.getTime() + 1000);
    expect(current?.lastUsedAt).toBe(NOW.getTime() + 2000);
    expect(current?.absoluteExpiresAt).toBe(NOW.getTime() + 1000 + SESSION_ABSOLUTE_TTL_MS.api);

    const serialised = JSON.stringify(items);
    expect(serialised).not.toContain(cookie);
    expect(serialised).not.toContain(bearer);
  });

  it('cuts off one device without touching the others or the secret', async () => {
    const { db, adminId } = await admin();
    const lost = createSession(db, adminId, SECRET, NOW, 'api');
    const kept = createSession(db, adminId, SECRET, at(1), 'api');
    const lostId = listSessions(db, adminId, SECRET, { token: lost, audience: 'api' }).find((item) => item.current)?.id;

    expect(revokeSession(db, adminId, lostId ?? '', SECRET)).toBe(true);
    expect(validateSession(db, lost, SECRET, at(2), 'api')).toBeNull();
    expect(validateSession(db, kept, SECRET, at(2), 'api')).toBe(adminId);
  });

  it('refuses to revoke a session of another user, and an id it never minted', async () => {
    const { db, adminId } = await admin();
    const token = createSession(db, adminId, SECRET, NOW, 'api');
    const [item] = listSessions(db, adminId, SECRET, { token, audience: 'api' });
    expect(revokeSession(db, adminId + 1, item.id, SECRET)).toBe(false);
    expect(revokeSession(db, adminId, 'not-an-id', SECRET)).toBe(false);
    expect(validateSession(db, token, SECRET, NOW, 'api')).toBe(adminId);
  });
});
