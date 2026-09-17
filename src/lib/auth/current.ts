import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from '@/i18n/navigation';
import { resolveLocale } from '@/i18n/routing';
import { getDb } from '../db/client';
import { env } from '../env';
import { hasAdmin } from './admin';
import { createSession, deleteSession, validateSession } from './sessions';

const SESSION_COOKIE = 'opswatch_session';

// The database enforces the 12 h rolling expiry; the cookie only needs to outlive it.
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Options of every OpsWatch cookie: HttpOnly, SameSite=Lax, and Secure when the public URL is https. */
export function cookieOptions(maxAge = COOKIE_MAX_AGE_SECONDS, path = '/') {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env().OPSWATCH_PUBLIC_URL?.startsWith('https://') ?? false,
    path,
    maxAge,
  };
}

export async function getCurrentAdminId(): Promise<number | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? validateSession(getDb(), token, env().OPSWATCH_SECRET) : null;
}

export async function requireAdmin(requestedLocale: string): Promise<number> {
  const locale = resolveLocale(requestedLocale);
  if (!hasAdmin(getDb())) {
    redirect({ href: '/setup', locale });
  }
  const adminId = await getCurrentAdminId();
  if (adminId === null) {
    // `return` (rather than a bare statement) so TypeScript accepts the narrowed, non-null
    // `adminId` below: `redirect`'s `never` return type does not otherwise flow through the
    // control-flow analysis of an explicitly-typed `Promise<number>` return.
    return redirect({ href: '/login', locale });
  }
  return adminId;
}

export async function startSession(adminId: number): Promise<void> {
  const token = createSession(getDb(), adminId, env().OPSWATCH_SECRET);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    deleteSession(getDb(), token, env().OPSWATCH_SECRET);
  }
  store.delete(SESSION_COOKIE);
}

// Forwarding headers can be forged by any client that reaches OpsWatch directly, so this value
// is only a best-effort bucket key. The global login limiter is what bounds password guessing.
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}
