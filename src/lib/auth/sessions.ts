import 'server-only';
import { and, eq, lte } from 'drizzle-orm';
import type { SessionSummary, TokenAudience } from '@opswatch/contract';
import { hashToken, randomToken } from '../crypto';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

/** The rolling window of a browser session: 12 hours of inactivity ends it. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** The rolling window of a bearer token. A phone is opened far less often than a browser tab is used. */
export const API_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ROLLING_TTL_MS: Record<TokenAudience, number> = { web: SESSION_TTL_MS, api: API_SESSION_TTL_MS };

/**
 * The ceiling no amount of use can push past, counted from when the session was created. A rolling window on its own
 * would let a token that is used daily live for ever, which is exactly what a stolen one would do.
 */
export const SESSION_ABSOLUTE_TTL_MS: Record<TokenAudience, number> = {
  web: 30 * 24 * 60 * 60 * 1000,
  api: 90 * 24 * 60 * 60 * 1000,
};

/** Sessions are otherwise only deleted when their token is presented again, so abandoned ones would pile up. */
function deleteExpiredSessions(db: Db, now: Date): void {
  db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
}

const rollingExpiry = (audience: TokenAudience, now: Date) => new Date(now.getTime() + ROLLING_TTL_MS[audience]);
const absoluteExpiry = (audience: TokenAudience, createdAt: Date) => createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS[audience];

/**
 * The id a session is known by outside the server. It is derived from the stored id rather than being it: the stored
 * id is the key a presented token is looked up by, and nothing used to find a session should travel in a response.
 * Deriving it costs one HMAC, and means no extra column and no extra migration.
 */
function publicIdOf(storedId: string, secret: string): string {
  return hashToken(`session-public:${storedId}`, secret).slice(0, 32);
}

export function createSession(
  db: Db,
  adminUserId: number,
  secret: string,
  now: Date = new Date(),
  audience: TokenAudience = 'web',
): string {
  deleteExpiredSessions(db, now);
  const token = randomToken();
  db.insert(sessions)
    .values({
      id: hashToken(token, secret),
      adminUserId,
      expiresAt: rollingExpiry(audience, now),
      createdAt: now,
      audience,
      lastUsedAt: null,
    })
    .run();
  return token;
}

/**
 * The admin behind a token, or null. A token minted for another audience is refused and left alone: it is a valid
 * session of the other kind, and destroying it would turn a misdirected request into a sign-out.
 */
export function validateSession(
  db: Db,
  token: string,
  secret: string,
  now: Date = new Date(),
  audience: TokenAudience = 'web',
): number | null {
  const id = hashToken(token, secret);
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row || row.audience !== audience) {
    return null;
  }
  if (row.expiresAt.getTime() <= now.getTime() || absoluteExpiry(audience, row.createdAt) <= now.getTime()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  db.update(sessions)
    .set({ expiresAt: rollingExpiry(audience, now), lastUsedAt: now })
    .where(eq(sessions.id, id))
    .run();
  return row.adminUserId;
}

export function deleteSession(db: Db, token: string, secret: string): void {
  db.delete(sessions).where(eq(sessions.id, hashToken(token, secret))).run();
}

/**
 * Every session of one user, oldest first, with the one making the request marked. Nothing in the result can be
 * presented as a credential, so a lost device is cut off from here without rotating `OPSWATCH_SECRET`.
 */
export function listSessions(
  db: Db,
  adminUserId: number,
  secret: string,
  current: { token: string; audience: TokenAudience },
): SessionSummary[] {
  const currentId = hashToken(current.token, secret);
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.adminUserId, adminUserId))
    .all()
    .map((row) => ({
      id: publicIdOf(row.id, secret),
      audience: row.audience,
      createdAt: row.createdAt.getTime(),
      lastUsedAt: row.lastUsedAt?.getTime() ?? null,
      expiresAt: row.expiresAt.getTime(),
      absoluteExpiresAt: absoluteExpiry(row.audience, row.createdAt),
      current: row.id === currentId && row.audience === current.audience,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Revokes one session of one user by its public id. False when that user owns no session with that id. */
export function revokeSession(db: Db, adminUserId: number, publicId: string, secret: string): boolean {
  const row = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.adminUserId, adminUserId))
    .all()
    .find((candidate) => publicIdOf(candidate.id, secret) === publicId);
  if (!row) return false;
  db.delete(sessions).where(and(eq(sessions.id, row.id), eq(sessions.adminUserId, adminUserId))).run();
  return true;
}
