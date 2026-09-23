import { describe, expect, it } from 'vitest';
import {
  DISMISSAL_SUPPRESSION_MS,
  INCIDENT_WINDOW_MS,
  SUSTAINED_MS,
  incidentCandidates,
  suppressedUntil,
  type CandidateProblem,
  type IncidentReason,
} from '@/lib/detect/incident';
import en from '../../messages/en.json';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const MINUTE = 60_000;
const clean = { suppressedUntil: new Map<string, number>(), existing: new Set<string>() };

const problem = (over: Partial<CandidateProblem> = {}): CandidateProblem => ({
  id: 'p1',
  serviceId: 'prod/web',
  severity: 'critical',
  firstSeenAt: NOW - MINUTE,
  userFacing: 1,
  ...over,
});

describe('§16, first trigger — two critical problems close together', () => {
  it('raises one incident linking both', () => {
    const [candidate] = incidentCandidates([problem({ id: 'a' }), problem({ id: 'b', firstSeenAt: NOW - 5 * MINUTE })], NOW, clean);
    expect(candidate).toMatchObject({ serviceId: 'prod/web', reason: 'multiple_critical', severity: 'critical' });
    expect(candidate?.problemIds.sort()).toEqual(['a', 'b']);
    // The incident starts when the first of them did, not when the rule noticed.
    expect(candidate?.startedAt).toBe(NOW - 5 * MINUTE);
  });

  it('does not fire for one problem alone', () => {
    expect(incidentCandidates([problem({ id: 'a', userFacing: null })], NOW, clean)).toEqual([]);
  });

  it('does not join two problems further apart than the window', () => {
    const far = [problem({ id: 'a' }), problem({ id: 'b', firstSeenAt: NOW - 20 * MINUTE, userFacing: null })];
    expect(incidentCandidates(far, NOW, clean)).toEqual([]);
    expect(INCIDENT_WINDOW_MS).toBe(15 * MINUTE);
  });

  it('THE RULING: warnings are not an incident, however many there are', () => {
    // An incident raised for every transient blip trains everybody to ignore the word.
    const warnings = [problem({ id: 'a', severity: 'warning' }), problem({ id: 'b', severity: 'warning' })];
    expect(incidentCandidates(warnings, NOW, clean)).toEqual([]);
  });

  it('keeps services apart, so one problem each on two services is not an incident', () => {
    const spread = [problem({ id: 'a', userFacing: null }), problem({ id: 'b', serviceId: 'prod/api', userFacing: null })];
    expect(incidentCandidates(spread, NOW, clean)).toEqual([]);
  });

  it('ignores a problem with no service, since §16 describes no other kind of incident', () => {
    const orphan = [problem({ id: 'a', serviceId: null }), problem({ id: 'b', serviceId: null })];
    expect(incidentCandidates(orphan, NOW, clean)).toEqual([]);
  });
});

describe('§16, second trigger — one critical problem that will not go away', () => {
  it('fires once it has lasted longer than the window, on a user-facing service', () => {
    const [candidate] = incidentCandidates([problem({ id: 'a', firstSeenAt: NOW - 20 * MINUTE })], NOW, clean);
    expect(candidate).toMatchObject({ reason: 'sustained_critical', problemIds: ['a'] });
    expect(SUSTAINED_MS).toBe(15 * MINUTE);
  });

  it('does not fire before the window has passed', () => {
    expect(incidentCandidates([problem({ id: 'a', firstSeenAt: NOW - 14 * MINUTE })], NOW, clean)).toEqual([]);
  });

  it('THE RULING: an unmeasured user-facing term is not treated as user-facing', () => {
    // §33.7 leaves `u` out rather than zero-filling it, so null means nobody looked. Raising an incident on
    // an unmeasured assumption is exactly the noise that makes the word stop meaning anything.
    expect(incidentCandidates([problem({ id: 'a', firstSeenAt: NOW - 20 * MINUTE, userFacing: null })], NOW, clean)).toEqual([]);
  });

  it('does not fire on a service measured as not user-facing', () => {
    expect(incidentCandidates([problem({ id: 'a', firstSeenAt: NOW - 20 * MINUTE, userFacing: 0 })], NOW, clean)).toEqual([]);
  });
});

describe('§16 — dismissal means something', () => {
  it('THE RULING: a dismissed service is left alone for two hours', () => {
    const state = { suppressedUntil: new Map([['prod/web', NOW + 60 * MINUTE]]), existing: new Set<string>() };
    expect(incidentCandidates([problem({ id: 'a' }), problem({ id: 'b' })], NOW, state)).toEqual([]);
    expect(DISMISSAL_SUPPRESSION_MS).toBe(2 * 60 * MINUTE);
    expect(suppressedUntil(NOW)).toBe(NOW + DISMISSAL_SUPPRESSION_MS);
  });

  it('resumes once the suppression has expired', () => {
    const state = { suppressedUntil: new Map([['prod/web', NOW - MINUTE]]), existing: new Set<string>() };
    expect(incidentCandidates([problem({ id: 'a' }), problem({ id: 'b' })], NOW, state)).toHaveLength(1);
  });

  it('THE RULING: a service with an open incident does not get a second one', () => {
    const state = { suppressedUntil: new Map<string, number>(), existing: new Set(['prod/web']) };
    expect(incidentCandidates([problem({ id: 'a' }), problem({ id: 'b' })], NOW, state)).toEqual([]);
  });
});

describe('every reason has a sentence in both languages', () => {
  it('THE RULING: a reason with no message would title an incident with a bare key', () => {
    const reasons: IncidentReason[] = ['multiple_critical', 'sustained_critical'];
    for (const reason of reasons) {
      expect(Object.keys(en.Incidents.title)).toContain(reason);
      expect(Object.keys(en.Incidents.opened)).toContain(reason);
    }
  });

  it('only produces reasons that have one', () => {
    const produced = new Set(
      [
        ...incidentCandidates([problem({ id: 'a' }), problem({ id: 'b' })], NOW, clean),
        ...incidentCandidates([problem({ id: 'c', firstSeenAt: NOW - 30 * MINUTE })], NOW, clean),
      ].map((candidate) => candidate.reason),
    );
    expect([...produced].sort()).toEqual(['multiple_critical', 'sustained_critical']);
  });
});

describe('ordering', () => {
  it('is stable across two identical evaluations', () => {
    const many = [
      problem({ id: 'a', serviceId: 'prod/z' }),
      problem({ id: 'b', serviceId: 'prod/z' }),
      problem({ id: 'c', serviceId: 'prod/a' }),
      problem({ id: 'd', serviceId: 'prod/a' }),
    ];
    const first = incidentCandidates(many, NOW, clean).map((one) => one.serviceId);
    expect(first).toEqual(['prod/a', 'prod/z']);
    expect(incidentCandidates(many, NOW, clean).map((one) => one.serviceId)).toEqual(first);
  });
});
