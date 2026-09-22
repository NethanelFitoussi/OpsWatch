import { describe, expect, it } from 'vitest';
import { reportSchema, type Report } from '@opswatch/contract';
import {
  DEFAULT_AVAILABILITY_OBJECTIVE,
  PERIOD_MS,
  REPORT_ROW_LIMIT,
  SECTION_FAMILY,
  figure,
  readReport,
  windowsFor,
} from '@/lib/read/reports';
import { PROBLEM_FAMILIES, kindsOfFamily } from '@/lib/detect/family';
import { writeHistorySettings } from '@/lib/history/settings';
import { opswatchDbProvider } from '@/lib/history/opswatch-db';
import { insertProblem, updateProblem } from '@/lib/store/problems';
import { recordDeployments } from '@/lib/store/deployments';
import { recordError, upsertLogSource } from '@/lib/store/errors';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const context = { nowMs: NOW };
const query = { ...env, section: 'containers', period: '7d' as const };

const DAY = 24 * 60 * 60_000;
const sectionOf = (report: Report, id: string) => report.sections.find((section) => section.id === id);

/** A problem of one family, opened at a chosen instant. */
const open = (db: ReturnType<typeof createTestDb>, at: number, over: Record<string, unknown> = {}) =>
  insertProblem(db, newProblem({ key: `k${at}${JSON.stringify(over)}`.padEnd(32, 'x'), firstSeenAt: at, lastSeenAt: at, lastEvaluatedAt: at, ...over }));

describe('the two windows a report compares (§19)', () => {
  it('puts the previous period immediately before, at the same length', () => {
    const windows = windowsFor('7d', NOW);
    expect(windows.period).toEqual({ from: NOW - 7 * DAY, to: NOW });
    expect(windows.previous).toEqual({ from: NOW - 14 * DAY, to: NOW - 7 * DAY });
    // They meet exactly: no gap that would lose a problem, no overlap that would count one twice.
    expect(windows.previous.to).toBe(windows.period.from);
  });

  it('offers the periods §19 names, and each is the length it claims', () => {
    expect(Object.keys(PERIOD_MS).sort()).toEqual(['24h', '30d', '7d']);
    expect(PERIOD_MS['24h']).toBe(DAY);
    expect(PERIOD_MS['7d']).toBe(7 * DAY);
    expect(PERIOD_MS['30d']).toBe(30 * DAY);
  });
});

describe('every family a detector can name has a section that reports on it', () => {
  it('maps each of the four families to exactly one section, and each section to one family', () => {
    // A family with no section would be detected and then never summarised anywhere.
    expect([...PROBLEM_FAMILIES].sort()).toEqual([...new Set(Object.values(SECTION_FAMILY))].sort());
    expect(Object.keys(SECTION_FAMILY)).toHaveLength(PROBLEM_FAMILIES.length);
  });

  it('gives every family at least one detector kind to count', () => {
    for (const family of PROBLEM_FAMILIES) expect(kindsOfFamily(family).length).toBeGreaterThan(0);
  });
});

describe('a figure carries its comparison', () => {
  it('subtracts when both sides are known', () => {
    expect(figure('opened', 14, 31)).toMatchObject({ value: 14, previous: 31, delta: -17 });
  });

  it('THE RULING: an unknown side leaves the delta unknown rather than treating it as zero', () => {
    expect(figure('opened', 14, null).delta).toBeNull();
    expect(figure('opened', null, 31).delta).toBeNull();
    // Which is different from a genuine zero change.
    expect(figure('opened', 14, 14).delta).toBe(0);
  });
});

