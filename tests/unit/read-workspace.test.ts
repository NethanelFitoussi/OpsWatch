import { describe, expect, it } from 'vitest';
import { PAST_LIMIT, medianDuration, readWorkspace } from '@/lib/read/workspace';
import { insertProblem, updateProblem } from '@/lib/store/problems';
import { recordError, upsertLogSource } from '@/lib/store/errors';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const env = { connectionId: 'c1', scope: 'us-east-1' };

/** One occurrence of the same fault: same dedupe key, opened then resolved. */
const occurrence = (db: ReturnType<typeof createTestDb>, openedAt: number, resolvedAt: number | null, over: Record<string, unknown> = {}) => {
  const row = insertProblem(
    db,
    newProblem({
      key: 'same-fault'.padEnd(32, 'x'),
      firstSeenAt: openedAt,
      lastSeenAt: openedAt,
      lastEvaluatedAt: openedAt,
      serviceId: 'prod/web',
      ...over,
    }),
  );
  // The live index allows one open row per key, so each one is resolved before the next is inserted.
  if (resolvedAt !== null) updateProblem(db, row.id, { status: 'resolved', resolvedAt });
  return row;
};

describe('how long it usually takes', () => {
  it('THE RULING: the middle value, not the average', () => {
    // One occurrence left open over a weekend would drag a mean into uselessness.
    expect(medianDuration([HOUR, HOUR, 100 * DAY])).toBe(HOUR);
  });

  it('averages the middle two when there is an even number', () => {
    expect(medianDuration([2, 4, 6, 8])).toBe(5);
  });

  it('THE RULING: one occurrence is not a pattern, so there is no typical time', () => {
    expect(medianDuration([HOUR])).toBeNull();
    expect(medianDuration([])).toBeNull();
  });
});

describe('INV-5 — has this happened before', () => {
  it('lists earlier resolved occurrences of the same fault, newest first', () => {
    const db = createTestDb();
    occurrence(db, NOW - 10 * DAY, NOW - 10 * DAY + 2 * HOUR);
    occurrence(db, NOW - 3 * DAY, NOW - 3 * DAY + HOUR);
    const current = occurrence(db, NOW - HOUR, null);

    const workspace = readWorkspace(db, current);
    expect(workspace.past.map((one) => one.firstSeenAt)).toEqual([NOW - 3 * DAY, NOW - 10 * DAY]);
    expect(workspace.past[0]).toMatchObject({ durationMs: HOUR });
    expect(workspace.typicalDurationMs).toBe(Math.round((HOUR + 2 * HOUR) / 2));
  });

  it('THE RULING: a problem is never its own precedent', () => {
    const db = createTestDb();
    const current = occurrence(db, NOW - HOUR, null);
    expect(readWorkspace(db, current).past).toEqual([]);

    // And not once it is resolved either, which is when the same-key filter alone would match it.
    const resolved = updateProblem(db, current.id, { status: 'resolved', resolvedAt: NOW });
    expect(readWorkspace(db, resolved).past).toEqual([]);
  });

  it('THE RULING: an occurrence still open is not history, and never reports a duration', () => {
    // Reachable because the live index allows one open row per key: an earlier one still open, beside a
    // later one already resolved. Without the guard it would be listed with a duration of NaN.
    const db = createTestDb();
    const earlier = occurrence(db, NOW - 2 * DAY, NOW - 2 * DAY + HOUR);
    const current = occurrence(db, NOW - HOUR, NOW);
    updateProblem(db, earlier.id, { status: 'open', resolvedAt: null });

    const workspace = readWorkspace(db, current);
    expect(workspace.past).toEqual([]);
    expect(workspace.past.map((one) => one.durationMs)).not.toContain(Number.NaN);
  });

  it('THE RULING: "first time" is reported beside how far back the record goes', () => {
    // On an instance that started yesterday, "this has not happened before" means nothing at all.
    const db = createTestDb();
    occurrence(db, NOW - 2 * DAY, NOW - 2 * DAY + HOUR, { key: 'other-fault'.padEnd(32, 'x') });
    const current = occurrence(db, NOW - HOUR, null);

    const workspace = readWorkspace(db, current);
    expect(workspace.past).toEqual([]);
    expect(workspace.recordedSince).toBe(NOW - 2 * DAY);
  });

  it('THE RULING: the record is this environment’s own, not the installation’s', () => {
    /*
     * A second AWS account added this morning has this morning's record, however long another account
     * has been watched. Reading across the installation said the record went back six months — the same
     * false clean record this figure exists to prevent, arrived at from the other direction.
     */
    const db = createTestDb();
    occurrence(db, NOW - 200 * DAY, NOW - 200 * DAY + HOUR, { key: 'old-other-account'.padEnd(32, 'x'), connectionId: 'c2' });
    const current = occurrence(db, NOW - HOUR, null);

    expect(readWorkspace(db, current).recordedSince).toBe(NOW - HOUR);
  });

  it('says it has recorded nothing at all when it has', () => {
    const db = createTestDb();
    const current = occurrence(db, NOW - HOUR, null);
    // Its own row is the earliest there is, which is the honest answer rather than null.
    expect(readWorkspace(db, current).recordedSince).toBe(NOW - HOUR);
  });

  it('does not treat a different fault on the same service as a recurrence', () => {
    const db = createTestDb();
    occurrence(db, NOW - 2 * DAY, NOW - 2 * DAY + HOUR, { key: 'different'.padEnd(32, 'x'), kind: 'rds_cpu_high' });
    const current = occurrence(db, NOW - HOUR, null);
    expect(readWorkspace(db, current).past).toEqual([]);
  });

  it('is bounded: a history, not an archive', () => {
    const db = createTestDb();
    for (let i = PAST_LIMIT + 3; i > 0; i -= 1) occurrence(db, NOW - i * DAY, NOW - i * DAY + HOUR);
    const current = occurrence(db, NOW - HOUR, null);
    expect(readWorkspace(db, current).past).toHaveLength(PAST_LIMIT);
  });
});

