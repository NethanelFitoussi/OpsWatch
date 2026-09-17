import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { adminUser } from '../db/schema';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password';

export class AdminValidationError extends Error {
  constructor(public readonly code: 'email_invalid' | 'password_too_short') {
    super(code);
    this.name = 'AdminValidationError';
  }
}

export class AdminExistsError extends Error {
  constructor() {
    super('An admin account already exists');
    this.name = 'AdminExistsError';
  }
}

let dummyHash: Promise<string> | undefined;

export function hasAdmin(db: Db): boolean {
  return db.select({ id: adminUser.id }).from(adminUser).limit(1).get() !== undefined;
}

export async function createAdmin(
  db: Db,
  input: { email: string; password: string },
  now: Date = new Date(),
): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success) {
    throw new AdminValidationError('email_invalid');
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AdminValidationError('password_too_short');
  }
  if (hasAdmin(db)) {
    throw new AdminExistsError();
  }
  const passwordHash = await hashPassword(input.password);
  const row = db
    .insert(adminUser)
    .values({ email, passwordHash, createdAt: now })
    .returning({ id: adminUser.id })
    .get();
  return row.id;
}

export async function authenticate(db: Db, email: string, password: string): Promise<number | null> {
  const row = db
    .select()
    .from(adminUser)
    .where(eq(adminUser.email, email.trim().toLowerCase()))
    .get();
  if (!row) {
    // Spend the same time as a real check so response time does not reveal the email.
    dummyHash ??= hashPassword('opswatch-timing-equaliser');
    await verifyPassword(await dummyHash, password);
    return null;
  }
  return (await verifyPassword(row.passwordHash, password)) ? row.id : null;
}
