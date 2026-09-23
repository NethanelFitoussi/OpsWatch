import { describe, expect, it } from 'vitest';
import { untestedRegions } from '@/lib/connections/tested-regions';
import {
  ConnectionInputError,
  ConnectionNotFoundError,
  createConnection,
  findConnection,
  saveTestResult,
  setNameAndRegions,
} from '@/lib/connections/repository';
import type { PermissionTestResult } from '@/lib/aws/permission-types';
import { createTestDb } from '../helpers/db';

function connection(db: ReturnType<typeof createTestDb>) {
  return createConnection(db, { name: 'Production', method: 'role', awsAccountId: '123456789012', regions: ['eu-west-1'] });
}

const TEST_RESULT: PermissionTestResult = {
  overall: 'ok',
  accountMatches: true,
  checks: [{ service: 'ecs', region: 'eu-west-1', action: 'ecs:ListClusters', status: 'ok', checkedAt: '2026-09-23T10:00:00.000Z' }],
  testedAt: '2026-09-23T10:00:00.000Z',
};

describe('editing a live connection (UX-20)', () => {
  it('THE RULING: an edit keeps the connection, so nothing filed under it is orphaned', () => {
    const db = createTestDb();
    const before = connection(db);
    const after = setNameAndRegions(db, before.id, { name: 'Production EU', regions: ['eu-west-1', 'eu-west-3'] });

    expect(after.id).toBe(before.id);
    expect(after.name).toBe('Production EU');
    expect(after.regions).toEqual(['eu-west-1', 'eu-west-3']);
    // What the connection *is* is untouched: this is an edit, not a re-creation.
    expect(after.awsAccountId).toBe(before.awsAccountId);
    expect(after.method).toBe(before.method);
    expect(after.externalId).toBe(before.externalId);
    expect(after.createdAt).toEqual(before.createdAt);
  });

  it('keeps the evidence of the last test rather than wiping it on an edit', () => {
    const db = createTestDb();
    const row = connection(db);
    saveTestResult(db, row.id, TEST_RESULT);
    const after = setNameAndRegions(db, row.id, { name: 'Renamed', regions: ['eu-west-1'] });
    expect(after.lastTest?.testedAt).toBe(TEST_RESULT.testedAt);
    expect(after.status).toBe('ok');
  });

  it('refuses a name or a region set that is not one', () => {
    const db = createTestDb();
    const row = connection(db);
    expect(() => setNameAndRegions(db, row.id, { name: '   ', regions: ['eu-west-1'] })).toThrow(ConnectionInputError);
    expect(() => setNameAndRegions(db, row.id, { name: 'ok', regions: [] })).toThrow(ConnectionInputError);
    expect(() => setNameAndRegions(db, row.id, { name: 'ok', regions: ['moon-north-1'] })).toThrow(ConnectionInputError);
    // Nothing was written by any of the three.
    expect(findConnection(db, row.id)?.name).toBe('Production');
  });

  it('says so when the connection is gone, rather than creating one', () => {
    const db = createTestDb();
    expect(() => setNameAndRegions(db, 'nope', { name: 'x', regions: ['eu-west-1'] })).toThrow(ConnectionNotFoundError);
  });
});

describe('§2.6 — a region the test never looked at', () => {
  it('THE RULING: adding a region does not make it tested', () => {
    expect(untestedRegions(['eu-west-1', 'eu-west-3'], TEST_RESULT)).toEqual(['eu-west-3']);
  });

  it('is empty when the test covered everything the connection reads', () => {
    expect(untestedRegions(['eu-west-1'], TEST_RESULT)).toEqual([]);
  });

  it('claims nothing when there is no test at all — that is "never tested", which the badge already says', () => {
    expect(untestedRegions(['eu-west-1', 'eu-west-3'], null)).toEqual([]);
  });
});
