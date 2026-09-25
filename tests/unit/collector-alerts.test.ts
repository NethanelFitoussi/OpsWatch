import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

// `alertUrl` builds the link a webhook carries from the instance's public URL, so queueing one needs
// the environment. Nothing here encrypts with this secret; `createDestination` is given its own.
const SECRET = 'test-secret'.padEnd(32, 'x');
vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'https://opswatch.example' }) }));
import { runAlertCycle, toCandidate } from '@/lib/collector/alerts';
import { acknowledgeAlert, ensureInstallRules, listAlerts, listRules, setRuleEnabled } from '@/lib/store/alerts';
import { INSTALL_RULES } from '@/lib/detect/alert';
import { alertRules } from '@/lib/db/schema';
import { createDestination, setDestinationEnabled } from '@/lib/store/notifications';
import { insertProblem } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };

const seed = (db: ReturnType<typeof createTestDb>, id: string, over: Record<string, unknown> = {}) =>
  insertProblem(db, newProblem({ key: id.padEnd(32, 'x'), severity: 'critical', lastEvaluatedAt: NOW, ...over }));

describe('§15.1 — the rules an installation starts with', () => {
  it('are created on the first cycle, visible and editable', () => {
    const db = createTestDb();
    runAlertCycle(db, env, [], NOW);
    const rules = listRules(db, env.connectionId, env.scope);
    expect(rules.map((rule) => rule.name)).toEqual(['certificate_expiring', 'critical_problems', 'slo_burn', 'synthetic_down']);
    // §15: nothing leaves the instance, so there is no other channel to choose.
    for (const rule of rules) expect(rule.channels).toEqual(['in_app']);
  });

  it('THE RULING: a curated installation stays curated', () => {
    const db = createTestDb();
    runAlertCycle(db, env, [], NOW);
    const [first] = listRules(db, env.connectionId, env.scope);
    setRuleEnabled(db, first.id, false);

    // A later cycle must not revive a rule somebody switched off, nor add the set again.
    runAlertCycle(db, env, [], NOW + MINUTE);
    const rules = listRules(db, env.connectionId, env.scope);
    expect(rules).toHaveLength(INSTALL_RULES.length);
    expect(rules.find((rule) => rule.id === first.id)?.enabled).toBe(false);
  });

  it('THE RULING: a rule deleted on purpose stays deleted, however many cycles run', () => {
    const db = createTestDb();
    runAlertCycle(db, env, [], NOW);
    const [first] = listRules(db, env.connectionId, env.scope);
    // Deleted the way an operator would, straight out of the table: the offer is what remembers it.
    db.delete(alertRules).where(eq(alertRules.id, first.id)).run();

    runAlertCycle(db, env, [], NOW + MINUTE);
    expect(listRules(db, env.connectionId, env.scope).map((rule) => rule.name)).not.toContain(first.name);
  });

  it('THE RULING: an installation already running receives a rule a later release ships', () => {
    const db = createTestDb();
    // The environment as an earlier release left it: offered only the rules that existed then.
    ensureInstallRules(db, env.connectionId, env.scope, NOW - 7 * 24 * 60 * 60_000, INSTALL_RULES.slice(0, 1));
    expect(listRules(db, env.connectionId, env.scope)).toHaveLength(1);

    // The upgrade runs a cycle. The rules it has never been offered arrive; the one it has does not double.
    runAlertCycle(db, env, [], NOW);
    const names = listRules(db, env.connectionId, env.scope).map((rule) => rule.name);
    expect(names).toEqual([...INSTALL_RULES.map((installed) => installed.name)].sort());
  });
});

describe('§15.2 — one problem is one alert', () => {
  it('opens one for a critical problem', () => {
    const db = createTestDb();
    const problem = seed(db, 'a');
    expect(runAlertCycle(db, env, [problem], NOW)).toMatchObject({ opened: 1 });

    const [alert] = listAlerts(db, env.connectionId, env.scope, 10);
    expect(alert).toMatchObject({ status: 'firing', severity: 'critical', problemId: problem.id, suppressedCount: 0 });
  });

  it('THE RULING: the same problem seen again does not open a second alert', () => {
    const db = createTestDb();
    const problem = seed(db, 'a');
    runAlertCycle(db, env, [problem], NOW);
    const second = runAlertCycle(db, env, [problem], NOW + MINUTE);

    expect(second).toMatchObject({ opened: 0, suppressed: 1 });
    expect(listAlerts(db, env.connectionId, env.scope, 10)).toHaveLength(1);
  });

  it('THE RULING: the cooldown is counted, so the quiet is visible', () => {
    const db = createTestDb();
    const problem = seed(db, 'a');
    runAlertCycle(db, env, [problem], NOW);
    runAlertCycle(db, env, [problem], NOW + MINUTE);
    runAlertCycle(db, env, [problem], NOW + 2 * MINUTE);

    // A page showing "firing, 2 further fires suppressed" is honest; one showing only "firing" is not.
    expect(listAlerts(db, env.connectionId, env.scope, 10)[0]?.suppressedCount).toBe(2);
  });

  it('fires again once the cooldown has passed', () => {
    const db = createTestDb();
    const problem = seed(db, 'a');
    runAlertCycle(db, env, [problem], NOW);
    expect(runAlertCycle(db, env, [problem], NOW + 31 * MINUTE)).toMatchObject({ refired: 1, suppressed: 0 });
  });

  it('THE RULING: acknowledging keeps it quiet past any cooldown', () => {
    const db = createTestDb();
    const problem = seed(db, 'a');
    runAlertCycle(db, env, [problem], NOW);
    const [alert] = listAlerts(db, env.connectionId, env.scope, 10);
    acknowledgeAlert(db, alert.id, NOW, 'admin');

    expect(runAlertCycle(db, env, [problem], NOW + 10 * 60 * MINUTE)).toMatchObject({ refired: 0, suppressed: 1 });
  });

  it('resolves an alert once its problem is no longer live', () => {
    const db = createTestDb();
    const problem = seed(db, 'a');
    runAlertCycle(db, env, [problem], NOW);
    expect(runAlertCycle(db, env, [], NOW + MINUTE)).toMatchObject({ resolved: 1 });
    expect(listAlerts(db, env.connectionId, env.scope, 10)[0]?.status).toBe('resolved');
  });

  it('opens a fresh alert when the same problem returns after resolution', () => {
    const db = createTestDb();
    const problem = seed(db, 'a');
    runAlertCycle(db, env, [problem], NOW);
    runAlertCycle(db, env, [], NOW + MINUTE);
    expect(runAlertCycle(db, env, [problem], NOW + 2 * MINUTE)).toMatchObject({ opened: 1 });
    expect(listAlerts(db, env.connectionId, env.scope, 10)).toHaveLength(2);
  });
});

