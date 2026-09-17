import 'server-only';
import { eq } from 'drizzle-orm';
import { hashToken, randomToken } from '../crypto';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createSession(db: Db, adminUserId: number, secret: string, now: Date = new Date()): string {
  const token = randomToken();
  db.insert(sessions)
    .values({
      id: hashToken(token, secret),
      adminUserId,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      createdAt: now,
    })
    .run();
  return token;
}

export function validateSession(db: Db, token: string, secret: string, now: Date = new Date()): number | null {
  const id = hashToken(token, secret);
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) {
    return null;
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  db.update(sessions)
    .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
    .where(eq(sessions.id, id))
    .run();
  return row.adminUserId;
}

export function deleteSession(db: Db, token: string, secret: string): void {
  db.delete(sessions).where(eq(sessions.id, hashToken(token, secret))).run();
}
