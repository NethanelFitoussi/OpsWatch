import { describe, expect, it } from 'vitest';
import {
  ERROR_REGRESSION_GAP_MS,
  ERROR_RESOLVED_AFTER_MS,
  countOccurrences,
  enabledLogSources,
  findErrorGroup,
  HOUR_MS,
  hourOf,
  listLogSources,
  occurrenceSeries,
  pageErrorGroups,
  readMark,
  recentErrorGroups,
  recordError,
  resolveSilentErrors,
  setErrorStatus,
  upsertLogSource,
  writeMark,
  type SeenError,
} from '@/lib/store/errors';
import { createAdmin } from '@/lib/auth/admin';
import { createTestDb } from '../helpers/db';
import { NOW as FIXTURE_NOW, PASSWORD } from '../helpers/fixtures';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };

const seen = (over: Partial<SeenError> = {}): SeenError => ({
  ...env,
  logSourceId: 'src-1',
  serviceId: 'prod/web',
  fingerprint: 'f'.repeat(32),
  fingerprintVersion: 1,
  exceptionType: 'TypeError',
  sampleMessage: "Cannot read properties of undefined (reading 'id')",
  normalizedMessage: 'Cannot read properties of undefined (reading <str>)',
  topFrames: ['/app/src/payment/charge.ts:chargeCard'],
  at: NOW,
  count: 3,
  instances: 2,
  ...over,
});

describe('recording an error', () => {
  it('opens a group the first time a fingerprint is seen', () => {
    const db = createTestDb();
    const group = recordError(db, seen());
    expect({ status: group.status, firstSeenAt: group.firstSeenAt, fingerprintVersion: group.fingerprintVersion }).toEqual({
      status: 'new',
      firstSeenAt: NOW,
      fingerprintVersion: 1,
    });
    expect(group.topFrames).toEqual(['/app/src/payment/charge.ts:chargeCard']);
  });

  it('keeps one group per fingerprint rather than one per occurrence', () => {
    const db = createTestDb();
    const first = recordError(db, seen());
    const second = recordError(db, seen({ at: NOW + 60_000 }));
    expect(second.id).toBe(first.id);
    expect(pageErrorGroups(db, env, null, 10).items).toHaveLength(1);
  });

  it('separates two algorithm versions, so a regrouping never merges history silently', () => {
    const db = createTestDb();
    recordError(db, seen());
    recordError(db, seen({ fingerprintVersion: 2 }));
    expect(pageErrorGroups(db, env, null, 10).items).toHaveLength(2);
  });

  it('separates the same fingerprint in two environments', () => {
    const db = createTestDb();
    recordError(db, seen());
    recordError(db, seen({ scope: 'eu-west-1' }));
    expect(pageErrorGroups(db, env, null, 10).items).toHaveLength(1);
  });

  it('keeps the newest sample message, so a reader sees what it actually looks like now', () => {
    const db = createTestDb();
    recordError(db, seen());
    const group = recordError(db, seen({ at: NOW + 60_000, sampleMessage: 'a later wording' }));
    expect(group.sampleMessage).toBe('a later wording');
  });
});

describe('status, and what "new" is worth', () => {
  it('calls a group that came back after a day a regression, not a continuation', () => {
    const db = createTestDb();
    recordError(db, seen());
    const back = recordError(db, seen({ at: NOW + ERROR_REGRESSION_GAP_MS }));
    // This is the distinction the whole "what's new" idea turns on.
    expect(back.status).toBe('regressed');
    expect(back.statusSince).toBe(NOW + ERROR_REGRESSION_GAP_MS);
    // And firstSeenAt still answers a different question: when it was ever first seen.
    expect(back.firstSeenAt).toBe(NOW);
  });

  it('does not call a group that never stopped a regression', () => {
    const db = createTestDb();
    recordError(db, seen());
    const later = recordError(db, seen({ at: NOW + ERROR_REGRESSION_GAP_MS - 1 }));
    expect(later.status).toBe('new');
  });

  it('resolves a group silent for seven days, and only then', () => {
    const db = createTestDb();
    recordError(db, seen());
    expect(resolveSilentErrors(db, NOW + ERROR_RESOLVED_AFTER_MS)).toBe(0);
    expect(resolveSilentErrors(db, NOW + ERROR_RESOLVED_AFTER_MS + 1)).toBe(1);
    expect(findErrorGroup(db, pageErrorGroups(db, env, null, 10).items[0].id)?.status).toBe('resolved');
  });

  it('keeps a muted group muted: silencing it was a decision, not a guess', () => {
    const db = createTestDb();
    const group = recordError(db, seen());
    setErrorStatus(db, group.id, 'muted', NOW, 'known and accepted');
    const again = recordError(db, seen({ at: NOW + 2 * ERROR_REGRESSION_GAP_MS }));
    expect(again.status).toBe('muted');
    expect(again.mutedReason).toBe('known and accepted');
  });

  it('never resolves a muted group out from under the decision', () => {
    const db = createTestDb();
    const group = recordError(db, seen());
    setErrorStatus(db, group.id, 'muted', NOW);
    expect(resolveSilentErrors(db, NOW + 10 * ERROR_RESOLVED_AFTER_MS)).toBe(0);
  });
});

