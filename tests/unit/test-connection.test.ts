import { describe, expect, it, vi } from 'vitest';
import type { CredentialResolver } from '@/lib/aws/credentials';
import { createConnection, getConnection, setAccessKeys, setRoleArn } from '@/lib/connections/repository';
import { testConnection } from '@/lib/connections/test-connection';
import type { PermissionTestResult } from '@/lib/connections/types';
import { createTestDb } from '../helpers/db';

const SECRET = 'k'.repeat(32);
const now = () => new Date('2026-09-17T10:00:00Z');
const base = { name: 'prod', awsAccountId: '111122223333', regions: ['eu-west-1', 'us-east-1'] };
const temp = { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' };
const okResult: PermissionTestResult = { overall: 'ok', accountMatches: true, checks: [], testedAt: now().toISOString() };

function resolver(impl: CredentialResolver['resolve']): CredentialResolver {
  return { resolve: vi.fn(impl), forget: vi.fn() };
}

describe('testConnection', () => {
  it('resolves credentials in the first region, runs the test and saves the result', async () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now());
    setRoleArn(db, row.id, `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`, now());
    const r = resolver(async () => temp);
    const runTest = vi.fn(async () => okResult);

    const result = await testConnection(db, row.id, { secret: SECRET, resolver: r, runTest, now });

    expect(result).toEqual(okResult);
    expect(r.resolve).toHaveBeenCalledWith(expect.objectContaining({ method: 'role' }), 'eu-west-1');
    expect(runTest).toHaveBeenCalledWith({
      expectedAccountId: '111122223333',
      regions: ['eu-west-1', 'us-east-1'],
      credentials: temp,
      now,
    });
    expect(getConnection(db, row.id).status).toBe('ok');
  });

  it('records a failed AssumeRole as a failed test', async () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now());
    setRoleArn(db, row.id, `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`, now());
    const r = resolver(async () => {
      throw Object.assign(new Error('nope'), { name: 'AccessDenied' });
    });

    const result = await testConnection(db, row.id, { secret: SECRET, resolver: r, runTest: vi.fn(), now });

    expect(result).toMatchObject({ overall: 'failed', identityError: 'AccessDenied', checks: [] });
    expect(getConnection(db, row.id).status).toBe('failed');
  });

  it('reports keys that can no longer be decrypted', async () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'keys' }, now());
    setAccessKeys(db, row.id, { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'x'.repeat(40) }, SECRET, now());

    const result = await testConnection(db, row.id, {
      secret: 'o'.repeat(32),
      resolver: resolver(async () => temp),
      runTest: vi.fn(),
      now,
    });

    expect(result).toMatchObject({ overall: 'failed', identityError: 'SecretChanged' });
    expect(getConnection(db, row.id).status).toBe('failed');
  });

  it('does not change a connection that is not ready', async () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now());
    const result = await testConnection(db, row.id, {
      secret: SECRET,
      resolver: resolver(async () => temp),
      runTest: vi.fn(),
      now,
    });
    expect(result).toMatchObject({ overall: 'failed', identityError: 'NotReady' });
    expect(getConnection(db, row.id).status).toBe('draft');
  });
});
