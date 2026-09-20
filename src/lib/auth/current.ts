import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from '@/i18n/navigation';
import { resolveLocale } from '@/i18n/routing';
import { hashToken } from '../crypto';
import { getDb } from '../db/client';
import { env } from '../env';
import { hasAdmin } from './admin';
import { createSession, deleteSession, validateSession } from './sessions';

/** The browser session cookie. The API reads it by name too, so it is named in one place. */
export const SESSION_COOKIE = 'opswatch_session';

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

/** The signed-in admin and the id of their session row, or null. */
export async function getCurrentSession(): Promise<{ adminId: number; sessionId: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { OPSWATCH_SECRET } = env();
  const adminId = validateSession(getDb(), token, OPSWATCH_SECRET);
  // The stored session id (an HMAC of the token), so the token itself is never kept in memory maps.
  return adminId === null ? null : { adminId, sessionId: hashToken(token, OPSWATCH_SECRET) };
}

export async function getCurrentAdminId(): Promise<number | null> {
  return (await getCurrentSession())?.adminId ?? null;
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
