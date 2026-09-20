import { describe, expect, it } from 'vitest';
import { attemptLogin } from '@/lib/auth/login';
import { createAdmin } from '@/lib/auth/admin';
import { createLoginThrottle } from '@/lib/auth/login-throttle';
import { createRateLimiter } from '@/lib/auth/rate-limit';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';
import { NOW, PASSWORD } from '../helpers/fixtures';

const EMAIL = 'a@example.com';

async function setup() {
  const db = createTestDb();
  const adminId = await createAdmin(db, { email: EMAIL, password: PASSWORD }, NOW);
  // The same shape the web form uses, built per test so one test cannot exhaust another's budget.
  const deps = { db: db as Db, limiter: createRateLimiter({ limit: 5, windowMs: 60_000 }), throttle: createLoginThrottle() };
  return { db, adminId, deps };
}

describe('the login service', () => {
  it('signs in with the right password and refuses the wrong one', async () => {
    const { adminId, deps } = await setup();
    expect(await attemptLogin({ email: EMAIL, password: PASSWORD, ip: '1.2.3.4' }, deps)).toEqual({ ok: true, adminId });
    expect(await attemptLogin({ email: EMAIL, password: 'wrong password!', ip: '1.2.3.4' }, deps)).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
  });

  it('applies the per-client throttle the web form uses, and clears it on success', async () => {
    const { deps } = await setup();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await attemptLogin({ email: EMAIL, password: 'wrong password!', ip: '9.9.9.9' }, deps)).toEqual({
        ok: false,
        reason: 'invalid_credentials',
      });
    }
    expect(await attemptLogin({ email: EMAIL, password: PASSWORD, ip: '9.9.9.9' }, deps)).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    // Another client is unaffected, and signing in there clears its own budget.
    expect(await attemptLogin({ email: EMAIL, password: PASSWORD, ip: '8.8.8.8' }, deps)).toMatchObject({ ok: true });
    expect(await attemptLogin({ email: EMAIL, password: PASSWORD, ip: '8.8.8.8' }, deps)).toMatchObject({ ok: true });
  });

  it('refuses while the global slowdown is saturated, without spending a password check', async () => {
    const { deps } = await setup();
    const saturated = {
      ...deps,
      throttle: { run: async () => ({ limited: true as const }), recordFailure: () => undefined },
    };
    expect(await attemptLogin({ email: EMAIL, password: PASSWORD, ip: '1.1.1.1' }, saturated)).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
  });

  it('records a failure with the global throttle so guessing slows everyone down', async () => {
    const { deps } = await setup();
    let failures = 0;
    const counting = { ...deps, throttle: { ...deps.throttle, recordFailure: () => { failures += 1; } } };
    await attemptLogin({ email: EMAIL, password: 'wrong password!', ip: '1.1.1.1' }, counting);
    await attemptLogin({ email: EMAIL, password: PASSWORD, ip: '1.1.1.1' }, counting);
    expect(failures).toBe(1);
  });
});
