import 'server-only';
import { setRequestLocale } from 'next-intl/server';
import { resolveLocale, type AppLocale } from '@/i18n/routing';
import { requireAdmin } from './current';

/**
 * Preamble of every protected page and layout. Each page calls it itself: the (app) layout also
 * checks, but a layout does not stop a page segment from rendering in an RSC request.
 */
export async function initProtectedRoute(params: Promise<{ locale: string }>): Promise<{ locale: AppLocale; adminId: number }> {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const adminId = await requireAdmin(locale);
  return { locale, adminId };
}
