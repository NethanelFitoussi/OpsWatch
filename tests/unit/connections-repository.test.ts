import { describe, expect, it } from 'vitest';
import { TEMPLATE_VERSION } from '@/lib/aws/actions';
import { DecryptionError, encrypt } from '@/lib/crypto';
import {
  ConnectionInputError,
  ConnectionNotFoundError,
  createConnection,
  credentialsInputFor,
  deleteConnection,
  findConnection,
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
import { roleArnFor } from '@/lib/aws/template';
import { createTestDb } from '../helpers/db';
import { inputErrorCode } from '../helpers/errors';
import {
  NOW as now,
  OTHER_SECRET,
  TEST_SECRET as SECRET,
  connectionInput,
  createReadyRoleConnection,
  testRoleArn,
} from '../helpers/fixtures';

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
    const row = createConnection(db, connectionInput(), now);
    expect(row.id).toMatch(/^[0-9a-f]{12}$/);
    expect(row.status).toBe('draft');
    expect(Buffer.from(row.externalId ?? '', 'base64url')).toHaveLength(32);
    expect(row.templateVersion).toBe(TEMPLATE_VERSION);
    expect(listConnections(db).map((c) => c.id)).toEqual([row.id]);
  });

  it('creates an ambient connection ready to test and a keys connection as draft', () => {
    const db = createTestDb();
    expect(createConnection(db, connectionInput({ method: 'ambient' }), now).status).toBe('pending');
    const keys = createConnection(db, connectionInput({ method: 'keys' }), now);
    expect(keys.status).toBe('draft');
    expect(keys.externalId).toBeNull();
  });

  it('validates the connection input', () => {
    const db = createTestDb();
    expect(inputErrorCode(() => createConnection(db, connectionInput({ name: ' ' })))).toBe('name_invalid');
    expect(inputErrorCode(() => createConnection(db, connectionInput({ awsAccountId: '123' })))).toBe('account_invalid');
    expect(inputErrorCode(() => createConnection(db, connectionInput({ regions: [] })))).toBe('regions_invalid');
    expect(inputErrorCode(() => createConnection(db, connectionInput({ regions: ['mars-1'] })))).toBe('regions_invalid');
    expect(inputErrorCode(() => createConnection(db, connectionInput({ method: 'magic' })))).toBe('method_invalid');
  });

  it('accepts only the matching OpsWatch role ARN', () => {
    const db = createTestDb();
    const row = createConnection(db, connectionInput(), now);
    const code = (arn: string) => inputErrorCode(() => setRoleArn(db, row.id, arn, now));
    expect(code('not-an-arn')).toBe('role_arn_invalid');
    expect(code(roleArnFor('999999999999', row.id))).toBe('role_arn_account_mismatch');
    expect(code(testRoleArn('otherid'))).toBe('role_arn_wrong_role');

    const updated = setRoleArn(db, row.id, testRoleArn(row.id), now);
    expect(updated.status).toBe('pending');
    expect(credentialsInputFor(updated, SECRET)).toEqual({
      method: 'role',
      connectionId: row.id,
      roleArn: testRoleArn(row.id),
      externalId: row.externalId,
    });
  });

  it('encrypts access keys and never exposes them in the view', () => {
    const db = createTestDb();
    const row = createConnection(db, connectionInput({ method: 'keys' }), now);
    const keys = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
    const updated = setAccessKeys(db, row.id, keys, SECRET, now);

    expect(updated.status).toBe('pending');
    expect(updated.accessKeyCiphertext).not.toContain('AKIA');
    expect(readAccessKeys(updated, SECRET)).toEqual(keys);

    const view = toView(updated, SECRET);
    expect(view.accessKeyHint).toBe('AKIA…MNOP');
    expect(JSON.stringify(view)).not.toContain(keys.secretAccessKey);
    expect(JSON.stringify(view)).not.toContain('accessKeyCiphertext');

    expect(toView(updated, OTHER_SECRET)).toMatchObject({ accessKeyHint: null, keysUnreadable: true });
    expect(() => readAccessKeys(updated, OTHER_SECRET)).toThrow(DecryptionError);
  });

  it('rejects malformed keys and keys on a role connection', () => {
    const db = createTestDb();
    const keysRow = createConnection(db, connectionInput({ method: 'keys' }), now);
    const roleRow = createConnection(db, connectionInput(), now);
    expect(() => setAccessKeys(db, keysRow.id, { accessKeyId: 'nope', secretAccessKey: 'x' }, SECRET)).toThrow(
      ConnectionInputError,
    );
    expect(() =>
      setAccessKeys(db, roleRow.id, { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'x'.repeat(40) }, SECRET),
    ).toThrow(expect.objectContaining({ code: 'wrong_method' }));
  });

  it('refuses credentials for a connection that is not ready', () => {
    const db = createTestDb();
    const row = createConnection(db, connectionInput(), now);
    expect(() => credentialsInputFor(row, SECRET)).toThrow(expect.objectContaining({ code: 'not_ready' }));
  });

  it('regenerates the ExternalId and resets the test state', () => {
    const db = createTestDb();
    const row = createReadyRoleConnection(db);
    saveTestResult(db, row.id, { overall: 'ok', accountMatches: true, checks: [], testedAt: now.toISOString() }, now);

    const regenerated = regenerateExternalId(db, row.id, now);
    expect(regenerated.externalId).not.toBe(row.externalId);
    expect(regenerated.status).toBe('pending');
    expect(regenerated.lastTest).toBeNull();
  });

  it('stores a test result and derives the status', () => {
    const db = createTestDb();
    const row = createConnection(db, connectionInput({ method: 'ambient' }), now);
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
    const row = createConnection(db, connectionInput(), now);
    expect(toView({ ...row, templateVersion: TEMPLATE_VERSION - 1 }, SECRET).templateOutdated).toBe(true);
    deleteConnection(db, row.id);
    expect(() => getConnection(db, row.id)).toThrow(ConnectionNotFoundError);
  });

  it('finds a connection or returns null', () => {
    const db = createTestDb();
    const row = createConnection(db, connectionInput({ method: 'ambient' }), now);
    expect(findConnection(db, row.id)).toEqual(row);
    expect(findConnection(db, 'unknown00000')).toBeNull();
  });

  it('treats decryptable but malformed stored keys as unreadable', () => {
    const db = createTestDb();
    const row = createConnection(db, connectionInput({ method: 'keys' }), now);
    for (const plaintext of ['not json', '{"accessKeyId":1}']) {
      const corrupt = { ...row, accessKeyCiphertext: encrypt(plaintext, SECRET) };
      expect(() => readAccessKeys(corrupt, SECRET)).toThrow(DecryptionError);
      expect(toView(corrupt, SECRET)).toMatchObject({ accessKeyHint: null, keysUnreadable: true });
    }
  });
});
