import { createAdmin } from '@/lib/auth/admin';
import { createSession } from '@/lib/auth/sessions';
import { roleArnFor } from '@/lib/aws/template';
import { createConnection, setRoleArn } from '@/lib/connections/repository';
import type { Db } from '@/lib/db/client';

/** An OPSWATCH_SECRET, and another one to simulate a changed secret. */
export const TEST_SECRET = 'k'.repeat(32);
export const OTHER_SECRET = 'o'.repeat(32);

export const ACCOUNT_ID = '111122223333';
export const NOW = new Date('2026-09-17T10:00:00Z');
export const PASSWORD = 'correct horse battery';

export type ConnectionInput = { name: string; method: string; awsAccountId: string; regions: string[] };

export function connectionInput(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return { name: 'production', method: 'role', awsAccountId: ACCOUNT_ID, regions: ['eu-west-1'], ...overrides };
}

/** The ARN of the OpsWatch role of a connection in ACCOUNT_ID. */
export const testRoleArn = (connectionId: string) => roleArnFor(ACCOUNT_ID, connectionId);

/** A role connection with its role ARN saved, ready to test. */
export function createReadyRoleConnection(db: Db, overrides: Partial<ConnectionInput> = {}, now: Date = NOW) {
  const row = createConnection(db, connectionInput({ ...overrides, method: 'role' }), now);
  return setRoleArn(db, row.id, testRoleArn(row.id), now);
}

export async function createAdminWithSession(db: Db, now: Date = NOW) {
  const adminId = await createAdmin(db, { email: 'a@example.com', password: PASSWORD });
  return { adminId, token: createSession(db, adminId, TEST_SECRET, now) };
}
