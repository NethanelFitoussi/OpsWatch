import { describe, expect, it } from 'vitest';
import { runAlertCycle, toCandidate } from '@/lib/collector/alerts';
import { acknowledgeAlert, listAlerts, listRules, setRuleEnabled } from '@/lib/store/alerts';
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
    expect(rules.map((rule) => rule.name)).toEqual(['certificate_expiring', 'critical_problems', 'synthetic_down']);
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
    expect(rules).toHaveLength(3);
    expect(rules.find((rule) => rule.id === first.id)?.enabled).toBe(false);
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
