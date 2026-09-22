'use server';

import { redirect } from '@/i18n/navigation';
import { resolveLocale } from '@/i18n/routing';
import { clientIp, startSession } from '@/lib/auth/current';
import { attemptLogin } from '@/lib/auth/login';
import type { GoogleSignInError } from '@/lib/auth/google';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';

/** The email is echoed back so the field keeps its value after an error. The password never is. */
export type LoginState = ActionState<'invalid_credentials' | 'rate_limited' | GoogleSignInError, { email: string }>;

export async function loginAction(locale: string, _prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = formString(formData, 'email');
  // The same service `POST /api/v1/auth/login` calls: one budget and one slowdown, whichever door is tried.
  const outcome = await attemptLogin({ email, password: formString(formData, 'password'), ip: await clientIp() });
  if (!outcome.ok) {
    return { error: outcome.reason, email };
  }
  await startSession(outcome.adminId);
  // `return` so TypeScript accepts this as the function's final return statement (see current.ts).
  return redirect({ href: '/accounts', locale: resolveLocale(locale) });
}
