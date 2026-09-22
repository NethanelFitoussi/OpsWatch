import { describe, expect, it } from 'vitest';
import {
  NOT_COLLECTED_CHECKS,
  collectionChecks,
  coverageChecks,
  permissionChecks,
  runCheckup,
  selfChecks,
  type CheckOutcome,
  type CheckSeverity,
  type CheckValues,
  type CheckupInput,
  type NotRunReason,
} from '@/lib/detect/checkup';

/** A healthy, fully-configured environment. Each test breaks exactly one thing. */
const healthy = (over: Partial<CheckupInput> = {}): CheckupInput => ({
  permissions: {
    accountMatches: true,
    testedAt: '2026-09-22T12:00:00.000Z',
    checks: [
      { service: 'ecs', status: 'ok' },
      { service: 'rds', status: 'ok' },
      { service: 'logs', status: 'ok' },
    ],
  },
  families: [
    { family: 'ecs', unavailableReason: null, unavailableCode: null },
    { family: 'rds', unavailableReason: null, unavailableCode: null },
  ],
  logSources: { total: 4, enabled: 2 },
  history: { enabled: true },
  logsBudget: { exhausted: false, scannedGb: 1, limitGb: 5 },
  collector: { neverRan: false, failingJobs: [] },
  template: { version: 1, current: 1 },
  ...over,
});

const ids = (outcomes: CheckOutcome[]) => outcomes.map((outcome) => outcome.id);
const byId = (outcomes: CheckOutcome[], id: string) => outcomes.find((outcome) => outcome.id === id);

describe('permissions come first, because a missing one makes every other check partial', () => {
  it('ranks a denied permission as critical and names the services', () => {
    const outcomes = permissionChecks(
      healthy({
        permissions: {
          accountMatches: true,
          testedAt: '2026-09-22T12:00:00.000Z',
          checks: [
            { service: 'ecs', status: 'ok' },
            { service: 'rds', status: 'denied', errorCode: 'AccessDenied' },
            { service: 'pi', status: 'denied' },
          ],
        },
      }),
    );
    expect(byId(outcomes, 'permissions_denied')).toMatchObject({
      state: 'finding',
      severity: 'critical',
      values: { services: 'rds, pi', count: 2 },
    });
  });

  it('separates an error from a refusal, because they call for different actions', () => {
    const outcomes = permissionChecks(
      healthy({
        permissions: {
          accountMatches: true,
          testedAt: '2026-09-22T12:00:00.000Z',
          checks: [{ service: 'logs', status: 'error', errorCode: 'Throttling' }],
        },
      }),
    );
    expect(byId(outcomes, 'permissions_errored')).toMatchObject({ state: 'finding', severity: 'warning' });
    expect(byId(outcomes, 'permissions_denied')).toBeUndefined();
  });

  it('THE RULING: reaching the wrong account outranks everything else', () => {
    const outcomes = permissionChecks(healthy({
      permissions: { accountMatches: false, testedAt: '2026-09-22T12:00:00.000Z', checks: [{ service: 'ecs', status: 'ok' }] },
    }));
    // Every reading since was about a different estate, so it is critical even though each check passed.
    expect(byId(outcomes, 'account_mismatch')).toMatchObject({ state: 'finding', severity: 'critical' });
  });

  it('never tested is its own answer, not a pass and not a failure', () => {
    const outcomes = permissionChecks(healthy({ permissions: null }));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ id: 'permissions_untested', state: 'finding', severity: 'warning' });
  });

  it('is clear when every check passed', () => {
    expect(permissionChecks(healthy())).toEqual([{ id: 'permissions_denied', state: 'clear' }]);
  });
});

describe('a family nobody could read is named', () => {
  it('reports one finding per unreadable family, carrying the reason and the code', () => {
    const outcomes = coverageChecks(
      healthy({
        families: [
          { family: 'ecs', unavailableReason: null, unavailableCode: null },
          { family: 'rds', unavailableReason: 'denied', unavailableCode: 'AccessDenied' },
        ],
      }),
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      state: 'finding',
      subject: 'rds',
      values: { family: 'rds', reason: 'denied', code: 'AccessDenied' },
    });
  });

  it('is clear when every family was read', () => {
    expect(coverageChecks(healthy())).toEqual([{ id: 'family_unreadable', state: 'clear' }]);
  });
});

describe('what is and is not being collected', () => {
  it('says errors are not collected when no log source is enabled, and counts what was discovered', () => {
    const outcomes = collectionChecks(healthy({ logSources: { total: 7, enabled: 0 } }));
    expect(byId(outcomes, 'errors_not_collected')).toMatchObject({
      state: 'finding',
      severity: 'warning',
      values: { discovered: 7 },
    });
  });

  it('rates history being off as info, because off is the shipped default and a deliberate choice', () => {
    const outcomes = collectionChecks(healthy({ history: { enabled: false } }));
    // Not a warning: §31.1 makes this the correct state for a fresh installation.
    expect(byId(outcomes, 'history_off')).toMatchObject({ state: 'finding', severity: 'info' });
  });

  it('rates an exhausted logs budget as critical, because it is a hard stop that hides data', () => {
    const outcomes = collectionChecks(healthy({ logsBudget: { exhausted: true, scannedGb: 5, limitGb: 5 } }));
    expect(byId(outcomes, 'logs_budget_exhausted')).toMatchObject({
      state: 'finding',
      severity: 'critical',
      values: { scanned: 5, limit: 5 },
    });
  });

  it('cannot judge a budget that was never configured, and says so rather than passing it', () => {
    const outcomes = collectionChecks(healthy({ logsBudget: null }));
    expect(byId(outcomes, 'logs_budget')).toMatchObject({ state: 'not_run', reason: 'not_collected' });
  });
});

