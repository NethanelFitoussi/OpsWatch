import { describe, expect, it } from 'vitest';
import {
  SPIKE_MIN_OCCURRENCES,
  SPIKE_MULTIPLE,
  errorDetectors,
  errorGroupNew,
  errorGroupSpike,
  isSpiking,
  type ErrorGroupFacts,
} from '@/lib/detect/errors';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

const facts = (over: Partial<ErrorGroupFacts> = {}): ErrorGroupFacts => ({
  id: 'g1',
  fingerprint: 'f'.repeat(32),
  serviceId: 'prod/web',
  exceptionType: 'TypeError',
  sampleMessage: "Cannot read properties of undefined (reading 'id')",
  status: 'ongoing',
  firstSeenAt: NOW - 30 * 24 * 60 * 60_000,
  statusSince: NOW - 60 * 60_000,
  occurrences: 4,
  baseline: 2,
  href: '/c/c1/us-east-1/errors/g1',
  ...over,
});

describe('what counts as a spike (§4.4)', () => {
  it('needs both the multiple and the floor', () => {
    expect(SPIKE_MIN_OCCURRENCES).toBe(10);
    expect(SPIKE_MULTIPLE).toBe(3);
    // Three times a baseline of one is three occurrences, which is noise, not a spike.
    expect(isSpiking({ occurrences: 3, baseline: 1 })).toBe(false);
    expect(isSpiking({ occurrences: 10, baseline: 1 })).toBe(true);
  });

  it('scales with the baseline once the floor is passed', () => {
    expect(isSpiking({ occurrences: 29, baseline: 10 })).toBe(false);
    expect(isSpiking({ occurrences: 30, baseline: 10 })).toBe(true);
  });

  it('is FALSE with no baseline, not true', () => {
    // A group OpsWatch has not watched long enough to have a baseline for is evidence of a short history,
    // not of a spike. Calling it one would make every new installation look like it was on fire.
    expect(isSpiking({ occurrences: 1000, baseline: null })).toBe(false);
  });
});

describe('error_group_new', () => {
  it('fires for a group that has just appeared', () => {
    const problem = errorGroupNew(facts({ status: 'new' }), NOW);
    expect(problem?.kind).toBe('error_group_new');
    expect(problem?.titleKey).toBe('Errors.problem.new');
    expect(problem?.subject.type).toBe('error_group');
  });

  it('fires for a regression, because something that had stopped happening again is news', () => {
    expect(errorGroupNew(facts({ status: 'regressed' }), NOW)?.titleKey).toBe('Errors.problem.regressed');
  });

  it('does not fire for a group that has simply been there', () => {
    expect(errorGroupNew(facts({ status: 'ongoing' }), NOW)).toBeNull();
    expect(errorGroupNew(facts({ status: 'resolved' }), NOW)).toBeNull();
    expect(errorGroupNew(facts({ status: 'muted' }), NOW)).toBeNull();
  });

  it('is a warning at low volume and critical once the volume argues for it', () => {
    expect(errorGroupNew(facts({ status: 'new', occurrences: 2 }), NOW)?.level).toBe('warning');
    expect(errorGroupNew(facts({ status: 'new', occurrences: SPIKE_MIN_OCCURRENCES }), NOW)?.level).toBe('critical');
  });

  it('always carries evidence, and never invents a blast radius it cannot know', () => {
    const problem = errorGroupNew(facts({ status: 'new' }), NOW);
    expect(problem?.evidence.length).toBeGreaterThan(0);
    expect(problem?.evidence[0].value).toBe(4);
    // How many resources an error group affects is not knowable from the group alone.
    expect(problem?.blast).toBeNull();
    expect(problem?.userFacing).toBeNull();
  });
});

describe('error_group_spike', () => {
  it('fires when the rate jumps far above the group\'s own baseline', () => {
    const problem = errorGroupSpike(facts({ occurrences: 40, baseline: 10 }), NOW);
    expect(problem?.kind).toBe('error_group_spike');
    expect(problem?.level).toBe('critical');
    // Both numbers are in the evidence, so a reader can see the comparison that was made.
    expect(problem?.evidence.map((item) => item.value)).toEqual([40, 10]);
  });

  it('does not fire on a muted or resolved group', () => {
    expect(errorGroupSpike(facts({ occurrences: 40, baseline: 10, status: 'muted' }), NOW)).toBeNull();
    expect(errorGroupSpike(facts({ occurrences: 40, baseline: 10, status: 'resolved' }), NOW)).toBeNull();
  });

  it('does not fire without a baseline to compare against', () => {
    expect(errorGroupSpike(facts({ occurrences: 1000, baseline: null }), NOW)).toBeNull();
  });

  it('expresses the deviation as a multiple of the baseline, capped where the score caps it', () => {
    expect(errorGroupSpike(facts({ occurrences: 40, baseline: 10 }), NOW)?.robustZ).toBe(4);
    expect(errorGroupSpike(facts({ occurrences: 1000, baseline: 10 }), NOW)?.robustZ).toBe(6);
  });
});

describe('both detectors over one group', () => {
  it('reports a group that is both new and spiking twice, worst first', () => {
    const both = errorDetectors(facts({ status: 'new', occurrences: 40, baseline: 10 }), NOW);
    expect(both.map((problem) => problem.kind)).toEqual(['error_group_spike', 'error_group_new']);
  });

  it('reports nothing for an ordinary, steady group', () => {
    expect(errorDetectors(facts(), NOW)).toEqual([]);
  });
});
