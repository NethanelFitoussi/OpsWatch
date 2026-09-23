import { describe, expect, it } from 'vitest';
import { ALB_5XX_RATE_LEVELS, ALB_ELB_5XX_COUNT } from '@/lib/monitoring/insights';
import { causesFor, checksFor, impactFor, recoveryFor, ruleFor } from '@/lib/detect/explain';
import { HEADLINE_KINDS } from '@/lib/monitoring/shared/duration';

/**
 * Why OpsWatch opened a problem, and what it will and will not claim about it.
 *
 * Every ruling here is a refusal. The product's credibility rests on a reader being able to tell a
 * measurement from a guess, and this is the file where that distinction is either kept or lost.
 */

describe('the rule behind a problem', () => {
  it('quotes the constant the detector actually used, so the two cannot drift apart', () => {
    expect(ruleFor('alb_elb_5xx_count', { count: 23 }, 'warning')).toEqual({
      kind: 'threshold',
      observed: 23,
      threshold: ALB_ELB_5XX_COUNT.warning,
      clearAt: null,
      unit: 'count',
    });
    expect(ruleFor('alb_elb_5xx_count', { count: 140 }, 'critical')).toMatchObject({ threshold: ALB_ELB_5XX_COUNT.critical });
  });

  it('carries the clearing margin where the rule has one, because it is not the number it crossed', () => {
    const rule = ruleFor('alb_5xx_rate', { rate: 6.1 }, 'critical');
    expect(rule).toMatchObject({ kind: 'threshold', threshold: ALB_5XX_RATE_LEVELS.critical.threshold, unit: 'percent' });
    expect(recoveryFor(rule)).toEqual({ clearAt: ALB_5XX_RATE_LEVELS.critical.clearAt, unit: 'percent' });
  });

  it('THE RULING: a presence rule has no threshold to quote, and does not invent one', () => {
    // "Any unhealthy host at all" is not `> 0` arithmetic, and rendering it as a threshold would read as
    // a number somebody chose.
    expect(ruleFor('alb_unhealthy_hosts', { count: 2 }, 'warning')).toEqual({ kind: 'presence', observed: 2, unit: 'count' });
    expect(recoveryFor(ruleFor('alb_unhealthy_hosts', { count: 2 }, 'warning'))).toBeNull();
  });

  it('THE RULING: a state AWS reported is not dressed as a measurement OpsWatch took', () => {
    expect(ruleFor('alarm_firing', { alarm: 'x' }, 'critical')).toEqual({ kind: 'state', unit: 'count' });
    expect(ruleFor('ecs_rollout_failed', { service: 'web' }, 'critical')?.kind).toBe('state');
  });

  it('answers null rather than guessing, for a kind with no numeric rule and for missing values', () => {
    expect(ruleFor('something_new', { count: 1 }, 'warning')).toBeNull();
    expect(ruleFor('alb_elb_5xx_count', {}, 'warning')).toBeNull();
    expect(ruleFor('alb_5xx_rate', { rate: 'lots' }, 'warning')).toBeNull();
  });
});

