'use server';

import { redirect } from '@/i18n/navigation';
import { resolveLocale } from '@/i18n/routing';
import { AdminExistsError, AdminValidationError, createAdmin, type AdminValidationErrorCode } from '@/lib/auth/admin';
import { startSession } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';

/** The email is echoed back so the field keeps its value after an error. Passwords never are. */
export type SetupState = ActionState<AdminValidationErrorCode | 'password_mismatch' | 'admin_exists', { email: string }>;

export async function setupAction(locale: string, _prev: SetupState, formData: FormData): Promise<SetupState> {
  const email = formString(formData, 'email');
  const password = formString(formData, 'password');
  if (password !== formString(formData, 'confirmPassword')) {
    return { error: 'password_mismatch', email };
  }
  try {
    const adminId = await createAdmin(getDb(), { email, password });
    await startSession(adminId);
  } catch (error) {
    if (error instanceof AdminValidationError) return { error: error.code, email };
    if (error instanceof AdminExistsError) return { error: 'admin_exists', email };
    throw error;
  }
  // `return` so TypeScript accepts this as the function's final return statement (see current.ts).
  return redirect({ href: '/accounts', locale: resolveLocale(locale) });
}