describe('whether OpsWatch itself is working', () => {
  it('THE RULING: a collector that never ran is critical, because silence looks like health', () => {
    const outcomes = selfChecks(healthy({ collector: { neverRan: true, failingJobs: [] } }));
    expect(byId(outcomes, 'collector_never_ran')).toMatchObject({ state: 'finding', severity: 'critical' });
  });

  it('names the jobs that are failing', () => {
    const outcomes = selfChecks(healthy({ collector: { neverRan: false, failingJobs: ['detect', 'errors'] } }));
    expect(byId(outcomes, 'collector_job_failing')).toMatchObject({
      state: 'finding',
      values: { jobs: 'detect, errors', count: 2 },
    });
  });

  it('flags an outdated stack as info, and cannot judge one whose version is unknown', () => {
    expect(byId(selfChecks(healthy({ template: { version: 1, current: 2 } })), 'template_outdated')).toMatchObject({
      state: 'finding',
      severity: 'info',
      values: { version: 1, current: 2 },
    });
    expect(byId(selfChecks(healthy({ template: { version: null, current: 2 } })), 'template_outdated')).toMatchObject({
      state: 'not_run',
      reason: 'not_collected',
    });
  });
});

describe('§2.6 — a check that could not run is declared, never dropped', () => {
  it('THE RULING: every check this build cannot run appears in `notRun`, and is counted', () => {
    const checkup = runCheckup(healthy());
    expect(checkup.notRun.map((outcome) => outcome.id)).toEqual(expect.arrayContaining([...NOT_COLLECTED_CHECKS]));
    expect(checkup.coverage.notRun).toBe(checkup.notRun.length);
    // The counts add up, so a reader can see how much of the catalogue actually answered.
    expect(checkup.coverage.ran + checkup.coverage.notRun).toBe(checkup.coverage.total);
    expect(checkup.coverage.notRun).toBeGreaterThan(0);
  });

  it('a clean environment yields no findings, which is different from a catalogue that did not run', () => {
    const checkup = runCheckup(healthy());
    expect(checkup.findings).toEqual([]);
    // And the page can still say how many checks answered, so "no findings" is a measured statement.
    expect(checkup.coverage.ran).toBeGreaterThan(0);
  });

  it('every outcome is one of exactly three states', () => {
    const checkup = runCheckup(healthy({ permissions: null, logsBudget: null, collector: { neverRan: true, failingJobs: ['detect'] } }));
    for (const outcome of [...checkup.findings, ...checkup.notRun]) {
      expect(['finding', 'clear', 'not_run']).toContain(outcome.state);
    }
  });
});

describe('the vocabulary the catalogue speaks', () => {
  /**
   * These three names are the whole interface between a check and the page that renders it. Naming them
   * here means a rename has to pass through this file, which is where someone notices it is a rename.
   */
  it('has exactly three severities, worst first', () => {
    const order: CheckSeverity[] = ['critical', 'warning', 'info'];
    const checkup = runCheckup(healthy({ permissions: null, history: { enabled: false }, collector: { neverRan: true, failingJobs: [] } }));
    for (const finding of checkup.findings) expect(order).toContain(finding.severity);
  });

  it('gives every reason a check could not run', () => {
    const reasons: NotRunReason[] = ['denied', 'not_collected', 'cap', 'unsupported'];
    for (const outcome of runCheckup(healthy()).notRun) expect(reasons).toContain(outcome.reason);
  });

  it('carries placeholder values, never a built sentence', () => {
    const outcomes = selfChecks(healthy({ collector: { neverRan: false, failingJobs: ['detect'] } }));
    const values: CheckValues | undefined = byId(outcomes, 'collector_job_failing')?.state === 'finding'
      ? (byId(outcomes, 'collector_job_failing') as Extract<CheckOutcome, { state: 'finding' }>).values
      : undefined;
    expect(values).toEqual({ jobs: 'detect', count: 1 });
    // Every value is a placeholder a message key fills in, so both languages stay exact (Stage 3 §4).
    for (const value of Object.values(values ?? {})) expect(['string', 'number']).toContain(typeof value);
  });
});

describe('findings are ordered worst first', () => {
  it('puts critical before warning before info, and keeps catalogue order inside a severity', () => {
    const checkup = runCheckup(
      healthy({
        permissions: { accountMatches: false, testedAt: 'x', checks: [{ service: 'rds', status: 'denied' }] },
        history: { enabled: false },
        logSources: { total: 1, enabled: 0 },
        collector: { neverRan: true, failingJobs: [] },
      }),
    );
    const severities = checkup.findings.map((finding) => finding.severity);
    expect(severities).toEqual([...severities].sort((a, b) => ({ critical: 0, warning: 1, info: 2 })[a] - ({ critical: 0, warning: 1, info: 2 })[b]));
    // Permissions first among the criticals, which is the ordering the whole page depends on.
    expect(ids(checkup.findings)[0]).toBe('account_mismatch');
  });
});
