'use server';

import { redirect } from '@/i18n/navigation';
import { authenticate } from '@/lib/auth/admin';
import { clientIp, startSession } from '@/lib/auth/current';
import { loginLimiter, loginThrottle } from '@/lib/auth/login-limiter';
import { getDb } from '@/lib/db/client';

export type LoginState = {
  error?: 'invalid_credentials' | 'rate_limited';
  /** Echoed back so the field keeps its value after an error. The password never is. */
  email?: string;
};

export async function loginAction(locale: string, _prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const ip = await clientIp();
  if (!loginLimiter.attempt(ip)) {
    return { error: 'rate_limited', email };
  }
  const outcome = await loginThrottle.run(() =>
    authenticate(getDb(), email, String(formData.get('password') ?? '')),
  );
  if (outcome.limited) {
    return { error: 'rate_limited', email };
  }
  const adminId = outcome.value;
  if (adminId === null) {
    loginThrottle.recordFailure();
    return { error: 'invalid_credentials', email };
  }
  loginLimiter.reset(ip);
  await startSession(adminId);
  // `return` so TypeScript accepts this as the function's final return statement (see current.ts).
  return redirect({ href: '/accounts', locale });
}
