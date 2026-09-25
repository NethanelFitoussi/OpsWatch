import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COOLDOWN_SECONDS,
  INSTALL_RULES,
  SYNTHETIC_KINDS,
  decide,
  dedupeKeyFor,
  meetsSeverity,
  ruleMatches,
  type Candidate,
  type Rule,
} from '@/lib/detect/alert';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  enabled: true,
  condition: 'problem',
  minSeverity: 'critical',
  kinds: [],
  cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
  ...over,
});

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  subjectKey: 'prod/web',
  kind: 'ecs_cpu_high',
  severity: 'critical',
  problemId: 'p1',
  titleKey: 'Insights.messages.ecs_cpu_high',
  values: {},
  ...over,
});

describe('which rules match', () => {
  it('respects the severity floor', () => {
    expect(meetsSeverity('critical', 'warning')).toBe(true);
    expect(meetsSeverity('warning', 'critical')).toBe(false);
    expect(ruleMatches(rule({ minSeverity: 'critical' }), candidate({ severity: 'warning' }))).toBe(false);
    expect(ruleMatches(rule({ minSeverity: 'warning' }), candidate({ severity: 'critical' }))).toBe(true);
  });

  it('THE RULING: the two conditions partition the space rather than overlapping', () => {
    // One problem must not match both a `problem` rule and a `synthetic` rule by accident, or every
    // synthetic failure becomes two alerts.
    const synthetic = candidate({ kind: 'synthetic_down' });
    expect(ruleMatches(rule({ condition: 'problem' }), synthetic)).toBe(false);
    expect(ruleMatches(rule({ condition: 'synthetic' }), synthetic)).toBe(true);
    expect(ruleMatches(rule({ condition: 'synthetic' }), candidate())).toBe(false);
    expect(ruleMatches(rule({ condition: 'problem' }), candidate())).toBe(true);
  });

  it('an empty kind list means every kind the condition covers', () => {
    // Otherwise an install rule would need an operator to enumerate detectors they have never heard of.
    expect(ruleMatches(rule({ kinds: [] }), candidate({ kind: 'anything_at_all' }))).toBe(true);
    expect(ruleMatches(rule({ kinds: ['rds_cpu_high'] }), candidate({ kind: 'ecs_cpu_high' }))).toBe(false);
  });

  it('a disabled rule matches nothing', () => {
    expect(ruleMatches(rule({ enabled: false }), candidate())).toBe(false);
  });

  it('covers every synthetic detector kind', () => {
    expect([...SYNTHETIC_KINDS]).toEqual(['synthetic_down', 'synthetic_slow', 'cert_expiring']);
  });
});

describe('§15.2 — one problem is one alert', () => {
  it('keys on the rule and the subject, so two rules may both alert and one rule may not twice', () => {
    expect(dedupeKeyFor('r1', 'prod/web')).toBe('r1|prod/web');
    expect(dedupeKeyFor('r2', 'prod/web')).not.toBe(dedupeKeyFor('r1', 'prod/web'));
  });

  it('opens when there is nothing open', () => {
    expect(decide(rule(), candidate(), null, NOW)).toMatchObject({ action: 'open' });
  });

  it('opens again once a previous one resolved', () => {
    const resolved = { dedupeKey: 'r1|prod/web', lastFiredAt: NOW - 10 * MINUTE, status: 'resolved' as const };
    expect(decide(rule(), candidate(), resolved, NOW)).toMatchObject({ action: 'open' });
  });

  it('THE RULING: a fire inside the cooldown is suppressed, and the suppression is recorded', () => {
    // A tool that sends forty messages about one outage is a tool whose messages get filtered — and then
    // the one that mattered is filtered too.
    const firing = { dedupeKey: 'r1|prod/web', lastFiredAt: NOW - 5 * MINUTE, status: 'firing' as const };
    expect(decide(rule(), candidate(), firing, NOW)).toMatchObject({ action: 'suppress', reason: 'cooldown' });
  });

  it('fires again once the cooldown has passed', () => {
    const firing = { dedupeKey: 'r1|prod/web', lastFiredAt: NOW - 31 * MINUTE, status: 'firing' as const };
    expect(decide(rule(), candidate(), firing, NOW)).toMatchObject({ action: 'refire' });
    expect(DEFAULT_COOLDOWN_SECONDS).toBe(1800);
  });

  it('THE RULING: acknowledging means stop telling me, whatever the cooldown says', () => {
    const acked = { dedupeKey: 'r1|prod/web', lastFiredAt: NOW - 10 * 60 * MINUTE, status: 'acknowledged' as const };
    // Long past any cooldown, and still quiet: a tool that keeps telling them has made the
    // acknowledgement meaningless.
    expect(decide(rule(), candidate(), acked, NOW)).toMatchObject({ action: 'suppress', reason: 'acknowledged' });
  });
});

describe('§15.1 — the rules an installation starts with', () => {
  it('THE RULING: every one is in-app, so installing OpsWatch surprises nobody’s inbox', () => {
    expect(INSTALL_RULES.length).toBeGreaterThan(0);
    // There is no other channel to choose, which is how the promise is kept rather than remembered.
    for (const installed of INSTALL_RULES) {
      expect(['problem', 'synthetic', 'slo', 'machine']).toContain(installed.condition);
      expect(installed.name).toBeTruthy();
    }
  });

  it('covers critical problems and the two synthetic cases §15 names', () => {
    const names = INSTALL_RULES.map((installed) => installed.name);
    expect(names).toEqual(['critical_problems', 'synthetic_down', 'certificate_expiring', 'slo_burn', 'machine_critical']);
  });

  it('each one would actually match something', () => {
    const cases: Candidate[] = [
      candidate({ kind: 'ecs_cpu_high', severity: 'critical' }),
      candidate({ kind: 'synthetic_down', severity: 'critical' }),
      candidate({ kind: 'cert_expiring', severity: 'warning' }),
      candidate({ kind: 'slo_burn_slow', severity: 'warning' }),
      candidate({ kind: 'disk_full', severity: 'critical' }),
    ];
    for (const [index, installed] of INSTALL_RULES.entries()) {
      const asRule = rule({ id: `install-${index}`, condition: installed.condition, minSeverity: installed.minSeverity, kinds: installed.kinds });
      expect(ruleMatches(asRule, cases[index]), installed.name).toBe(true);
    }
  });
});
