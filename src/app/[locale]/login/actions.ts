'use server';

import { redirect } from '@/i18n/navigation';
import { authenticate } from '@/lib/auth/admin';
import { clientIp, startSession } from '@/lib/auth/current';
import { loginLimiter, loginThrottle } from '@/lib/auth/login-limiter';
import { getDb } from '@/lib/db/client';

export type LoginState = { error?: 'invalid_credentials' | 'rate_limited' };

export async function loginAction(locale: string, _prev: LoginState, formData: FormData): Promise<LoginState> {
  const ip = await clientIp();
  if (!loginLimiter.attempt(ip)) {
    return { error: 'rate_limited' };
  }
  const outcome = await loginThrottle.run(() =>
    authenticate(getDb(), String(formData.get('email') ?? ''), String(formData.get('password') ?? '')),
  );
  if (outcome.limited) {
    return { error: 'rate_limited' };
  }
  const adminId = outcome.value;
  if (adminId === null) {
    loginThrottle.recordFailure();
    return { error: 'invalid_credentials' };
  }
  loginLimiter.reset(ip);
  await startSession(adminId);
  // `return` so TypeScript accepts this as the function's final return statement (see current.ts).
  return redirect({ href: '/accounts', locale });
}
