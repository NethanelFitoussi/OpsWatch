import { describe, expect, it } from 'vitest';
import { TEMPLATE_VERSION } from '@/lib/aws/actions';
import { DecryptionError } from '@/lib/crypto';
import {
  ConnectionInputError,
  ConnectionNotFoundError,
  createConnection,
  credentialsInputFor,
  deleteConnection,
  getConnection,
  listConnections,
  readAccessKeys,
  regenerateExternalId,
  saveTestResult,
  setAccessKeys,
  setRoleArn,
  toView,
} from '@/lib/connections/repository';
import { parseRoleArn } from '@/lib/connections/validation';
import { createTestDb } from '../helpers/db';

const SECRET = 'k'.repeat(32);
const now = new Date('2026-09-17T10:00:00Z');
const base = { name: 'production', awsAccountId: '111122223333', regions: ['eu-west-1'] };

describe('parseRoleArn', () => {
  it('extracts account and role name, with or without a path', () => {
    expect(parseRoleArn('arn:aws:iam::111122223333:role/OpsWatchReadOnly-abc')).toEqual({
      account: '111122223333',
      roleName: 'OpsWatchReadOnly-abc',
    });
    expect(parseRoleArn('arn:aws:iam::111122223333:role/team/OpsWatchReadOnly-abc')?.roleName).toBe('OpsWatchReadOnly-abc');
    expect(parseRoleArn('arn:aws:iam::111122223333:user/bob')).toBeNull();
    expect(parseRoleArn('nonsense')).toBeNull();
  });
});

describe('connections repository', () => {
  it('creates a role connection as a draft with an ExternalId and template version', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    expect(row.id).toMatch(/^[0-9a-f]{12}$/);
    expect(row.status).toBe('draft');
    expect(Buffer.from(row.externalId ?? '', 'base64url')).toHaveLength(32);
    expect(row.templateVersion).toBe(TEMPLATE_VERSION);
    expect(listConnections(db).map((c) => c.id)).toEqual([row.id]);
  });

  it('creates an ambient connection ready to test and a keys connection as draft', () => {
    const db = createTestDb();
    expect(createConnection(db, { ...base, method: 'ambient' }, now).status).toBe('pending');
    const keys = createConnection(db, { ...base, method: 'keys' }, now);
    expect(keys.status).toBe('draft');
    expect(keys.externalId).toBeNull();
  });

  it('validates the connection input', () => {
    const db = createTestDb();
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as ConnectionInputError).code;
      }
    };
    expect(code(() => createConnection(db, { ...base, name: ' ', method: 'role' }))).toBe('name_invalid');
    expect(code(() => createConnection(db, { ...base, awsAccountId: '123', method: 'role' }))).toBe('account_invalid');
    expect(code(() => createConnection(db, { ...base, regions: [], method: 'role' }))).toBe('regions_invalid');
    expect(code(() => createConnection(db, { ...base, regions: ['mars-1'], method: 'role' }))).toBe('regions_invalid');
    expect(code(() => createConnection(db, { ...base, method: 'magic' }))).toBe('method_invalid');
  });

  it('accepts only the matching OpsWatch role ARN', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    const code = (arn: string) => {
      try {
        setRoleArn(db, row.id, arn, now);
      } catch (error) {
        return (error as ConnectionInputError).code;
      }
    };
    expect(code('not-an-arn')).toBe('role_arn_invalid');
    expect(code(`arn:aws:iam::999999999999:role/OpsWatchReadOnly-${row.id}`)).toBe('role_arn_account_mismatch');
    expect(code('arn:aws:iam::111122223333:role/OpsWatchReadOnly-otherid')).toBe('role_arn_wrong_role');

    const updated = setRoleArn(db, row.id, `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`, now);
    expect(updated.status).toBe('pending');
    expect(credentialsInputFor(updated, SECRET)).toEqual({
      method: 'role',
      connectionId: row.id,
      roleArn: `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`,
      externalId: row.externalId,
    });
  });

  it('encrypts access keys and never exposes them in the view', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'keys' }, now);
    const keys = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
    const updated = setAccessKeys(db, row.id, keys, SECRET, now);

    expect(updated.status).toBe('pending');
    expect(updated.accessKeyCiphertext).not.toContain('AKIA');
    expect(readAccessKeys(updated, SECRET)).toEqual(keys);

    const view = toView(updated, SECRET);
    expect(view.accessKeyHint).toBe('AKIA…MNOP');
    expect(JSON.stringify(view)).not.toContain(keys.secretAccessKey);
    expect(JSON.stringify(view)).not.toContain('accessKeyCiphertext');

    expect(toView(updated, 'z'.repeat(32))).toMatchObject({ accessKeyHint: null, keysUnreadable: true });
    expect(() => readAccessKeys(updated, 'z'.repeat(32))).toThrow(DecryptionError);
  });

  it('rejects malformed keys and keys on a role connection', () => {
    const db = createTestDb();
    const keysRow = createConnection(db, { ...base, method: 'keys' }, now);
    const roleRow = createConnection(db, { ...base, method: 'role' }, now);
    expect(() => setAccessKeys(db, keysRow.id, { accessKeyId: 'nope', secretAccessKey: 'x' }, SECRET)).toThrow(
      ConnectionInputError,
    );
    expect(() =>
      setAccessKeys(db, roleRow.id, { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'x'.repeat(40) }, SECRET),
    ).toThrow(expect.objectContaining({ code: 'wrong_method' }));
  });

  it('refuses credentials for a connection that is not ready', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    expect(() => credentialsInputFor(row, SECRET)).toThrow(expect.objectContaining({ code: 'not_ready' }));
  });

  it('regenerates the ExternalId and resets the test state', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    setRoleArn(db, row.id, `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`, now);
    saveTestResult(db, row.id, { overall: 'ok', accountMatches: true, checks: [], testedAt: now.toISOString() }, now);

    const regenerated = regenerateExternalId(db, row.id, now);
    expect(regenerated.externalId).not.toBe(row.externalId);
    expect(regenerated.status).toBe('pending');
    expect(regenerated.lastTest).toBeNull();
  });

  it('stores a test result and derives the status', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'ambient' }, now);
    const saved = saveTestResult(
      db,
      row.id,
      { overall: 'degraded', accountMatches: true, checks: [], testedAt: now.toISOString() },
      now,
    );
    expect(saved.status).toBe('degraded');
    expect(saved.lastTest?.overall).toBe('degraded');
  });

  it('flags outdated templates and deletes connections', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    expect(toView({ ...row, templateVersion: TEMPLATE_VERSION - 1 }, SECRET).templateOutdated).toBe(true);
    deleteConnection(db, row.id);
    expect(() => getConnection(db, row.id)).toThrow(ConnectionNotFoundError);
  });
});