describe('occurrences, rolled up by hour', () => {
  it('adds up within an hour rather than keeping every line', () => {
    const db = createTestDb();
    const group = recordError(db, seen({ count: 3 }));
    recordError(db, seen({ at: NOW + 60_000, count: 4 }));
    expect(countOccurrences(db, group.id).count).toBe(7);
    expect(occurrenceSeries(db, group.id, NOW - HOUR)).toHaveLength(1);
  });

  it('keeps separate buckets for separate hours', () => {
    const db = createTestDb();
    const group = recordError(db, seen({ count: 3 }));
    recordError(db, seen({ at: NOW + HOUR, count: 5 }));
    expect(occurrenceSeries(db, group.id, NOW - HOUR).map((point) => point.count)).toEqual([3, 5]);
    expect(countOccurrences(db, group.id).count).toBe(8);
  });

  it('counts over a window, which is what makes a rate answerable', () => {
    const db = createTestDb();
    const group = recordError(db, seen({ at: NOW - 3 * HOUR, count: 100 }));
    recordError(db, seen({ at: NOW, count: 2 }));
    expect(countOccurrences(db, group.id, { from: NOW - HOUR, to: NOW + HOUR }).count).toBe(2);
    expect(countOccurrences(db, group.id).count).toBe(102);
  });

  it('takes the largest instance count in an hour rather than summing it', () => {
    const db = createTestDb();
    const group = recordError(db, seen({ instances: 2 }));
    recordError(db, seen({ at: NOW + 60_000, instances: 5 }));
    // Two queries in one hour each seeing the same hosts must not report ten instances.
    expect(countOccurrences(db, group.id).instances).toBe(5);
  });

  it('says null for instances the source did not report, rather than zero', () => {
    const db = createTestDb();
    const group = recordError(db, seen({ instances: null }));
    expect(countOccurrences(db, group.id).instances).toBeNull();
  });

  it('deletes the occurrences with the group', () => {
    const db = createTestDb();
    const group = recordError(db, seen());
    db.$client.prepare('delete from error_groups where id = ?').run(group.id);
    expect(countOccurrences(db, group.id).count).toBe(0);
  });

  it('truncates an instant to its hour', () => {
    expect(HOUR_MS).toBe(60 * 60_000);
    expect(hourOf(NOW + HOUR_MS - 1)).toBe(NOW);
    expect(hourOf(NOW + HOUR_MS)).toBe(NOW + HOUR_MS);
  });
});

const HOUR = HOUR_MS;

describe('log sources are opt-in, because Logs Insights is billed by the gigabyte', () => {
  const source = {
    ...env,
    logGroup: '/aws/ecs/web',
    serviceId: 'prod/web',
    enabled: false,
    format: 'json' as const,
    fieldMap: { level: '$.level', message: '$.msg' },
  };

  it('is created disabled, so nothing is scanned until someone says so', () => {
    const db = createTestDb();
    const created = upsertLogSource(db, source);
    expect(created.enabled).toBe(false);
    expect(enabledLogSources(db, env.connectionId, env.scope)).toEqual([]);
    // It is still listed, so it can be found and turned on.
    expect(listLogSources(db, env.connectionId, env.scope)).toHaveLength(1);
  });

  it('stores the mapping and not the log content', () => {
    const db = createTestDb();
    const created = upsertLogSource(db, source);
    expect(created.fieldMap).toEqual({ level: '$.level', message: '$.msg' });
  });

  it('updates a source rather than duplicating it', () => {
    const db = createTestDb();
    upsertLogSource(db, source);
    const enabled = upsertLogSource(db, { ...source, enabled: true });
    expect(listLogSources(db, env.connectionId, env.scope)).toHaveLength(1);
    expect(enabled.enabled).toBe(true);
    expect(enabledLogSources(db, env.connectionId, env.scope)).toHaveLength(1);
  });
});

