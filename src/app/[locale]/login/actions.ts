'use server';

import { redirect } from '@/i18n/navigation';
import { authenticate } from '@/lib/auth/admin';
import { clientIp, startSession } from '@/lib/auth/current';
import { GLOBAL_LOGIN_KEY, globalLoginLimiter, loginLimiter } from '@/lib/auth/login-limiter';
import { getDb } from '@/lib/db/client';

export type LoginState = { error?: 'invalid_credentials' | 'rate_limited' };

export async function loginAction(locale: string, _prev: LoginState, formData: FormData): Promise<LoginState> {
  const ip = await clientIp();
  if (!globalLoginLimiter.attempt(GLOBAL_LOGIN_KEY) || !loginLimiter.attempt(ip)) {
    return { error: 'rate_limited' };
  }
  const adminId = await authenticate(
    getDb(),
    String(formData.get('email') ?? ''),
    String(formData.get('password') ?? ''),
  );
  if (adminId === null) {
    return { error: 'invalid_credentials' };
  }
  loginLimiter.reset(ip);
  globalLoginLimiter.reset(GLOBAL_LOGIN_KEY);
  await startSession(adminId);
  // `return` so TypeScript accepts this as the function's final return statement (see current.ts).
  return redirect({ href: '/accounts', locale });
}
