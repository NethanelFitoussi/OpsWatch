import { describe, expect, it } from 'vitest';
import {
  CRITICAL_SCORE,
  FRESH_SUBJECT_MS,
  LEVEL_S,
  NO_FAMILY_B,
  SCORE_WEIGHTS,
  WARNING_SCORE,
  scoreProblem,
  severityForScore,
  type DetectorLevel,
  type ScoreInput,
  type UserFacing,
} from '@/lib/detect/score';

const NOW = Date.UTC(2026, 8, 19, 9, 0, 0);
const HOUR = 60 * 60_000;

/** An established subject: first seen long ago, so nothing is excused by freshness. */
const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  level: 'critical',
  blast: { affected: 1, members: 1 },
  minutesBreaching: 60,
  userFacing: 'direct',
  robustZ: null,
  subjectFirstSeenAt: NOW - 30 * 24 * HOUR,
  nowMs: NOW,
  ...over,
});

describe('the severity score', () => {
  it('keeps the weights in one place, summing to 100', () => {
    // Changing a weight is meant to be a one-line change plus a fixture update, which only works if they live
    // here and nowhere else.
    expect(SCORE_WEIGHTS).toEqual({ s: 40, b: 20, t: 15, u: 15, d: 10 });
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(LEVEL_S).toEqual({ critical: 1, warning: 0.55, info: 0.2 });
  });

  it('scores a sustained critical on a wholly-broken user-facing service at 90', () => {
    // S=1, B=1, T=1, U=1, D=0 -> 40 + 20 + 15 + 15 + 0 = 90. No baseline, so D is zero-filled, not dropped.
    const terms = scoreProblem(input());
    expect({ s: terms.s, b: terms.b, t: terms.t, u: terms.u, d: terms.d }).toEqual({ s: 1, b: 1, t: 1, u: 1, d: 0 });
    expect(terms.score).toBe(90);
    expect(terms.availableWeight).toBe(100);
    expect(terms.rescaled).toBe(false);
    expect(severityForScore(terms.score)).toBe('critical');
  });

  it('scores an info detector on a small, brief, unexposed problem at 11', () => {
    const terms = scoreProblem(
      input({ level: 'info', blast: { affected: 1, members: 10 }, minutesBreaching: 3, userFacing: 'none' }),
    );
    // 40(0.2) + 20(0.1) + 15(0.05) + 15(0) + 10(0) = 8 + 2 + 0.75 = 10.75 -> 11
    expect(terms.score).toBe(11);
    expect(severityForScore(terms.score)).toBe('info');
  });

  it('gives a subject with no family the stated default rather than a zero', () => {
    const terms = scoreProblem(input({ blast: null }));
    expect(terms.b).toBe(NO_FAMILY_B);
    expect(terms.rescaled).toBe(false);
  });

  it('halves the user-facing term for a dependency of a user-facing service', () => {
    expect(scoreProblem(input({ userFacing: 'dependency' })).u).toBe(0.5);
    expect(scoreProblem(input({ userFacing: 'none' })).u).toBe(0);
  });

  it('reads deviation from the robust z-score, and zero-fills it when there is no baseline', () => {
    expect(scoreProblem(input({ robustZ: 6 })).d).toBe(1);
    expect(scoreProblem(input({ robustZ: -6 })).d).toBe(1);
    expect(scoreProblem(input({ robustZ: 3 })).d).toBe(0.5);
    expect(scoreProblem(input({ robustZ: 12 })).d).toBe(1);
    expect(scoreProblem(input({ robustZ: null })).d).toBe(0);
  });

  it('caps persistence at one hour', () => {
    expect(scoreProblem(input({ minutesBreaching: 30 })).t).toBe(0.5);
    expect(scoreProblem(input({ minutesBreaching: 600 })).t).toBe(1);
    expect(scoreProblem(input({ minutesBreaching: 0 })).t).toBe(0);
  });
});

describe('§33.7 — a fresh subject is judged on what can be measured', () => {
  /** The regression §33.7 was written for: user-facing service failing 5 minutes after its first deploy. */
  const freshlyDeployed = (over: Partial<ScoreInput> = {}): ScoreInput =>
    input({
      level: 'critical',
      blast: null,
      minutesBreaching: 5,
      userFacing: null,
      robustZ: null,
      subjectFirstSeenAt: NOW - 5 * 60_000,
      ...over,
    });

  it('does not zero-fill U and B for a subject with no dependency edge seen minutes ago', () => {
    const terms = scoreProblem(freshlyDeployed());
    expect({ b: terms.b, u: terms.u }).toEqual({ b: null, u: null });
    expect(terms.rescaled).toBe(true);
    // Only S, T and D are known: 40 + 15 + 10 = 65.
    expect(terms.availableWeight).toBe(SCORE_WEIGHTS.s + SCORE_WEIGHTS.t + SCORE_WEIGHTS.d);
  });

  it('scores it far above the 51 that the zero-filled formula produced', () => {
    const terms = scoreProblem(freshlyDeployed());
    // (40(1) + 15(0.083) + 10(0)) / 65 * 100 = 63. Governed by what we could measure, not by what we could not.
    expect(terms.score).toBe(63);
    // The finding in §33.7 was that this case scored 51 and read as a warning. It still reads as a warning
    // here - the floor below is what makes it critical - but it is no longer *punished* for being new.
    expect(terms.score).toBeGreaterThan(51);
  });

  it('stops excusing the subject once it is two hours old', () => {
    const established = scoreProblem(freshlyDeployed({ subjectFirstSeenAt: NOW - FRESH_SUBJECT_MS - 1 }));
    expect({ b: established.b, u: established.u }).toEqual({ b: NO_FAMILY_B, u: 0 });
    expect(established.rescaled).toBe(false);
  });

  it('does not excuse a fresh subject whose dependency edge is actually known', () => {
    // Freshness is not the trigger on its own: §33.7 requires *no dependency edge* as well.
    const terms = scoreProblem(freshlyDeployed({ userFacing: 'direct' }));
    expect(terms.rescaled).toBe(false);
    expect(terms.u).toBe(1);
    expect(terms.b).toBe(NO_FAMILY_B);
  });
});

