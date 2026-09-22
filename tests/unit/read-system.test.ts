import { describe, expect, it } from 'vitest';
import { systemStatusSchema } from '@opswatch/contract';
import { readSystemStatus } from '@/lib/read/system';
import { JOBS } from '@/lib/collector/jobs';
import { claimCollectorLock, finishRun, startRun } from '@/lib/store/collector';
import { recordFamilySnapshot } from '@/lib/store/health';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const read = (db: ReturnType<typeof createTestDb>, nowMs = NOW) =>
  readSystemStatus(db, { nowMs, environments: [env] });

describe('what OpsWatch says about itself', () => {
  it('is exactly the shape the contract promises', () => {
    const db = createTestDb();
    expect(systemStatusSchema.safeParse(read(db)).success).toBe(true);
  });

  it('shouts when the collector has never run, because every other page then knows nothing', () => {
    const db = createTestDb();
    const status = read(db);
    expect(status.collector.neverRan).toBe(true);
    expect(status.collector.alive).toBe(false);
    expect(status.collector.owner).toBeNull();
  });

  it('reports the lock as alive only while its heartbeat is recent', () => {
    const db = createTestDb();
    claimCollectorLock(db, 'pid-1', NOW);
    expect(read(db).collector).toMatchObject({ owner: 'pid-1', alive: true });
    // A process that died leaves the row behind; a stale heartbeat must not read as running.
    expect(read(db, NOW + 120_000).collector.alive).toBe(false);
  });

  it('lists every job in the catalogue, including the ones that have never run', () => {
    const db = createTestDb();
    const status = read(db);
    expect(status.jobs.map((job) => job.job).sort()).toEqual(Object.keys(JOBS).sort());
    // "Never run" is its own answer: not a failure, and certainly not a success.
    expect(status.jobs.every((job) => job.lastStatus === null && job.lastRunAt === null)).toBe(true);
  });

  it('carries what a job covered and whether a cap truncated it', () => {
    const db = createTestDb();
    const run = startRun(db, { job: 'detect', connectionId: env.connectionId, scope: env.scope, startedAt: NOW - 60_000 });
    finishRun(db, run.id, { finishedAt: NOW - 58_000, status: 'ok', covered: 3, total: 4, truncated: true });
    const detect = read(db).jobs.find((job) => job.job === 'detect');
    expect(detect).toMatchObject({ lastStatus: 'ok', covered: 3, total: 4, truncated: true, durationMs: 2_000 });
    expect(detect?.nextRunAt).toBe(NOW - 60_000 + JOBS.detect.everyMs);
  });

  it('says a run that never finished took an unknown time, not zero', () => {
    const db = createTestDb();
    startRun(db, { job: 'detect', connectionId: env.connectionId, scope: env.scope, startedAt: NOW });
    const detect = read(db).jobs.find((job) => job.job === 'detect');
    expect(detect?.lastStatus).toBe('running');
    expect(detect?.durationMs).toBeNull();
  });

  it('carries the error code of a failure, so a broken job is diagnosable', () => {
    const db = createTestDb();
    const run = startRun(db, { job: 'detect', connectionId: env.connectionId, scope: env.scope, startedAt: NOW });
    finishRun(db, run.id, { finishedAt: NOW + 10, status: 'failed', errorCode: 'AccessDenied' });
    expect(read(db).jobs.find((job) => job.job === 'detect')?.errorCode).toBe('AccessDenied');
  });
});

describe('per environment', () => {
  it('says an environment has never been read rather than implying it is fine', () => {
    const db = createTestDb();
    const [environment] = read(db).environments;
    expect(environment.lastReadAt).toBeNull();
    expect({ read: environment.familiesRead, total: environment.familiesTotal }).toEqual({ read: 0, total: 0 });
  });

  it('reports when it was last read and how much of it could be', () => {
    const db = createTestDb();
    recordFamilySnapshot(db, { ...env, family: 'ecs', status: 'healthy', total: 2, affected: 0, readAt: NOW - 1000, unavailableReason: null, unavailableCode: null });
    recordFamilySnapshot(db, { ...env, family: 'rds', status: 'unknown', total: null, affected: null, readAt: NOW, unavailableReason: 'denied', unavailableCode: 'AccessDenied' });
    const [environment] = read(db).environments;
    expect(environment.lastReadAt).toBe(NOW);
    // One of the two families could actually be read; the page shows the shortfall rather than hiding it.
    expect({ read: environment.familiesRead, total: environment.familiesTotal }).toEqual({ read: 1, total: 2 });
  });
});

describe('the database', () => {
  it('reports how many migrations have been applied, so a half-applied upgrade is visible', () => {
    const db = createTestDb();
    const applied = read(db).database.schemaVersion;
    expect(typeof applied).toBe('number');
    // Every migration in drizzle/ ran when the test database opened.
    expect(applied).toBeGreaterThanOrEqual(8);
  });

  it('says the size is not measured rather than guessing at it', () => {
    const db = createTestDb();
    expect(read(db).database.sizeBytes).toBeNull();
  });
});