describe('the problems section, which needs no history switch', () => {
  it('counts what opened and what resolved in the period, by severity', () => {
    const db = createTestDb();
    open(db, NOW - 2 * DAY);
    open(db, NOW - 3 * DAY, { severity: 'warning' });
    const resolved = open(db, NOW - 4 * DAY);
    updateProblem(db, resolved.id, { resolvedAt: NOW - 1 * DAY, status: 'resolved' });
    // Outside the period entirely: it belongs to the previous one.
    open(db, NOW - 9 * DAY);

    const report = readReport(db, query, context);
    const section = sectionOf(report, 'problems');
    expect(section?.unavailable).toBeNull();
    expect(section?.figures.find((f) => f.id === 'opened')).toMatchObject({ value: 3, previous: 1, delta: 2 });
    expect(section?.figures.find((f) => f.id === 'resolved')).toMatchObject({ value: 1 });
    expect(section?.figures.find((f) => f.id === 'opened.warning')).toMatchObject({ value: 1, severity: 'warning' });
  });

  it('scopes itself to its own section, so a database report does not count container problems', () => {
    const db = createTestDb();
    open(db, NOW - 2 * DAY, { kind: 'ecs_cpu_high' });
    open(db, NOW - 2 * DAY, { kind: 'rds_cpu_high' });

    const containers = sectionOf(readReport(db, query, context), 'problems');
    const databases = sectionOf(readReport(db, { ...query, section: 'databases' }, context), 'problems');
    expect(containers?.figures.find((f) => f.id === 'opened')?.value).toBe(1);
    expect(databases?.figures.find((f) => f.id === 'opened')?.value).toBe(1);
    expect(SECTION_FAMILY.containers).toBe('ecs');
    expect(SECTION_FAMILY.databases).toBe('rds');
  });

  it('counts an instant into exactly one period, because the window is half-open', () => {
    const db = createTestDb();
    const boundary = NOW - 7 * DAY;
    open(db, boundary);

    const section = sectionOf(readReport(db, query, context), 'problems');
    // At `from` it is inside this period, and therefore not inside the previous one.
    expect(section?.figures.find((f) => f.id === 'opened')).toMatchObject({ value: 1, previous: 0 });
  });

  it('lists the worst subjects with what each did last period', () => {
    const db = createTestDb();
    for (let i = 0; i < 3; i += 1) open(db, NOW - 2 * DAY, { subjectId: 'prod/api', subjectName: 'api', key: `a${i}`.padEnd(32, 'x') });
    open(db, NOW - 2 * DAY, { subjectId: 'prod/web', subjectName: 'web' });
    open(db, NOW - 9 * DAY, { subjectId: 'prod/api', subjectName: 'api', key: 'prev'.padEnd(32, 'x') });

    const rows = sectionOf(readReport(db, query, context), 'problems')?.rows ?? [];
    expect(rows[0]).toMatchObject({ id: 'prod/api', label: 'api', value: 3, previous: 1, delta: 2 });
    expect(rows[0]?.ref).toMatchObject({ type: 'infrastructure', id: 'prod/api' });
    // A subject with nothing last period gets a real zero: it existed and opened nothing.
    expect(rows.find((row) => row.id === 'prod/web')).toMatchObject({ previous: 0 });
    expect(rows.length).toBeLessThanOrEqual(REPORT_ROW_LIMIT);
  });
});

describe('§2.6 — a section that cannot be answered says which and why', () => {
  it('errors read `not_collected` when nothing is reading logs, not "no errors"', () => {
    const db = createTestDb();
    const section = sectionOf(readReport(db, query, context), 'errors');
    expect(section?.unavailable).toBe('not_collected');
    // Not an empty list of rows with no explanation, which a client would render as "none".
    expect(section?.rows).toEqual([]);
    expect(section?.figures).toEqual([]);
  });

  it('availability reads `history_off` on a fresh installation, which is a decision and not a fault', () => {
    const db = createTestDb();
    expect(sectionOf(readReport(db, query, context), 'availability')?.unavailable).toBe('history_off');
  });

  it('availability reads `not_enough_history` once it is on but the window is not covered', () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW);
    expect(sectionOf(readReport(db, query, context), 'availability')?.unavailable).toBe('not_enough_history');
  });

  it('synthetics reads `not_measured`, because nothing in this build runs a check', () => {
    expect(sectionOf(readReport(createTestDb(), query, context), 'synthetics')?.unavailable).toBe('not_measured');
  });

  it('THE RULING: deployments read `not_collected` before the job has recorded any, not `not_measured`', () => {
    // The collector only remembers deployments from the moment it first ran. A report over an earlier window
    // would otherwise show a suspiciously quiet week, which is a claim nobody measured.
    expect(sectionOf(readReport(createTestDb(), query, context), 'deployments')?.unavailable).toBe('not_collected');
  });

  it('a section nobody reports on is `not_measured` rather than a fabricated empty report', () => {
    const report = readReport(createTestDb(), { ...query, section: 'logs' }, context);
    expect(sectionOf(report, 'problems')?.unavailable).toBe('not_measured');
  });
});

