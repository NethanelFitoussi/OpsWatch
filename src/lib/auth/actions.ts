'use server';

import { redirect } from '@/i18n/navigation';
import { endSession } from './current';

export async function signOutAction(locale: string): Promise<void> {
  await endSession();
  redirect({ href: '/login', locale });
}