describe('where a reader had got to', () => {
  it('remembers per user, per environment, and answers null before the first visit', async () => {
    const db = createTestDb();
    const adminId = await createAdmin(db, { email: 'a@example.com', password: PASSWORD }, FIXTURE_NOW);
    expect(readMark(db, adminId, 'errors', env.connectionId, env.scope)).toBeNull();
    writeMark(db, adminId, 'errors', env.connectionId, env.scope, NOW);
    expect(readMark(db, adminId, 'errors', env.connectionId, env.scope)).toBe(NOW);
    // Another environment is a different mark: what is new in one says nothing about the other.
    expect(readMark(db, adminId, 'errors', env.connectionId, 'eu-west-1')).toBeNull();
  });

  it('moves the mark forward rather than adding a second row', async () => {
    const db = createTestDb();
    const adminId = await createAdmin(db, { email: 'a@example.com', password: PASSWORD }, FIXTURE_NOW);
    writeMark(db, adminId, 'errors', env.connectionId, env.scope, NOW);
    writeMark(db, adminId, 'errors', env.connectionId, env.scope, NOW + HOUR);
    expect(readMark(db, adminId, 'errors', env.connectionId, env.scope)).toBe(NOW + HOUR);
  });
});

describe('listing', () => {
  it('pages on the immutable axis, like every other list', () => {
    const db = createTestDb();
    for (let i = 0; i < 3; i += 1) recordError(db, seen({ fingerprint: String(i).padStart(32, 'f') }));
    const first = pageErrorGroups(db, env, null, 2);
    expect(first.items).toHaveLength(2);
    const second = pageErrorGroups(db, env, { afterSeq: first.nextSeq!, afterId: first.nextId! }, 2);
    expect(second.items).toHaveLength(1);
    expect(second.nextSeq).toBeNull();
  });

  it('filters by status, which is what the three "what\'s new" sets are', () => {
    const db = createTestDb();
    recordError(db, seen({ fingerprint: 'a'.repeat(32) }));
    const second = recordError(db, seen({ fingerprint: 'b'.repeat(32) }));
    setErrorStatus(db, second.id, 'resolved', NOW);
    expect(pageErrorGroups(db, { ...env, status: ['new'] }, null, 10).items).toHaveLength(1);
    expect(recentErrorGroups(db, { ...env, status: ['new'], sinceMs: NOW - HOUR }, 10)).toHaveLength(1);
  });

  it('leaves out what entered its status before the window', () => {
    const db = createTestDb();
    recordError(db, seen({ at: NOW - 5 * HOUR }));
    expect(recentErrorGroups(db, { ...env, sinceMs: NOW - HOUR }, 10)).toEqual([]);
  });
});

describe('the wire status', () => {
  it('speaks the contract\'s words, not the store\'s', async () => {
    const { wireErrorStatus } = await import('@/lib/read/errors');
    // §33.1 makes the mobile contract authoritative field by field, and it says `recurring`, not `ongoing`.
    expect(wireErrorStatus('ongoing')).toBe('recurring');
    expect(wireErrorStatus('regressed')).toBe('regression');
    expect(wireErrorStatus('new')).toBe('new');
    expect(wireErrorStatus('resolved')).toBe('resolved');
    // A muted group is still recurring to a client: muting is an operator's decision, not a state of the world.
    expect(wireErrorStatus('muted')).toBe('recurring');
  });

  it('shows a bounded number of groups in each "what\'s new" set', async () => {
    const { WHATS_NEW_LIMIT } = await import('@/lib/read/errors');
    // Three sets on one screen: each has to stay scannable.
    expect(WHATS_NEW_LIMIT).toBeGreaterThan(0);
    expect(WHATS_NEW_LIMIT).toBeLessThanOrEqual(10);
  });
});