describe('what can be said about the damage', () => {
  it('THE RULING: a count with no denominator establishes nothing about users', () => {
    // The real problem this was written for: `alb-gigs-prod itself returned 23 5xx errors`.
    const impact = impactFor('alb_elb_5xx_count', { count: 23 }, { b: 0.34, u: null });
    expect(impact.errors).toBe(23);
    expect(impact.requests).toBeNull();
    expect(impact.established).toBe(false);
  });

  it('establishes a share only when both halves were measured', () => {
    const impact = impactFor('alb_5xx_rate', { errors: 5971, requests: 345513 }, { b: 0.34, u: null });
    expect(impact.established).toBe(true);
    expect(impact.errors).toBe(5971);
    expect(impact.requests).toBe(345513);
  });

  it('THE RULING: zero requests is not a share, it is nothing to divide by', () => {
    expect(impactFor('alb_5xx_rate', { errors: 0, requests: 0 }, { b: null, u: null }).established).toBe(false);
  });

  it('THE RULING: an unknown blast stays null, so an absence is not rendered as a reassurance', () => {
    // §33.7: a term that is unknown is left out, never zero-filled. Rendering both as "0%" would tell a
    // reader that nothing is affected when the truth is that nobody measured.
    expect(impactFor('alb_elb_5xx_count', { count: 1 }, { b: null, u: null }).blastShare).toBeNull();
    expect(impactFor('alb_elb_5xx_count', { count: 1 }, { b: 0, u: null }).blastShare).toBe(0);
  });

  it('says whether the dependency map could speak, which today it cannot', () => {
    expect(impactFor('alb_elb_5xx_count', { count: 1 }, { b: 0.5, u: null }).userFacingKnown).toBe(false);
    expect(impactFor('alb_elb_5xx_count', { count: 1 }, { b: 0.5, u: 1 }).userFacingKnown).toBe(true);
  });
});

describe('what to check', () => {
  const base = { kind: 'alb_5xx_rate', values: {}, deployments: [], errorGroups: [], unhealthyTargets: null, subjectHref: '/lb' };

  it('THE RULING: with no evidence it suggests nothing, rather than a plausible checklist', () => {
    // A list that always says the same three things is a list operators learn to scroll past.
    expect(checksFor(base)).toEqual([]);
  });

  it('orders by how directly the evidence points', () => {
    const checks = checksFor({
      ...base,
      unhealthyTargets: 2,
      deployments: [{ id: 'd1', label: 'web:42', minutesBefore: 8, href: '/d1', filesChanged: 12, changesHref: '/d1' }],
      errorGroups: [{ id: 'e1', message: 'boom', href: '/e1' }],
    });
    // Unhealthy targets explain 5xx that never reached an application, so they come before "read the logs".
    expect(checks.map((one) => one.id)).toEqual(['targets', 'deployment', 'changes', 'errors']);
  });

  it('THE RULING: every suggestion carries the evidence that produced it', () => {
    const checks = checksFor({
      ...base,
      deployments: [{ id: 'd1', label: 'web:42', minutesBefore: 8, href: '/d1', filesChanged: null, changesHref: null }],
    });
    expect(checks[0]).toMatchObject({ id: 'deployment', reasonKey: 'deploymentBefore', reasonValues: { minutes: 8, version: 'web:42' } });
    // Commits never fetched: "0 files changed" would read as "nothing changed".
    expect(checks.map((one) => one.id)).not.toContain('changes');
  });

  it('THE RULING: it tells an operator what an ELB-generated 5xx rules out', () => {
    const checks = checksFor({ ...base, kind: 'alb_elb_5xx_count', values: { count: 23 } });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ id: 'elbItself', reasonKey: 'elbGenerated', reasonValues: { count: 23 } });
    // And the same fact is not volunteered for a rate problem, where it would not be true.
    expect(checksFor({ ...base, kind: 'alb_5xx_rate' }).map((one) => one.id)).not.toContain('elbItself');
  });

  it('never claims a cause: the deployment reason states a gap', () => {
    const checks = checksFor({
      ...base,
      deployments: [{ id: 'd1', label: 'web:42', minutesBefore: 8, href: '/d1', filesChanged: 3, changesHref: '/d1' }],
    });
    expect(JSON.stringify(checks)).not.toMatch(/caused|because|root cause/i);
  });
});

