import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { REPORT_SECTIONS, readReport } from '@/lib/read/reports';
import { REPORT_UNAVAILABLE_REASONS } from '@opswatch/contract';
import { writeHistorySettings } from '@/lib/history/settings';
import { insertProblem, updateProblem } from '@/lib/store/problems';
import { recordDeployments } from '@/lib/store/deployments';
import { recordError, upsertLogSource } from '@/lib/store/errors';
import { BYTES_PER_GB, recordBudgetStop, recordScan } from '@/lib/store/logs-budget';
import { recordRun, upsertCheck } from '@/lib/store/synthetics';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

/**
 * THE RULING: every key a report **builds at run time** has a message behind it.
 *
 * The catalogue guard in `message-keys.test.ts` proves a key written down is reachable. It cannot prove
 * that a key the code *composes* — `figure.${id}`, `sections.${id}`, `unavailable.${reason}` — was ever
 * written down at all. That is the failure that shipped: `openedCritical` was invented inside a loop over
 * the severities, no message was added for it, and next-intl printed `Monitoring.report.figure.…` onto
 * four report pages while every test stayed green.
 *
 * So the report is actually built — one per section, over a database holding one of everything — and each
 * id it emits is looked up in both catalogues. A new figure with no message fails here, on the day it is
 * added, rather than on a page somebody is reading.
 */

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const DAY = 24 * 60 * 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };

type Tree = { [key: string]: string | Tree };
const lookup = (messages: Tree, path: string): unknown => path.split('.').reduce<unknown>((node, part) => (node as Tree)?.[part], messages);

/** A database holding one of everything a report can count, so no section is empty by accident. */
function seeded() {
  const db = createTestDb();
  writeHistorySettings(db, { enabled: true }, NOW - 30 * DAY);

  for (const [index, severity] of (['critical', 'warning', 'info'] as const).entries()) {
    insertProblem(db, newProblem({ key: `p${index}`.padEnd(32, 'x'), severity, firstSeenAt: NOW - 2 * DAY, lastSeenAt: NOW - 2 * DAY, lastEvaluatedAt: NOW - 2 * DAY }));
  }
  const resolved = insertProblem(db, newProblem({ key: 'resolved'.padEnd(32, 'x'), firstSeenAt: NOW - 3 * DAY, lastSeenAt: NOW - 3 * DAY, lastEvaluatedAt: NOW - 3 * DAY }));
  updateProblem(db, resolved.id, { resolvedAt: NOW - DAY, status: 'resolved' });

  recordDeployments(
    db,
    env,
    [
      { deploymentId: 'd1', serviceId: 'prod/web', serviceName: 'web', cluster: 'prod', taskDefinition: 'web:42', status: 'completed', startedAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY, desiredCount: 3, runningCount: 3, failedTasks: 0 },
      { deploymentId: 'd2', serviceId: 'prod/web', serviceName: 'web', cluster: 'prod', taskDefinition: 'web:43', status: 'failed', startedAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY, desiredCount: 3, runningCount: 1, failedTasks: 2 },
    ],
    NOW,
  );

  upsertLogSource(db, { ...env, logGroup: '/aws/ecs/web', serviceId: 'prod/web', enabled: true, format: 'json', fieldMap: {} });
  recordError(db, {
    ...env, logSourceId: 's1', serviceId: 'prod/web', fingerprint: 'f'.repeat(32), fingerprintVersion: 1,
    exceptionType: 'TypeError', sampleMessage: 'boom', normalizedMessage: 'boom', topFrames: [],
    at: NOW - 2 * DAY, count: 10, instances: 1,
  });

  recordScan(db, NOW - 2 * DAY, env.connectionId, 3 * BYTES_PER_GB);
  recordBudgetStop(db, NOW - 2 * DAY, env.connectionId);

  const check = upsertCheck(db, { ...env, name: 'home', url: 'https://example.com/home', enabled: true, assertions: [] }, NOW);
  recordRun(db, { checkId: check.id, at: NOW - 2 * DAY, ok: true, totalMs: 120, assertionResults: [] });

  return db;
}

describe('THE RULING: a report never composes a key that has no message', () => {
  const db = seeded();
  const emitted = new Set<string>();
  for (const section of REPORT_SECTIONS) {
    const report = readReport(db, { ...env, section, period: '7d' }, { nowMs: NOW });
    for (const one of report.sections) {
      emitted.add(`sections.${one.id}`);
      for (const value of one.figures) emitted.add(`figure.${value.id}`);
      if (one.unavailable !== null) emitted.add(`unavailable.${one.unavailable}`);
    }
  }

  it('emits something to check, so a silent report cannot pass this test', () => {
    // Guards the guard: if the seeding stopped producing sections, the loops above would assert nothing.
    expect(emitted.size).toBeGreaterThan(12);
    expect([...emitted].filter((key) => key.startsWith('figure.')).length).toBeGreaterThan(5);
  });

  it.each([['en', en], ['fr', fr]] as const)('%s has a message for every id the report built', (locale, messages) => {
    const missing = [...emitted].filter((key) => typeof lookup(messages.Monitoring.report as unknown as Tree, key) !== 'string');
    expect(missing.sort(), `${locale} is missing report messages`).toEqual([]);
  });

  it.each([['en', en], ['fr', fr]] as const)('%s explains every reason a section can be unavailable', (locale, messages) => {
    // These come from the contract rather than from this database, so the seeding cannot hide one.
    const missing = REPORT_UNAVAILABLE_REASONS.filter((reason) => typeof lookup(messages.Monitoring.report as unknown as Tree, `unavailable.${reason}`) !== 'string');
    expect(missing, `${locale}`).toEqual([]);
  });
});