describe('deployments, once the job has recorded some', () => {
  const shipped = (over: Record<string, unknown> = {}) => ({
    deploymentId: 'd1', serviceId: 'prod/web', serviceName: 'web', cluster: 'prod',
    taskDefinition: 'web:42', status: 'completed' as const,
    startedAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY, desiredCount: 3, runningCount: 3, failedTasks: 0,
    ...over,
  });

  it('counts what shipped and what failed, against the period before', () => {
    const db = createTestDb();
    recordDeployments(db, env, [shipped(), shipped({ deploymentId: 'd2', status: 'failed', failedTasks: 1 })], NOW);
    recordDeployments(db, env, [shipped({ deploymentId: 'd0', startedAt: NOW - 9 * DAY })], NOW);

    const section = sectionOf(readReport(db, query, context), 'deployments');
    expect(section?.unavailable).toBeNull();
    expect(section?.figures.find((f) => f.id === 'deployments')).toMatchObject({ value: 2, previous: 1, delta: 1 });
    expect(section?.figures.find((f) => f.id === 'deploymentsFailed')).toMatchObject({ value: 1, previous: 0 });
  });

  it('marks a failed deployment critical and points at it', () => {
    const db = createTestDb();
    recordDeployments(db, env, [shipped({ status: 'failed', failedTasks: 2 })], NOW);
    const rows = sectionOf(readReport(db, query, context), 'deployments')?.rows ?? [];
    expect(rows[0]).toMatchObject({ label: 'web · web:42', severity: 'critical' });
    expect(rows[0]?.ref).toMatchObject({ type: 'deployment', id: 'd1' });
  });
});

describe('errors, once something is reading logs', () => {
  const seedSource = (db: ReturnType<typeof createTestDb>) =>
    upsertLogSource(db, {
      ...env, logGroup: '/aws/ecs/web', serviceId: 'prod/web', enabled: true,
      format: 'json', fieldMap: {},
    });

  const seen = (at: number, count: number) => ({
    ...env, logSourceId: 's1', serviceId: 'prod/web', fingerprint: 'f'.repeat(32), fingerprintVersion: 1,
    exceptionType: 'TypeError', sampleMessage: 'boom', normalizedMessage: 'boom', topFrames: [],
    at, count, instances: 1,
  });

  it('lists the top groups with how often each fired, against the period before', () => {
    const db = createTestDb();
    seedSource(db);
    recordError(db, seen(NOW - 2 * DAY, 10));
    recordError(db, seen(NOW - 9 * DAY, 4));

    const section = sectionOf(readReport(db, query, context), 'errors');
    expect(section?.unavailable).toBeNull();
    expect(section?.rows[0]).toMatchObject({ label: 'boom', value: 10, previous: 4, delta: 6 });
    expect(section?.figures.find((f) => f.id === 'occurrences')).toMatchObject({ value: 10, previous: 4 });
  });
});

describe('availability, from stored rollups only', () => {
  it('measures the share of intervals with nothing affected, and compares periods', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * DAY);
    const provider = opswatchDbProvider(db);
    const step = 5 * 60_000;
    const align = (at: number) => Math.floor(at / step) * step;

    const points = [
      // This period: three intervals, two of them clear.
      ...[0, 1, 2].map((i) => ({ at: align(NOW - 2 * DAY) + i * step, value: i === 0 ? 2 : 0 })),
      // The one before: three intervals, none clear.
      ...[0, 1, 2].map((i) => ({ at: align(NOW - 9 * DAY) + i * step, value: 1 })),
    ].map((point) => ({
      category: 'metric' as const, subjectId: 'ecs', metric: 'affected', ...env,
      intervalStart: point.at, resolution: '5m' as const, value: point.value, samples: 1,
    }));
    await provider.write(points, NOW);

    const section = sectionOf(readReport(db, query, context), 'availability');
    expect(section?.unavailable).toBeNull();
    expect(section?.figures.find((f) => f.id === 'healthyShare')).toMatchObject({
      value: (2 / 3) * 100,
      previous: 0,
    });
    expect(section?.figures.find((f) => f.id === 'intervals')).toMatchObject({ value: 3, previous: 3 });
  });

  it('THE RULING: an unmeasured interval is left out of the share, not counted as healthy', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * DAY);
    const step = 5 * 60_000;
    const base = Math.floor((NOW - 2 * DAY) / step) * step;
    // Three intervals: one unmeasured, one clear, one with something affected.
    await opswatchDbProvider(db).write(
      [null, 0, 1].map((value, i) => ({
        category: 'metric' as const, subjectId: 'ecs', metric: 'affected', ...env,
        intervalStart: base + i * step, resolution: '5m' as const, value, samples: 1,
      })),
      NOW,
    );

    // Two measured, one of them clear: 50%. Counting the unmeasured one as healthy would give 66.7%, which
    // would report availability nobody observed.
    const section = sectionOf(readReport(db, query, context), 'availability');
    expect(section?.figures.find((f) => f.id === 'healthyShare')?.value).toBe(50);
    // And `intervals` still says three, so the reader can see the share was taken over fewer than that.
    expect(section?.figures.find((f) => f.id === 'intervals')?.value).toBe(3);
  });
});