describe('every family can say why it fired (UX-17)', () => {
  it('THE RULING: each detector kind with a headline has a rule, so no family is left mute', () => {
    // A synthetic failure, an expiring certificate and a burning objective are problems like any other.
    // Leaving them without a rule left their pages saying only "a problem is open", which is the sentence
    // this whole file exists to replace.
    const VALUES: Record<string, Record<string, unknown>> = {
      alb_5xx_rate: { rate: 6 },
      alb_elb_5xx_count: { count: 23 },
      alb_unhealthy_hosts: { count: 2 },
      ecs_cpu_high: { value: 91 },
      ecs_memory_high: { value: 91 },
      ecs_tasks_below_desired: { running: 1, desired: 3 },
      ecs_rollout_failed: {},
      ecs_rollout_stuck: {},
      rds_cpu_high: { value: 95 },
      rds_freeable_memory_low: { value: 4 },
      aurora_replica_lag: { lagging: 4000 },
      alarm_firing: {},
      synthetic_down: {},
      synthetic_slow: { median: 2400, threshold: 1500 },
      cert_expiring: { days: 5 },
      slo_burn_fast: { rate: 14.2, hours: 1 },
      slo_burn_slow: { rate: 2.1, hours: 24 },
      error_group_new: { count: 12 },
      error_group_spike: { count: 90, baseline: 4 },
    };
    for (const [kind, values] of Object.entries(VALUES)) {
      expect(ruleFor(kind, values, 'warning'), kind).not.toBeNull();
    }
  });

  it('reads a synthetic check against its own threshold, not a constant of ours', () => {
    expect(ruleFor('synthetic_slow', { median: 2400, threshold: 1500 }, 'warning')).toEqual({
      kind: 'threshold',
      observed: 2400,
      threshold: 1500,
      clearAt: null,
      unit: 'ms',
    });
  });

  it('quotes the spike bar the detector used, rather than either half of it', () => {
    // max(10, 3 × baseline): with a baseline of 4 the bar is 12, and with a baseline of 1 it is 10.
    expect(ruleFor('error_group_spike', { count: 90, baseline: 4 }, 'critical')).toMatchObject({ threshold: 12 });
    expect(ruleFor('error_group_spike', { count: 90, baseline: 1 }, 'critical')).toMatchObject({ threshold: 10 });
  });

  it('calls a brand-new error a presence, because "never seen before" has no threshold', () => {
    expect(ruleFor('error_group_new', { count: 12 }, 'warning')).toEqual({ kind: 'presence', observed: 12, unit: 'count' });
  });

  it('calls a failing check a state: nobody measured it against a number', () => {
    expect(ruleFor('synthetic_down', {}, 'critical')).toEqual({ kind: 'state', unit: 'count' });
  });

  it('says nothing rather than guessing when the value it needs is missing', () => {
    expect(ruleFor('cert_expiring', {}, 'warning')).toBeNull();
    expect(ruleFor('synthetic_slow', { median: 2400 }, 'warning')).toBeNull();
    expect(ruleFor('error_group_spike', { count: 90 }, 'critical')).toBeNull();
    expect(ruleFor('slo_burn_fast', {}, 'critical')).toBeNull();
  });
});

describe('possible causes are possibilities (UX-17)', () => {
  it('THE RULING: they never look at the values, so they cannot become a claim about this problem', () => {
    // Identical for a 91% and a 99% CPU problem: nothing here is derived from what was measured.
    expect(causesFor('ecs_cpu_high')).toEqual(causesFor('ecs_cpu_high'));
    expect(causesFor('ecs_cpu_high').length).toBeGreaterThan(0);
  });

  it('THE RULING: a CloudWatch alarm gets none, because the rule is not ours to explain', () => {
    expect(causesFor('alarm_firing')).toEqual([]);
  });

  it('THE RULING: every other family a page can headline has some, so none is left with only a number', () => {
    for (const kind of HEADLINE_KINDS) {
      if (kind === 'alarm_firing') continue;
      expect(causesFor(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('gives a different list to a different family, rather than one list for everything', () => {
    expect(causesFor('rds_freeable_memory_low')).not.toEqual(causesFor('alb_5xx_rate'));
  });

  it('says nothing for a kind it does not know', () => {
    expect(causesFor('something_new')).toEqual([]);
  });
});
