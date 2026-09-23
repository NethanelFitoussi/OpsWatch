import { describe, expect, it } from 'vitest';
import { ALERT_STATUSES, alertSummarySchema } from '@opswatch/contract';
import { ALERT_LIMIT, listAlertSummaries, toAlertSummary, wireAlertStatus } from '@/lib/read/alerts';
import { acknowledgeAlert, openAlert, suppressAlert } from '@/lib/store/alerts';
import { ensureInstallRules, listRules } from '@/lib/store/alerts';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const labels = {
  title: (key: string, values: Record<string, string | number>) => `${key}:${JSON.stringify(values)}`,
  suppressed: (count: number) => `suppressed:${count}`,
};

const seedAlert = (db: ReturnType<typeof createTestDb>) => {
  ensureInstallRules(db, env.connectionId, env.scope, NOW);
  const [rule] = listRules(db, env.connectionId, env.scope);
  return openAlert(db, {
    ...env,
    ruleId: rule.id,
    dedupeKey: `${rule.id}|prod/web`,
    problemId: 'p1',
    titleKey: 'Insights.messages.ecs_cpu_high',
    values: { service: 'web' },
    severity: 'critical',
    at: NOW,
  });
};

describe('the stored status onto the wire', () => {
  it('THE RULING: every status maps to one the contract knows', () => {
    const base = { resolvedAt: null, acknowledgedAt: null } as Parameters<typeof wireAlertStatus>[0];
    for (const row of [
      base,
      { ...base, acknowledgedAt: NOW },
      { ...base, resolvedAt: NOW },
    ]) {
      expect(ALERT_STATUSES).toContain(wireAlertStatus(row));
    }
  });

  it('keeps acknowledged apart from resolved, because they are different facts', () => {
    const base = { resolvedAt: null, acknowledgedAt: null } as Parameters<typeof wireAlertStatus>[0];
    expect(wireAlertStatus(base)).toBe('firing');
    expect(wireAlertStatus({ ...base, acknowledgedAt: NOW })).toBe('acknowledged');
    // Resolution wins: an acknowledged alert that then resolved is resolved.
    expect(wireAlertStatus({ ...base, acknowledgedAt: NOW, resolvedAt: NOW })).toBe('resolved');
  });
});

describe('§15.2 — the silence is visible', () => {
  it('THE RULING: an alert that suppressed fires says how many', () => {
    const db = createTestDb();
    const alert = seedAlert(db);
    suppressAlert(db, alert.id, NOW + 1000);
    suppressAlert(db, alert.id, NOW + 2000);

    const [summary] = listAlertSummaries(db, env, labels);
    // "Firing" alone would hide that it fired three times and announced itself once.
    expect(summary?.reason).toBe('suppressed:2');
  });

  it('says nothing about suppression when there was none', () => {
    const db = createTestDb();
    seedAlert(db);
    expect(listAlertSummaries(db, env, labels)[0]?.reason).toBeUndefined();
  });
});

describe('an alert on the wire', () => {
  it('is exactly what every client parses', () => {
    const db = createTestDb();
    const alert = seedAlert(db);
    const summary = toAlertSummary(alert, labels);
    expect(() => alertSummarySchema.parse(summary)).not.toThrow();
    expect(summary).toMatchObject({ source: 'opswatch', severity: 'critical', problemId: 'p1', since: NOW });
  });

  it('renders the problem’s own key, so an alert says what the problem says', () => {
    const db = createTestDb();
    seedAlert(db);
    expect(listAlertSummaries(db, env, labels)[0]?.name).toContain('Insights.messages.ecs_cpu_high');
  });

  it('reports an acknowledgement as acknowledged, not as resolved', () => {
    const db = createTestDb();
    const alert = seedAlert(db);
    acknowledgeAlert(db, alert.id, NOW, 'admin');
    expect(listAlertSummaries(db, env, labels)[0]).toMatchObject({ status: 'acknowledged', resolvedAt: null });
  });

  it('keeps environments apart and is bounded', () => {
    const db = createTestDb();
    seedAlert(db);
    expect(listAlertSummaries(db, { connectionId: 'c1', scope: 'eu-west-1' }, labels)).toEqual([]);
    expect(ALERT_LIMIT).toBeGreaterThan(0);
  });
});