describe('which problems alert at all', () => {
  it('leaves a warning alone under the default critical-only rule', () => {
    const db = createTestDb();
    const warning = seed(db, 'w', { severity: 'warning', kind: 'ecs_cpu_high' });
    expect(runAlertCycle(db, env, [warning], NOW)).toMatchObject({ opened: 0 });
  });

  it('alerts on a synthetic failure through the synthetic rule, not the problem rule', () => {
    const db = createTestDb();
    const down = seed(db, 's', { kind: 'synthetic_down', subjectType: 'synthetic' });
    // One alert, not two: the conditions partition the space.
    expect(runAlertCycle(db, env, [down], NOW)).toMatchObject({ opened: 1 });
  });

  it('carries the problem’s own title key, never a sentence', () => {
    const db = createTestDb();
    const problem = seed(db, 'a');
    runAlertCycle(db, env, [problem], NOW);
    expect(listAlerts(db, env.connectionId, env.scope, 10)[0]?.titleKey).toBe(problem.titleKey);
    expect(toCandidate(problem).subjectKey).toBe(problem.key);
  });
});

describe('THE RULING: one account’s alerts never reach another account’s endpoint', () => {
  /*
   * A webhook destination belongs to the installation, and the alert rules belong to an environment. So
   * the rule engine was scoped and the delivery was not: with Client A and Client B connected to one
   * OpsWatch, every enabled destination received every environment's alerts. That is one tenant's data
   * arriving at another's endpoint, not a preference.
   *
   * `null` remains the default and the whole meaning of a single-account installation: one endpoint,
   * every alert. What changed is that a destination may now name an account, and then receives only it.
   */
  const secret = 'secret'.padEnd(32, 'x');
  const other = { connectionId: 'c2', scope: 'eu-west-1' };

  const fire = (db: ReturnType<typeof createTestDb>, where: { connectionId: string; scope: string }, key: string) =>
    runAlertCycle(db, where, [seed(db, key, { ...where })], NOW);

  it('sends an unscoped destination everything, which is what one account means', () => {
    const db = createTestDb();
    createDestination(db, { name: 'ops', url: 'https://example.com/hook' }, secret, NOW);

    expect(fire(db, env, 'a1').queued).toBe(1);
    expect(fire(db, other, 'b1').queued).toBe(1);
  });

  it('sends a scoped destination only its own account’s alerts', () => {
    const db = createTestDb();
    createDestination(db, { name: 'client-a', url: 'https://example.com/a', connectionId: env.connectionId }, secret, NOW);

    expect(fire(db, env, 'a1').queued).toBe(1);
    // The other account fires too — and reaches nowhere, because nothing of theirs is listening.
    expect(fire(db, other, 'b1').queued).toBe(0);
  });

  it('sends each client theirs and no more, with both connected at once', () => {
    const db = createTestDb();
    createDestination(db, { name: 'client-a', url: 'https://example.com/a', connectionId: env.connectionId }, secret, NOW);
    createDestination(db, { name: 'client-b', url: 'https://example.com/b', connectionId: other.connectionId }, secret, NOW);

    // One each, never two: the failure this replaces queued every alert to every endpoint.
    expect(fire(db, env, 'a1').queued).toBe(1);
    expect(fire(db, other, 'b1').queued).toBe(1);
  });

  it('never queues to a destination that is switched off, scoped or not', () => {
    const db = createTestDb();
    const { destination } = createDestination(db, { name: 'ops', url: 'https://example.com/hook' }, secret, NOW);
    setDestinationEnabled(db, destination.id, false);
    expect(fire(db, env, 'a1').queued).toBe(0);
  });
});
