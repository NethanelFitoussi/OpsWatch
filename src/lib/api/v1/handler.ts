import 'server-only';
import { type Role, type TokenAudience, permissionsOf } from '@opswatch/contract';
import { resolveLocale, type AppLocale } from '@/i18n/routing';
import { findAdmin } from '../../auth/admin';
import { SESSION_COOKIE } from '../../auth/current';
import { validateSession } from '../../auth/sessions';
import type { Db } from '../../db/client';
import { getDb } from '../../db/client';
import { env } from '../../env';
import { isSameOrigin } from '../../http/origin';
import { apiFailure } from './envelope';

/**
 * The one handler every `/api/v1` route is built from. It fixes, in one place, the order the design requires —
 * Origin when the method mutates, then the session, and only then anything a route wants to read — so a new
 * endpoint inherits all of it by existing rather than by remembering.
 */
type Actor = {
  adminId: number;
  email: string;
  role: Role;
  /** Which credential the caller presented: the browser cookie, or a bearer token. */
  audience: TokenAudience;
  locale: AppLocale;
  /** What this actor is allowed to do, as the contract's permission names. Convenience; the server checks again. */
  allowedActions: string[];
  /** The credential itself, so a route can mark the caller's own session in a list. Never put in a response. */
  token: string;
};

export type ApiContext<P> = { request: Request; url: URL; params: P; db: Db; actor: Actor };
export type PublicApiContext<P> = Omit<ApiContext<P>, 'actor'>;

type RouteHandler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

type Options = {
  /** POST, PUT, PATCH and DELETE. A mutating route is Origin-checked before anything else happens. */
  mutating?: boolean;
};

const EMPTY = {} as Record<string, never>;

/** An endpoint that requires a signed-in caller. Every route but `GET /server` and `POST /auth/login` is one. */
export function apiRoute<P = Record<string, never>>(
  options: Options & { handler: (context: ApiContext<P>) => Promise<Response> | Response },
): RouteHandler<P> {
  return build(options.mutating ?? false, async (base) => {
    const actor = authenticate(base.db, base.request, base.url);
    return actor === null ? apiFailure('unauthorized') : options.handler({ ...base, actor });
  });
}

/** An endpoint anyone may call. It must never read anything that belongs to a user. */
export function publicApiRoute<P = Record<string, never>>(
  options: Options & { handler: (context: PublicApiContext<P>) => Promise<Response> | Response },
): RouteHandler<P> {
  return build(options.mutating ?? false, (base) => options.handler(base));
}

function build<P>(mutating: boolean, run: (base: PublicApiContext<P>) => Promise<Response> | Response): RouteHandler<P> {
  return async (request, context) => {
    try {
      if (mutating && !originAccepted(request)) return apiFailure('forbidden_origin');
      const url = new URL(request.url);
      const params = ((await context?.params) ?? EMPTY) as P;
      return await run({ request, url, params, db: getDb() });
    } catch {
      // Nothing about the failure reaches the caller: a stack trace or a driver message is a disclosure.
      return apiFailure('internal_error');
    }
  };
}

/**
 * The Origin rule, stated exactly: an ambient credential needs it, a bearer token does not.
 *
 * A browser attaches the session cookie to a cross-site request by itself, which is the whole of CSRF, and it always
 * sends `Origin` on a mutating request — so a mutating request that carries either a cookie or an `Origin` must
 * carry an `Origin` that matches. A native client sends neither, attaches nothing by itself, and is let through.
 */
function originAccepted(request: Request): boolean {
  const carriesCookie = cookieToken(request) !== null;
  const declaresOrigin = request.headers.get('origin') !== null;
  if (!carriesCookie && !declaresOrigin) return true;
  return isSameOrigin(request, env().OPSWATCH_PUBLIC_URL);
}

function bearerToken(request: Request): string | null {
  return request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
}

function cookieToken(request: Request): string | null {
  const cookies = request.headers.get('cookie');
  if (!cookies) return null;
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

/**
 * The caller, or null. A bearer token is never accepted as a cookie and a cookie is never accepted as a bearer
 * token, because each is validated against its own audience — that is what stops a stolen mobile token from being
 * replayed as a browser session. A bearer token that fails is not retried as a cookie either: the caller said which
 * credential it meant to use.
 */
function authenticate(db: Db, request: Request, url: URL): Actor | null {
  const bearer = bearerToken(request);
  const audience: TokenAudience = bearer === null ? 'web' : 'api';
  const token = bearer ?? cookieToken(request);
  if (token === null) return null;
  const adminId = validateSession(db, token, env().OPSWATCH_SECRET, new Date(), audience);
  if (adminId === null) return null;
  const admin = findAdmin(db);
  if (!admin || admin.id !== adminId) return null;
  // One account today, and it is the administrator. §10.3 adds the users table without changing this shape.
  const role: Role = 'admin';
  return {
    adminId,
    email: admin.email,
    role,
    audience,
    locale: requestLocale(request, url),
    allowedActions: permissionsOf(role),
    token,
  };
}

/** `?locale=` first, then `Accept-Language`, so a client can ask for a locale without changing its headers. */
function requestLocale(request: Request, url: URL): AppLocale {
  const asked = url.searchParams.get('locale');
  if (asked !== null) return resolveLocale(asked);
  return resolveLocale(request.headers.get('accept-language')?.split(',')[0]?.trim().slice(0, 2));
}
