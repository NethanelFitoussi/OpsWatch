import { describe, expect, it } from 'vitest';
import { runAlertCycle } from '@/lib/collector/alerts';
import { sloBurnCandidates } from '@/lib/collector/slo-burn';
import { FAST_BURN, SLOW_BURN } from '@/lib/detect/slo';
import { opswatchDbProvider } from '@/lib/history/opswatch-db';
import { writeHistorySettings } from '@/lib/history/settings';
import { listAlerts, listRules } from '@/lib/store/alerts';
import { upsertSloDefinition } from '@/lib/store/slos';
import { createTestDb } from '../helpers/db';

/**
 * §19's multi-window burn, turned into something that alerts (SLO-2).
 *
 * The arithmetic was written with the rest of the SLO work and nothing acted on it, so an objective could
 * burn a month of budget in a morning and the only way to find out was to open the page.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const STEP = 5 * 60_000;
const env = { connectionId: 'c1', scope: 'us-east-1' };
const SUBJECT = 'app/prod-web/1a2b3c';

const define = (db: ReturnType<typeof createTestDb>, over: Partial<Parameters<typeof upsertSloDefinition>[1]> = {}) =>
  upsertSloDefinition(
    db,
    { ...env, name: 'Checkout', kind: 'availability', subjectId: SUBJECT, objective: 0.99, latencyThresholdMs: null, windowDays: 30, enabled: true, ...over },
    NOW,
  );

/** Fills the last `windowMs` with rollups failing at `badPerThousand`, which sets the burn rate. */
async function burn(db: ReturnType<typeof createTestDb>, windowMs: number, badPerThousand: number) {
  const intervals = Math.round(windowMs / STEP);
  const base = Math.floor((NOW - windowMs) / STEP) * STEP;
  const points = Array.from({ length: intervals }, (_, i) => i).flatMap((i) =>
    [
      { metric: 'requests', value: 1000 },
      { metric: 'elb5xx', value: badPerThousand },
      { metric: 'target5xx', value: 0 },
    ].map((point) => ({
      category: 'metric' as const,
      subjectId: SUBJECT,
      ...env,
      intervalStart: base + i * STEP,
      resolution: '5m' as const,
      samples: 1,
      ...point,
    })),
  );
  await opswatchDbProvider(db).write(points, NOW);
}

describe('deciding that a budget is burning (§19)', () => {
  it('THE RULING: a fast burn is raised, and the slow one it obviously also has is not', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db);
    // 1 % of requests failing against a 1 % budget is 1×. 200 in a thousand is 20×, past 14.4× over an hour.
    await burn(db, SLOW_BURN.windowMs, 200);

    const candidates = sloBurnCandidates(db, env, NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: 'slo_burn_fast', severity: 'critical' });
    // Two messages about one thing is what §15 exists to prevent.
    expect(candidates.map((one) => one.kind)).not.toContain('slo_burn_slow');
  });

  it('a slower burn is a warning over the longer window, because it leaves time to act', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db);
    // 8 in a thousand against a 1 % budget is 0.8× — under 14.4× over an hour, past 6× it is not; 80 is.
    await burn(db, SLOW_BURN.windowMs, 80);

    const candidates = sloBurnCandidates(db, env, NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: 'slo_burn_slow', severity: 'warning' });
  });

  it('THE RULING: an objective comfortably inside its budget raises nothing', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db);
    // One in a thousand against a one-in-a-hundred budget: a tenth of the allowance.
    await burn(db, SLOW_BURN.windowMs, 1);

    expect(sloBurnCandidates(db, env, NOW)).toEqual([]);
  });

  it('THE RULING: an objective with nothing stored burns at no measurable rate, which is not zero and not fast', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db);
    // Two intervals of a twelve-interval hour is under §19's floor: no rate may be stated either way.
    await burn(db, 2 * STEP, 1000);

    expect(sloBurnCandidates(db, env, NOW)).toEqual([]);
  });

  it('says nothing at all while history is off, because there is nothing to burn through', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db);
    await burn(db, SLOW_BURN.windowMs, 200);
    writeHistorySettings(db, { enabled: false }, NOW);

    expect(sloBurnCandidates(db, env, NOW)).toEqual([]);
  });

  it('a paused objective is not measured, so it cannot alert', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db, { enabled: false });
    await burn(db, SLOW_BURN.windowMs, 200);

    expect(sloBurnCandidates(db, env, NOW)).toEqual([]);
  });

  it('names the objective and the window, because a rate means nothing without one', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db, { name: 'Checkout availability' });
    await burn(db, SLOW_BURN.windowMs, 200);

    expect(sloBurnCandidates(db, env, NOW)[0].values).toMatchObject({
      name: 'Checkout availability',
      hours: Math.round(FAST_BURN.windowMs / 3_600_000),
    });
  });
});

describe('a burn goes through §15, not around it', () => {
  it('THE RULING: it becomes an ordinary alert, under a rule that can be turned off', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db);
    await burn(db, SLOW_BURN.windowMs, 200);

    expect(runAlertCycle(db, env, [], NOW)).toMatchObject({ opened: 1 });
    const [alert] = listAlerts(db, env.connectionId, env.scope, 10);
    expect(alert).toMatchObject({ severity: 'critical', titleKey: 'Insights.messages.slo_burn_fast', problemId: null });
    // Its rule is the install one, visible beside the others rather than a second alerting system.
    expect(listRules(db, env.connectionId, env.scope).find((rule) => rule.id === alert.ruleId)?.name).toBe('slo_burn');
  });

  it('the same burn on the next cycle is one alert, not two', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db);
    await burn(db, SLOW_BURN.windowMs, 200);

    runAlertCycle(db, env, [], NOW);
    expect(runAlertCycle(db, env, [], NOW + 60_000)).toMatchObject({ opened: 0, suppressed: 1 });
    expect(listAlerts(db, env.connectionId, env.scope, 10)).toHaveLength(1);
  });

  it('THE RULING: turning the rule off stops the alert, because it is an ordinary rule', async () => {
    const db = createTestDb();
    writeHistorySettings(db, { enabled: true }, NOW - 24 * 60 * 60_000);
    define(db);
    await burn(db, SLOW_BURN.windowMs, 200);

    runAlertCycle(db, env, [], NOW - 60_000);
    const rule = listRules(db, env.connectionId, env.scope).find((one) => one.name === 'slo_burn');
    expect(rule).toBeDefined();

    const { setRuleEnabled } = await import('@/lib/store/alerts');
    setRuleEnabled(db, rule?.id ?? '', false);
    // Nothing still matches it, so §15.2 resolves what it had opened.
    expect(runAlertCycle(db, env, [], NOW)).toMatchObject({ opened: 0, resolved: 1 });
  });
});
