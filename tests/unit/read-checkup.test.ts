import { describe, expect, it } from 'vitest';
import { RECENT_RUNS, checkupInput, failingJobs, readCheckup } from '@/lib/read/checkup';
import { finishRun, startRun } from '@/lib/store/collector';
import { recordFamilySnapshot } from '@/lib/store/health';
import { upsertLogSource } from '@/lib/store/errors';
import { writeHistorySettings } from '@/lib/history/settings';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
/** The edge passes its own configuration in, so a checkup can be run against a fixture. */
const context = { nowMs: NOW, logsBudgetGbPerDay: 1 };

describe('which jobs are failing', () => {
  it('THE RULING: the newest run per job is the verdict, so a job that recovered is not reported', () => {
    // `lastRuns` answers newest first.
    const runs = [
      { job: 'detect', status: 'ok' },
      { job: 'detect', status: 'failed' },
      { job: 'errors', status: 'failed' },
      { job: 'errors', status: 'ok' },
    ];
    expect(failingJobs(runs)).toEqual(['errors']);
  });

  it('reports nothing when nothing has run', () => {
    expect(failingJobs([])).toEqual([]);
  });

  it('reports every job whose latest run failed', () => {
    expect(failingJobs([{ job: 'a', status: 'failed' }, { job: 'b', status: 'failed' }])).toEqual(['a', 'b']);
  });
});

describe('the inputs come from what is already stored', () => {
  it('reads a fresh installation as never collected, never tested and off', () => {
    const input = checkupInput(createTestDb(), env, context);
    expect(input.permissions).toBeNull();
    expect(input.collector.neverRan).toBe(true);
    expect(input.history.enabled).toBe(false);
    expect(input.logSources).toEqual({ total: 0, enabled: 0 });
    expect(input.families).toEqual([]);
  });

  it('counts log sources, enabled apart from discovered', () => {
    const db = createTestDb();
    upsertLogSource(db, { ...env, logGroup: '/a', serviceId: null, enabled: true, format: 'json', fieldMap: {} });
    upsertLogSource(db, { ...env, logGroup: '/b', serviceId: null, enabled: false, format: 'json', fieldMap: {} });
    expect(checkupInput(db, env, context).logSources).toEqual({ total: 2, enabled: 1 });
  });

  it('carries a family that could not be read, with its reason and code', () => {
    const db = createTestDb();
    recordFamilySnapshot(db, {
      ...env, family: 'rds', status: 'unknown', total: null, affected: null,
      unavailableReason: 'denied', unavailableCode: 'AccessDenied', readAt: NOW,
    });
    expect(checkupInput(db, env, context).families).toEqual([
      { family: 'rds', unavailableReason: 'denied', unavailableCode: 'AccessDenied' },
    ]);
  });

  it('notices the collector has run once it has', () => {
    const db = createTestDb();
    const run = startRun(db, { job: 'detect', connectionId: env.connectionId, scope: env.scope, startedAt: NOW });
    finishRun(db, run.id, { finishedAt: NOW + 1000, status: 'ok', covered: 4, total: 4 });
    expect(checkupInput(db, env, context).collector).toEqual({ neverRan: false, failingJobs: [] });
  });

  it('bounds how far back it looks, so the input cannot grow without limit', () => {
    expect(RECENT_RUNS).toBeGreaterThan(0);
    expect(RECENT_RUNS).toBeLessThanOrEqual(100);
  });
});

describe('the checkup an operator actually sees', () => {
  it('a fresh installation is told what is not set up, worst first', () => {
    const checkup = readCheckup(createTestDb(), env, context);
    const ids = checkup.findings.map((finding) => finding.id);

    // The collector never having run is critical: an empty product looks exactly like a healthy estate.
    expect(ids).toContain('collector_never_ran');
    expect(ids).toContain('permissions_untested');
    expect(ids).toContain('errors_not_collected');
    expect(ids).toContain('history_off');
    expect(checkup.findings[0]?.severity).toBe('critical');
  });

  it('states its own coverage, so "no findings" is a measured statement', () => {
    const checkup = readCheckup(createTestDb(), env, context);
    expect(checkup.coverage.ran + checkup.coverage.notRun).toBe(checkup.coverage.total);
    expect(checkup.coverage.notRun).toBeGreaterThan(0);
    // And each one it could not run is named rather than omitted.
    expect(checkup.notRun.every((outcome) => outcome.reason.length > 0)).toBe(true);
  });

  it('stops reporting what an operator has since fixed', () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    upsertLogSource(db, { ...env, logGroup: '/a', serviceId: null, enabled: true, format: 'json', fieldMap: {} });
    const run = startRun(db, { job: 'detect', connectionId: env.connectionId, scope: env.scope, startedAt: NOW });
    finishRun(db, run.id, { finishedAt: NOW + 1000, status: 'ok', covered: 4, total: 4 });

    const ids = readCheckup(db, env, context).findings.map((finding) => finding.id);
    expect(ids).not.toContain('history_off');
    expect(ids).not.toContain('errors_not_collected');
    expect(ids).not.toContain('collector_never_ran');
  });
});
