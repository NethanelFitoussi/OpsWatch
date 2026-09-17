'use server';

import { redirect } from '@/i18n/navigation';
import { AdminExistsError, AdminValidationError, createAdmin } from '@/lib/auth/admin';
import { startSession } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';

export type SetupState = {
  error?: 'email_invalid' | 'password_too_short' | 'password_mismatch' | 'admin_exists';
  /** Echoed back so the field keeps its value after an error. Passwords never are. */
  email?: string;
};

export async function setupAction(locale: string, _prev: SetupState, formData: FormData): Promise<SetupState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (password !== String(formData.get('confirmPassword') ?? '')) {
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
  return redirect({ href: '/accounts', locale });
}
