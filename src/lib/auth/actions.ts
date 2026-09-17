'use server';

import 'server-only';
import { redirect } from '@/i18n/navigation';
import { resolveLocale } from '@/i18n/routing';
import { endSession } from './current';

export async function signOutAction(locale: string): Promise<void> {
  await endSession();
  redirect({ href: '/login', locale: resolveLocale(locale) });
}
