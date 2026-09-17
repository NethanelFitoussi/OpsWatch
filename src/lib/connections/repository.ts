import 'server-only';
import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { TEMPLATE_VERSION } from '../aws/actions';
import type { CredentialsInput } from '../aws/credentials';
import { roleNameFor } from '../aws/template';
import { DecryptionError, decrypt, encrypt, randomId, randomToken } from '../crypto';
import type { Db } from '../db/client';
import { connections, type ConnectionRow } from '../db/schema';
import type { ConnectionMethod, ConnectionStatus, PermissionTestResult } from './types';
import {
  accessKeysSchema,
  accountIdSchema,
  methodSchema,
  nameSchema,
  parseRoleArn,
  regionsSchema,
} from './validation';

export class ConnectionNotFoundError extends Error {
  constructor(id: string) {
    super(`Connection ${id} not found`);
    this.name = 'ConnectionNotFoundError';
  }
}

export type ConnectionInputErrorCode =
  | 'name_invalid'
  | 'account_invalid'
  | 'regions_invalid'
  | 'method_invalid'
  | 'role_arn_invalid'
  | 'role_arn_account_mismatch'
  | 'role_arn_wrong_role'
  | 'keys_invalid'
  | 'wrong_method'
  | 'not_ready';

export class ConnectionInputError extends Error {
  constructor(public readonly code: ConnectionInputErrorCode) {
    super(code);
    this.name = 'ConnectionInputError';
  }
}

export type ConnectionView = {
  id: string;
  name: string;
  method: ConnectionMethod;
  awsAccountId: string;
  regions: string[];
  roleArn: string | null;
  externalId: string | null;
  templateOutdated: boolean;
  accessKeyHint: string | null;
  keysUnreadable: boolean;
  status: ConnectionStatus;
  lastTest: PermissionTestResult | null;
  updatedAt: Date;
};

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, code: ConnectionInputErrorCode): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ConnectionInputError(code);
  }
  return parsed.data;
}

export function createConnection(
  db: Db,
  input: { name: string; method: string; awsAccountId: string; regions: string[] },
  now: Date = new Date(),
): ConnectionRow {
  const name = parseOrThrow(nameSchema, input.name, 'name_invalid');
  const method = parseOrThrow(methodSchema, input.method, 'method_invalid');
  const awsAccountId = parseOrThrow(accountIdSchema, input.awsAccountId, 'account_invalid');
  const regions = parseOrThrow(regionsSchema, input.regions, 'regions_invalid');

  return db
    .insert(connections)
    .values({
      id: randomId(),
      name,
      method,
      awsAccountId,
      regions,
      externalId: method === 'role' ? randomToken(32) : null,
      templateVersion: method === 'role' ? TEMPLATE_VERSION : null,
      status: method === 'ambient' ? 'pending' : 'draft',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function listConnections(db: Db): ConnectionRow[] {
  return db.select().from(connections).orderBy(desc(connections.createdAt)).all();
}

export function getConnection(db: Db, id: string): ConnectionRow {
  const row = db.select().from(connections).where(eq(connections.id, id)).get();
  if (!row) {
    throw new ConnectionNotFoundError(id);
  }
  return row;
}

function update(db: Db, id: string, values: Partial<ConnectionRow>, now: Date): ConnectionRow {
  const row = db
    .update(connections)
    .set({ ...values, updatedAt: now })
    .where(eq(connections.id, id))
    .returning()
    .get();
  if (!row) {
    throw new ConnectionNotFoundError(id);
  }
  return row;
}

export function setRoleArn(db: Db, id: string, roleArn: string, now: Date = new Date()): ConnectionRow {
  const row = getConnection(db, id);
  if (row.method !== 'role') {
    throw new ConnectionInputError('wrong_method');
  }
  const parsed = parseRoleArn(roleArn);
  if (!parsed) {
    throw new ConnectionInputError('role_arn_invalid');
  }
  if (parsed.account !== row.awsAccountId) {
    throw new ConnectionInputError('role_arn_account_mismatch');
  }
  if (parsed.roleName !== roleNameFor(row.id)) {
    throw new ConnectionInputError('role_arn_wrong_role');
  }
  return update(db, id, { roleArn: roleArn.trim(), status: 'pending', lastTest: null }, now);
}

export function setAccessKeys(
  db: Db,
  id: string,
  input: { accessKeyId: string; secretAccessKey: string },
  secret: string,
  now: Date = new Date(),
): ConnectionRow {
  const row = getConnection(db, id);
  if (row.method !== 'keys') {
    throw new ConnectionInputError('wrong_method');
  }
  const keys = parseOrThrow(
    accessKeysSchema,
    { accessKeyId: input.accessKeyId.trim(), secretAccessKey: input.secretAccessKey.trim() },
    'keys_invalid',
  );
  return update(
    db,
    id,
    { accessKeyCiphertext: encrypt(JSON.stringify(keys), secret), status: 'pending', lastTest: null },
    now,
  );
}

export function regenerateExternalId(db: Db, id: string, now: Date = new Date()): ConnectionRow {
  const row = getConnection(db, id);
  if (row.method !== 'role') {
    throw new ConnectionInputError('wrong_method');
  }
  return update(
    db,
    id,
    {
      externalId: randomToken(32),
      templateVersion: TEMPLATE_VERSION,
      status: row.roleArn ? 'pending' : 'draft',
      lastTest: null,
    },
    now,
  );
}

export function saveTestResult(db: Db, id: string, result: PermissionTestResult, now: Date = new Date()): ConnectionRow {
  return update(db, id, { lastTest: result, status: result.overall }, now);
}

export function deleteConnection(db: Db, id: string): void {
  db.delete(connections).where(eq(connections.id, id)).run();
}

export function readAccessKeys(row: ConnectionRow, secret: string): { accessKeyId: string; secretAccessKey: string } {
  if (!row.accessKeyCiphertext) {
    throw new ConnectionInputError('not_ready');
  }
  return JSON.parse(decrypt(row.accessKeyCiphertext, secret)) as { accessKeyId: string; secretAccessKey: string };
}

export function credentialsInputFor(row: ConnectionRow, secret: string): CredentialsInput {
  switch (row.method) {
    case 'ambient':
      return { method: 'ambient' };
    case 'keys':
      return { method: 'keys', ...readAccessKeys(row, secret) };
    case 'role':
      if (!row.roleArn || !row.externalId) {
        throw new ConnectionInputError('not_ready');
      }
      return { method: 'role', connectionId: row.id, roleArn: row.roleArn, externalId: row.externalId };
  }
}

export function toView(row: ConnectionRow, secret: string): ConnectionView {
  let accessKeyHint: string | null = null;
  let keysUnreadable = false;
  if (row.accessKeyCiphertext) {
    try {
      const { accessKeyId } = readAccessKeys(row, secret);
      accessKeyHint = `${accessKeyId.slice(0, 4)}…${accessKeyId.slice(-4)}`;
    } catch (error) {
      if (!(error instanceof DecryptionError)) {
        throw error;
      }
      keysUnreadable = true;
    }
  }
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    awsAccountId: row.awsAccountId,
    regions: row.regions,
    roleArn: row.roleArn,
    externalId: row.externalId,
    templateOutdated: row.method === 'role' && (row.templateVersion ?? 0) < TEMPLATE_VERSION,
    accessKeyHint,
    keysUnreadable,
    status: row.status,
    lastTest: row.lastTest,
    updatedAt: row.updatedAt,
  };
}