describe('§33.7 — floors', () => {
  it('floors a total failure at critical however the formula scores it', () => {
    const terms = scoreProblem(
      input({ level: 'critical', blast: null, minutesBreaching: 1, userFacing: null, subjectFirstSeenAt: NOW, totalFailure: true }),
    );
    expect(terms.score).toBeGreaterThanOrEqual(CRITICAL_SCORE);
    expect(terms.floored).toBe(true);
    expect(severityForScore(terms.score)).toBe('critical');
  });

  it('floors the three declared cases — zero healthy targets, a synthetic down, a certificate under seven days', () => {
    for (const level of ['critical', 'warning', 'info'] as const) {
      const terms = scoreProblem(input({ level, minutesBreaching: 0, blast: null, userFacing: 'none', floorCritical: true }));
      expect(terms.score, level).toBeGreaterThanOrEqual(CRITICAL_SCORE);
      expect(terms.floored, level).toBe(true);
    }
  });

  it('does not mark a score floored when the formula already cleared the floor', () => {
    const terms = scoreProblem(input({ floorCritical: true }));
    expect(terms.score).toBe(90);
    expect(terms.floored).toBe(false);
  });

  it('never exceeds 100 or falls below 0', () => {
    const highest = scoreProblem(input({ robustZ: 100, blast: { affected: 10, members: 1 }, minutesBreaching: 10_000 }));
    expect(highest.score).toBeLessThanOrEqual(100);
    const lowest = scoreProblem(
      input({ level: 'info', blast: { affected: 0, members: 10 }, minutesBreaching: 0, userFacing: 'none' }),
    );
    expect(lowest.score).toBeGreaterThanOrEqual(0);
  });
});

describe('the severity label', () => {
  it('is derived from the score at the stated boundaries', () => {
    expect(severityForScore(CRITICAL_SCORE)).toBe('critical');
    expect(severityForScore(CRITICAL_SCORE - 1)).toBe('warning');
    expect(severityForScore(WARNING_SCORE)).toBe('warning');
    expect(severityForScore(WARNING_SCORE - 1)).toBe('info');
    expect(severityForScore(0)).toBe('info');
    expect(severityForScore(100)).toBe('critical');
  });

  it('stores the arithmetic the page renders under "Why this score"', () => {
    const terms = scoreProblem(input());
    // Everything the disclosure needs is in the stored terms, so the page never recomputes and never disagrees.
    expect(Object.keys(terms).sort()).toEqual(
      ['availableWeight', 'b', 'd', 'floored', 'rescaled', 's', 'score', 't', 'u', 'weights'].sort(),
    );
    expect(terms.weights).toEqual(SCORE_WEIGHTS);
  });
});

describe('every value of every enum is scored, not just the ones a detector happens to use', () => {
  const LEVELS: DetectorLevel[] = ['critical', 'warning', 'info'];
  const EXPOSURES: UserFacing[] = ['direct', 'dependency', 'none', null];

  it.each(LEVELS)('scores level %s, descending with the detector\'s own confidence', (level) => {
    const terms = scoreProblem(input({ level }));
    expect(terms.s).toBe(LEVEL_S[level]);
    expect(terms.score).toBeGreaterThanOrEqual(0);
  });

  it('orders the three levels strictly, all else equal', () => {
    const [critical, warning, info] = LEVELS.map((level) => scoreProblem(input({ level })).score);
    expect(critical).toBeGreaterThan(warning);
    expect(warning).toBeGreaterThan(info);
  });

  it.each(EXPOSURES)('handles exposure %s without inventing a number', (userFacing) => {
    // `null` is unknown, not "not exposed"; on an established subject it must still not be excused.
    const terms = scoreProblem(input({ userFacing }));
    expect(terms.u).toBe(userFacing === null ? 0 : { direct: 1, dependency: 0.5, none: 0 }[userFacing]);
  });

  it('never lets an unknown exposure outrank a known one on an established subject', () => {
    expect(scoreProblem(input({ userFacing: null })).score).toBeLessThanOrEqual(
      scoreProblem(input({ userFacing: 'direct' })).score,
    );
  });
});
