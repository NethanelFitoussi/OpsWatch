'use server';

import { redirect } from '@/i18n/navigation';
import { resolveLocale } from '@/i18n/routing';
import { authenticate } from '@/lib/auth/admin';
import { clientIp, startSession } from '@/lib/auth/current';
import { loginLimiter, loginThrottle } from '@/lib/auth/login-limiter';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';

/** The email is echoed back so the field keeps its value after an error. The password never is. */
export type LoginState = ActionState<'invalid_credentials' | 'rate_limited', { email: string }>;

export async function loginAction(locale: string, _prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = formString(formData, 'email');
  const ip = await clientIp();
  if (!loginLimiter.attempt(ip)) {
    return { error: 'rate_limited', email };
  }
  const outcome = await loginThrottle.run(() => authenticate(getDb(), email, formString(formData, 'password')));
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
  return redirect({ href: '/accounts', locale: resolveLocale(locale) });
}