describe('§19 — real availability, where the rollups exist', () => {
  const step = 5 * 60_000;
  const align = (at: number) => Math.floor(at / step) * step;

  /** One load balancer's worth of stored rollups over `count` consecutive intervals ending now. */
  const storeAlb = async (db: ReturnType<typeof createTestDb>, name: string, count: number, bad: number) => {
    const base = align(NOW) - count * step;
    const points = Array.from({ length: count }, (_, i) => i).flatMap((i) => [
      { metric: 'requests', value: 1000 },
      { metric: 'elb5xx', value: i < bad ? 100 : 0 },
      { metric: 'target5xx', value: 0 },
    ].map((one) => ({
      category: 'metric' as const, subjectId: name, metric: one.metric, ...env,
      intervalStart: base + i * step, resolution: '5m' as const, value: one.value, samples: 1,
    })));
    await opswatchDbProvider(db).write(points, NOW);
  };

  const day = { ...query, period: '24h' as const };

  it('computes availability per load balancer from requests and 5xx', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * DAY);
    // Also needs the family series, or the section stops at "not enough history" before reaching this.
    await opswatchDbProvider(db).write(
      [{ category: 'metric', subjectId: 'ecs', metric: 'affected', ...env, intervalStart: align(NOW) - step, resolution: '5m', value: 0, samples: 1 }],
      NOW,
    );
    // A day is 288 five-minute intervals; 100 is over §19's quarter, so a figure may be shown.
    await storeAlb(db, 'prod-alb', 100, 1);

    const section = sectionOf(readReport(db, day, context), 'availability');
    expect(section?.unavailable).toBeNull();
    // 100 intervals of 1000 requests; one had 100 errors. 99,900/100,000 = 99.9 %.
    expect(section?.figures.find((f) => f.id === 'availability')?.value).toBeCloseTo(99.9, 6);
    expect(section?.rows.find((row) => row.id === 'prod-alb')?.value).toBeCloseTo(99.9, 6);
  });

  it('measures against a stated objective rather than an implicit one', () => {
    // Three nines. It is the default only because no per-service SLO can be defined yet (SLO-1), and the
    // error-budget figure on the page is meaningless without knowing what it is a budget against.
    expect(DEFAULT_AVAILABILITY_OBJECTIVE).toBe(0.999);
  });

  it('THE RULING: too few intervals to stand behind gives no figure, even with rollups present', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * DAY);
    await opswatchDbProvider(db).write(
      [{ category: 'metric', subjectId: 'ecs', metric: 'affected', ...env, intervalStart: align(NOW) - step, resolution: '5m', value: 0, samples: 1 }],
      NOW,
    );
    // Ten intervals of a 288-interval day is well under a quarter (§19).
    await storeAlb(db, 'prod-alb', 10, 1);

    const section = sectionOf(readReport(db, day, context), 'availability');
    expect(section?.figures.find((f) => f.id === 'availability')?.value).toBeNull();
    expect(section?.rows.find((row) => row.id === 'prod-alb')?.value).toBeNull();
  });

  it('THE RULING: with no availability rollups it offers no availability figure at all', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 30 * DAY);
    await opswatchDbProvider(db).write(
      [{ category: 'metric', subjectId: 'ecs', metric: 'affected', ...env, intervalStart: align(NOW) - step, resolution: '5m', value: 0, samples: 1 }],
      NOW,
    );

    const section = sectionOf(readReport(db, day, context), 'availability');
    // The bucket share is still there; the request-level figure is absent rather than zero or 100.
    expect(section?.figures.find((f) => f.id === 'healthyShare')).toBeDefined();
    expect(section?.figures.find((f) => f.id === 'availability')).toBeUndefined();
    expect(section?.rows).toEqual([]);
  });
});

describe('the report on the wire', () => {
  it('is exactly what every client parses', () => {
    const db = createTestDb();
    open(db, NOW - 2 * DAY);
    const report = readReport(db, query, context);
    expect(() => reportSchema.parse(report)).not.toThrow();
    expect(report.period).toMatchObject({ id: '7d', from: NOW - 7 * DAY, to: NOW });
    expect(report.section).toBe('containers');
  });

  it('never carries both figures and an unavailable reason, which would be two answers at once', () => {
    const report = readReport(createTestDb(), query, context);
    for (const section of report.sections) {
      if (section.unavailable !== null) {
        expect({ id: section.id, figures: section.figures, rows: section.rows }).toEqual({ id: section.id, figures: [], rows: [] });
      }
    }
  });
});
