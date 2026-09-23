import { describe, expect, it } from 'vitest';
import { durationSince, familyOf, headlineKey, HEADLINE_KINDS } from '@/lib/monitoring/shared/duration';

/**
 * How long, and what kind of thing — the two facts a problem list has to convey at a glance.
 *
 * Both exist because the raw truth was unreadable: "for 1,643 minutes" is exact and useless, and
 * `alb_elb_5xx_count` is a detector id being asked to do a noun's job.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

describe('how long it has been going on', () => {
  it('THE RULING: keeps minutes where minutes are the decision, and stops there', () => {
    // "for 40 minutes" and "for 2 hours" are different decisions; rounding the first away loses that.
    expect(durationSince(NOW - 40 * MINUTE, NOW)).toEqual({ unit: 'minutes', value: 40 });
    expect(durationSince(NOW - 119 * MINUTE, NOW)).toEqual({ unit: 'minutes', value: 119 });
    // Past two hours nobody counts minutes, and the real product showed "for 1,643 minutes".
    expect(durationSince(NOW - 1643 * MINUTE, NOW)).toEqual({ unit: 'hours', value: 27 });
    expect(durationSince(NOW - 5 * DAY, NOW)).toEqual({ unit: 'days', value: 5 });
  });

  it('never reports zero, because a problem that exists has lasted some time', () => {
    expect(durationSince(NOW, NOW)).toEqual({ unit: 'minutes', value: 1 });
    // A clock that has drifted backwards is not a negative duration.
    expect(durationSince(NOW + 5 * MINUTE, NOW)).toEqual({ unit: 'minutes', value: 1 });
  });
});

describe('what kind of thing it is about', () => {
  it('THE RULING: names the resource, not the detector', () => {
    expect(familyOf('alb_elb_5xx_count')).toBe('alb');
    expect(familyOf('ecs_cpu_high')).toBe('ecs');
    expect(familyOf('aurora_replica_lag')).toBe('rds');
    expect(familyOf('cert_expiring')).toBe('synthetic');
    expect(familyOf('slo_burn_fast')).toBe('slo');
    expect(familyOf('error_group_spike')).toBe('error');
  });

  it('falls back rather than inventing a family for a kind it does not know', () => {
    expect(familyOf('something_new')).toBe('other');
  });
});

describe('the headline for a kind', () => {
  it('THE RULING: one list, so the summary and the detail cannot disagree', () => {
    for (const kind of HEADLINE_KINDS) expect(headlineKey(kind)).toBe(kind);
    // A detector shipped tomorrow reads as the generic headline rather than as its own id.
    expect(headlineKey('something_new')).toBe('unknown');
  });
});