describe('INV-5 — the logs behind it', () => {
  const source = (db: ReturnType<typeof createTestDb>, logGroup: string, serviceId: string | null) =>
    upsertLogSource(db, { ...env, logGroup, serviceId, enabled: true, format: 'json', fieldMap: {} });

  it('offers only the log groups OpsWatch is already reading for the service', () => {
    const db = createTestDb();
    source(db, '/ecs/web', 'prod/web');
    source(db, '/ecs/worker', 'prod/worker');
    const current = occurrence(db, NOW - HOUR, null);
    // Searching a group nobody selected would be spending somebody's Logs Insights budget on a guess.
    expect(readWorkspace(db, current).logGroups).toEqual(['/ecs/web']);
  });

  it('includes a source that names no service, because it reads whatever it is pointed at', () => {
    const db = createTestDb();
    source(db, '/ecs/everything', null);
    const current = occurrence(db, NOW - HOUR, null);
    expect(readWorkspace(db, current).logGroups).toEqual(['/ecs/everything']);
  });

  it('skips a source somebody switched off', () => {
    const db = createTestDb();
    upsertLogSource(db, { ...env, logGroup: '/ecs/web', serviceId: 'prod/web', enabled: false, format: 'json', fieldMap: {} });
    const current = occurrence(db, NOW - HOUR, null);
    expect(readWorkspace(db, current).logGroups).toEqual([]);
  });

  it('THE RULING: nothing being read and nothing being found are different answers', () => {
    const db = createTestDb();
    const current = occurrence(db, NOW - HOUR, null);
    // No log source at all: OpsWatch has read no error, which is not the same as there being none.
    expect(readWorkspace(db, current).errors).toBeNull();

    source(db, '/ecs/web', 'prod/web');
    // A source is on and nothing has been found: an empty list, and a different sentence on the page.
    expect(readWorkspace(db, occurrence(db, NOW - 30 * 60_000, null, { key: 'k2'.padEnd(32, 'x') })).errors).toEqual([]);
  });

  it('lists the errors seen on the service since the problem opened', () => {
    const db = createTestDb();
    const logSource = source(db, '/ecs/web', 'prod/web');
    const current = occurrence(db, NOW - HOUR, null);
    recordError(db, {
      ...env,
      logSourceId: logSource.id,
      serviceId: 'prod/web',
      fingerprint: 'f'.repeat(32),
      fingerprintVersion: 1,
      exceptionType: 'TypeError',
      sampleMessage: 'boom',
      normalizedMessage: 'boom',
      topFrames: [],
      at: NOW - 30 * 60_000,
      count: 3,
      instances: 1,
    });

    expect(readWorkspace(db, current).errors).toEqual([
      expect.objectContaining({ message: 'boom', lastSeenAt: NOW - 30 * 60_000 }),
    ]);
  });
});
