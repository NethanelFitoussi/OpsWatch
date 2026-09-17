import { beforeEach, describe, expect, it } from 'vitest';
import { createConnection, saveTestResult } from '@/lib/connections/repository';
import type { OverallStatus } from '@/lib/aws/permission-types';
import type { Db } from '@/lib/db/client';
import { checkSelection, firstUsableSelection } from '@/lib/monitoring/selection';
import { createTestDb } from '../helpers/db';
import { NOW, connectionInput, createReadyRoleConnection } from '../helpers/fixtures';

let db: Db;
beforeEach(() => {
  db = createTestDb();
});

const tested = (overall: OverallStatus, regions = ['eu-west-1']) => {
  const row = createReadyRoleConnection(db, { regions });
  return saveTestResult(db, row.id, { overall, accountMatches: true, checks: [], testedAt: NOW.toISOString() }, NOW);
};

describe('checkSelection', () => {
  it('accepts a configured region of an ok or degraded connection', () => {
    expect(checkSelection(tested('ok'), 'eu-west-1')).toMatchObject({ kind: 'ok' });
    expect(checkSelection(tested('degraded'), 'eu-west-1')).toMatchObject({ kind: 'ok' });
  });

  it('treats an unknown connection or a region the connection does not use as not found', () => {
    expect(checkSelection(null, 'eu-west-1')).toEqual({ kind: 'not_found' });
    expect(checkSelection(tested('ok'), 'us-east-1')).toEqual({ kind: 'not_found' });
    expect(checkSelection(tested('failed'), 'us-east-1')).toEqual({ kind: 'not_found' });
  });

  it('reports connections that have not passed their test as unusable', () => {
    const failed = tested('failed');
    expect(checkSelection(failed, 'eu-west-1')).toEqual({ kind: 'unusable', connectionId: failed.id });
    const pending = createReadyRoleConnection(db);
    expect(checkSelection(pending, 'eu-west-1')).toEqual({ kind: 'unusable', connectionId: pending.id });
  });
});

describe('firstUsableSelection', () => {
  it('picks the first usable connection in list order and its first region', () => {
    const draft = createConnection(db, connectionInput({ method: 'keys' }), NOW);
    const ok = tested('ok', ['eu-west-3', 'eu-west-1']);
    expect(firstUsableSelection([draft, ok])).toEqual({ connectionId: ok.id, region: 'eu-west-3' });
    expect(firstUsableSelection([draft])).toBeNull();
  });
});
