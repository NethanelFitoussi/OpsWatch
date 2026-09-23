import { describe, expect, it } from 'vitest';
import {
  BASELINE_WINDOW_MS,
  baselineFor,
  occurrencesIn,
  runErrorDetectCycle,
} from '@/lib/collector/errors-detect';
import { HOUR_MS, findErrorGroup, pageErrorGroups, recordError, setErrorStatus, upsertLogSource } from '@/lib/store/errors';
import { insertProblem, listLiveProblems } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

/**
 * Error groups becoming problems (§4.4, ERR-9).
 *
 * The detectors were written with the errors work and nothing ran them, so a group could appear, spike and
 * be collected without anybody being told. These tests are about what the cycle refuses to claim as much as
 * what it raises.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 30, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };

const source = (db: ReturnType<typeof createTestDb>) =>
  upsertLogSource(db, { ...env, logGroup: '/aws/ecs/web', enabled: true, format: 'json', fieldMap: {}, serviceId: 'prod/web' });

/** Records `count` occurrences of one fingerprint at a given time. */
const seen = (db: ReturnType<typeof createTestDb>, logSourceId: string, print: string, at: number, count: number) =>
  recordError(db, {
    ...env,
    logSourceId,
    serviceId: 'prod/web',
    fingerprint: print,
    fingerprintVersion: 1,
    exceptionType: 'TypeError',
    sampleMessage: 'Cannot read properties of undefined',
    normalizedMessage: 'cannot read properties of undefined',
    topFrames: ['/app/src/pay.ts:charge'],
    at,
    count,
    instances: null,
  });

/** A week of quiet hours, then the hour being judged. */
const withHistory = (db: ReturnType<typeof createTestDb>, logSourceId: string, print: string, perHour: number, now = NOW) => {
  for (let hours = 1; hours <= 48; hours += 1) seen(db, logSourceId, print, now - hours * HOUR_MS, perHour);
};

const errorProblems = (db: ReturnType<typeof createTestDb>) =>
  listLiveProblems(db, env.connectionId, env.scope)
    .map(({ row }) => row)
    .filter((row) => row.subjectType === 'error_group');

describe('the baseline a spike is measured against', () => {
  it('THE RULING: the hour being judged is excluded, so a spike cannot raise its own baseline', () => {
    const db = createTestDb();
    const one = source(db);
    withHistory(db, one.id, 'aaa', 2);
    // The current hour is enormous. It must not appear in the median it is about to be compared with.
    seen(db, one.id, 'aaa', NOW, 5000);

    expect(baselineFor(db, errorGroupId(db, 'aaa'), NOW)).toBe(2);
  });

  it('THE RULING: too little history is no baseline, which reads as "not spiking"', () => {
    const db = createTestDb();
    const one = source(db);
    // Three hours is a history, not a baseline. A new installation must not look like it is on fire.
    for (const hours of [1, 2, 3]) seen(db, one.id, 'bbb', NOW - hours * HOUR_MS, 1);
    expect(baselineFor(db, errorGroupId(db, 'bbb'), NOW)).toBeNull();
  });

  it('looks back a week, and says so in one constant rather than in three places', () => {
    expect(BASELINE_WINDOW_MS).toBe(7 * 24 * HOUR_MS);
  });

  it('counts occurrences in the hour being judged, not the whole history', () => {
    const db = createTestDb();
    const one = source(db);
    seen(db, one.id, 'ccc', NOW, 7);
    seen(db, one.id, 'ccc', NOW - 5 * HOUR_MS, 900);
    expect(occurrencesIn(db, errorGroupId(db, 'ccc'), NOW)).toBe(7);
  });
});

describe('the cycle', () => {
  it('THE RULING: a group spiking far above its baseline becomes a problem', () => {
    const db = createTestDb();
    const one = source(db);
    withHistory(db, one.id, 'ddd', 2);
    seen(db, one.id, 'ddd', NOW, 200);

    expect(runErrorDetectCycle(db, env, NOW)).toMatchObject({ judged: 1 });
    expect(errorProblems(db).map((row) => row.kind)).toContain('error_group_spike');
  });

  it('THE RULING: a steady group that has ticked over for days is not a problem', () => {
    const db = createTestDb();
    const one = source(db);
    withHistory(db, one.id, 'eee', 5);
    seen(db, one.id, 'eee', NOW, 5);
    // Information, not an interruption. A tool that opens a problem for this is one nobody reads.
    setErrorStatus(db, errorGroupId(db, 'eee'), 'ongoing', NOW);

    runErrorDetectCycle(db, env, NOW);
    expect(errorProblems(db)).toEqual([]);
  });

  it('ERR-9: the group carries the id of the problem opened for it', () => {
    const db = createTestDb();
    const one = source(db);
    withHistory(db, one.id, 'fff', 2);
    seen(db, one.id, 'fff', NOW, 200);

    expect(runErrorDetectCycle(db, env, NOW).linked).toBe(1);
    // A group can be both new and spiking. The link points at the worse of the two, so following it from an
    // error arrives at the problem that would have woken somebody.
    const spike = errorProblems(db).find((row) => row.kind === 'error_group_spike');
    expect(findErrorGroup(db, errorGroupId(db, 'fff'))?.problemId).toBe(spike?.id);
  });

  it('THE RULING: a muted group is not evaluated, so its problem is not resolved as though the errors stopped', () => {
    const db = createTestDb();
    const one = source(db);
    withHistory(db, one.id, 'ggg', 2);
    seen(db, one.id, 'ggg', NOW, 200);
    runErrorDetectCycle(db, env, NOW);
    // Both detectors fire: the group is new *and* spiking, and §4.4 says both are worth saying.
    const before = errorProblems(db).length;
    expect(before).toBe(2);

    // Muting is "stop telling me", not "it stopped". Reporting it clear would state something false.
    setErrorStatus(db, errorGroupId(db, 'ggg'), 'muted', NOW);
    // Three cycles over more than fifteen minutes is exactly what §33.5 needs to resolve something, so
    // running fewer would pass whether or not muting is treated as evidence that the errors stopped.
    for (const hours of [1, 2, 3]) runErrorDetectCycle(db, env, NOW + hours * HOUR_MS);
    expect(errorProblems(db)).toHaveLength(before);
  });

  it('an environment with no groups judges nothing rather than resolving everything', () => {
    const db = createTestDb();
    expect(runErrorDetectCycle(db, env, NOW)).toEqual({ judged: 0, linked: 0 });
  });

  it('THE RULING: it never touches a problem it did not evaluate', () => {
    const db = createTestDb();
    const one = source(db);
    withHistory(db, one.id, 'hhh', 2);
    seen(db, one.id, 'hhh', NOW, 200);

    // A problem from another detector, which this cycle has nothing to say about.
    insertProblem(db, newProblem({ firstSeenAt: NOW, lastSeenAt: NOW, lastEvaluatedAt: NOW }));

    runErrorDetectCycle(db, env, NOW);
    // Handing the lifecycle problems it did not judge would have resolved this one on silence.
    expect(listLiveProblems(db, env.connectionId, env.scope).map(({ row }) => row.kind)).toContain('ecs_cpu_high');
  });
});

/** The stored id of a group, by fingerprint — the tests seed by fingerprint and assert on rows. */
function errorGroupId(db: ReturnType<typeof createTestDb>, print: string): string {
  const found = pageErrorGroups(db, env, null, 50).items.find((row) => row.fingerprint === print);
  if (found === undefined) throw new Error(`no group for ${print}`);
  return found.id;
}
