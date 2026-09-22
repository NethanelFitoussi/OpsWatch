import { describe, expect, it } from 'vitest';
import {
  CLEAR_EVALUATIONS,
  CLEAR_MIN_MS,
  REOPEN_WINDOW_MS,
  STALE_AFTER_MS,
  applyCycle,
  isStale,
  type CycleInput,
  type LiveProblem,
  type Transition,
} from '@/lib/detect/lifecycle';
import { problemKey } from '@/lib/detect/key';
import type { SubjectOutcome, SubjectRef } from '@/lib/detect/types';
import { detected } from '../helpers/detect';

const NOW = Date.UTC(2026, 8, 19, 9, 0, 0);
const MINUTE = 60_000;
const CONNECTION = 'c1';
const SCOPE = 'us-east-1';
const KIND = 'ecs_cpu_high';
const SUBJECT_ID = 'prod/web';
const KEY = problemKey({ connectionId: CONNECTION, scope: SCOPE, kind: KIND, subjectId: SUBJECT_ID });

const subject: SubjectRef = { type: 'service', id: SUBJECT_ID, name: 'web', serviceId: SUBJECT_ID };

const fired: SubjectOutcome = {
  state: 'fired',
  kind: KIND,
  subject,
  problem: detected({ kind: KIND, subjectId: SUBJECT_ID }),
};
const cleared: SubjectOutcome = { state: 'clear', kind: KIND, subject };
const unevaluated: SubjectOutcome = { state: 'not_evaluated', kind: KIND, subject };

const liveProblem = (over: Partial<LiveProblem> = {}): LiveProblem => ({
  id: 'p1',
  key: KEY,
  status: 'open',
  firstSeenAt: NOW - 3 * 60 * MINUTE,
  lastSeenAt: NOW - MINUTE,
  lastEvaluatedAt: NOW - MINUTE,
  clearStreak: 0,
  clearSinceAt: null,
  occurrences: 4,
  flapCount: 0,
  resolvedAt: null,
  ...over,
});

const run = (over: Partial<CycleInput> & { outcomes: SubjectOutcome[]; nowMs?: number }): Transition[] =>
  applyCycle({
    connectionId: CONNECTION,
    scope: SCOPE,
    live: over.live ?? [],
    resolvedInWindow: over.resolvedInWindow ?? [],
    cycle: { at: over.nowMs ?? NOW, outcomes: over.outcomes, failed: [] },
    nowMs: over.nowMs ?? NOW,
  });

describe('a detector that fires', () => {
  it('opens a problem when nothing like it has been seen', () => {
    const [transition] = run({ outcomes: [fired] });
    expect(transition).toMatchObject({ type: 'open', key: KEY, at: NOW, previousProblemId: null });
  });

  it('touches the live row instead of opening a second one', () => {
    const [transition] = run({ outcomes: [fired], live: [liveProblem()] });
    expect(transition).toMatchObject({ type: 'touch', id: 'p1', at: NOW, resetClear: false });
  });

  it('resets a clear streak that had begun, because clearing has to be consecutive', () => {
    const [transition] = run({ outcomes: [fired], live: [liveProblem({ clearStreak: 2, clearSinceAt: NOW - 20 * MINUTE })] });
    expect(transition).toMatchObject({ type: 'touch', resetClear: true });
  });
});

describe('trouble that comes back', () => {
  const resolvedAt = (at: number) => liveProblem({ id: 'old', status: 'resolved', resolvedAt: at });

  it('reopens the same row inside the two-hour window, so the history survives', () => {
    const [transition] = run({ outcomes: [fired], resolvedInWindow: [resolvedAt(NOW - REOPEN_WINDOW_MS + MINUTE)] });
    // The same row: firstSeenAt, the occurrence count and any acknowledgement are kept. This is what stops a
    // flapping service producing forty rows a day.
    expect(transition).toMatchObject({ type: 'reopen', id: 'old', key: KEY });
  });

  it('reopens right up to the boundary, and supersedes one millisecond past it', () => {
    expect(run({ outcomes: [fired], resolvedInWindow: [resolvedAt(NOW - REOPEN_WINDOW_MS)] })[0]).toMatchObject({
      type: 'reopen',
    });
    expect(run({ outcomes: [fired], resolvedInWindow: [resolvedAt(NOW - REOPEN_WINDOW_MS - 1)] })[0]).toMatchObject({
      type: 'open',
      previousProblemId: 'old',
    });
  });

  it('carries previousProblemId so the new row knows what it succeeds', () => {
    const [transition] = run({ outcomes: [fired], resolvedInWindow: [resolvedAt(NOW - 5 * REOPEN_WINDOW_MS)] });
    expect(transition).toMatchObject({ type: 'open', previousProblemId: 'old' });
  });

  it('continues the most recently resolved row when the key has several', () => {
    const transitions = run({
      outcomes: [fired],
      resolvedInWindow: [
        { ...liveProblem({ id: 'older', status: 'resolved' }), resolvedAt: NOW - 90 * MINUTE },
        { ...liveProblem({ id: 'newer', status: 'resolved' }), resolvedAt: NOW - 10 * MINUTE },
      ],
    });
    expect(transitions[0]).toMatchObject({ type: 'reopen', id: 'newer' });
  });
});

describe('§33.5 — auto-resolve requires evaluated-and-clear, not silence', () => {
  it('advances the streak but does not resolve on the first clear cycle', () => {
    const [transition] = run({ outcomes: [cleared], live: [liveProblem()] });
    expect(transition).toMatchObject({ type: 'progress_clear', clearStreak: 1, clearSinceAt: NOW });
  });

  it('resolves only after three clear cycles AND fifteen minutes', () => {
    const almost = run({
      outcomes: [cleared],
      live: [liveProblem({ clearStreak: CLEAR_EVALUATIONS - 1, clearSinceAt: NOW - CLEAR_MIN_MS + 1 })],
    });
    // Three cycles, but they span less than fifteen minutes: not resolved.
    expect(almost[0]).toMatchObject({ type: 'progress_clear', clearStreak: CLEAR_EVALUATIONS });

    const done = run({
      outcomes: [cleared],
      live: [liveProblem({ clearStreak: CLEAR_EVALUATIONS - 1, clearSinceAt: NOW - CLEAR_MIN_MS })],
    });
    expect(done[0]).toMatchObject({ type: 'resolve', id: 'p1', at: NOW });
  });

  it('does not resolve on fifteen minutes alone, with too few cycles', () => {
    const [transition] = run({ outcomes: [cleared], live: [liveProblem({ clearStreak: 1, clearSinceAt: NOW - 10 * CLEAR_MIN_MS })] });
    expect(transition).toMatchObject({ type: 'progress_clear', clearStreak: 2 });
  });

  it('THE REGRESSION: a subject a capped cycle never reached resolves nothing, however many cycles pass', () => {
    // This is the failure §33.5 was written for. Before the ruling, three silent cycles closed the problem
    // although the condition never cleared.
    let live = liveProblem();
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const transitions = run({ outcomes: [unevaluated], live: [live], nowMs: NOW + cycle * 5 * MINUTE });
      expect(transitions).toEqual([]);
      // Nothing moved: not the streak, not lastEvaluatedAt. There is no transition to apply.
      live = { ...live };
    }
  });

  it('does not let a not-evaluated cycle reset a clear streak either', () => {
    const live = liveProblem({ clearStreak: 2, clearSinceAt: NOW - 20 * MINUTE });
    expect(run({ outcomes: [unevaluated], live: [live] })).toEqual([]);
    // The streak is untouched, so the next genuine clear cycle still resolves.
    expect(run({ outcomes: [cleared], live: [live], nowMs: NOW + MINUTE })[0]).toMatchObject({ type: 'resolve' });
  });

  it('ignores a clear outcome for a problem that is not live', () => {
    expect(run({ outcomes: [cleared] })).toEqual([]);
  });
});

describe('staleness', () => {
  it('reports a subject nobody has evaluated for an hour as stale, and never resolves it', () => {
    const neglected = liveProblem({ lastEvaluatedAt: NOW - STALE_AFTER_MS - 1 });
    expect(isStale(neglected, NOW)).toBe(true);
    // Stale is a thing the interface says, not a thing the lifecycle does: no transition is produced.
    expect(run({ outcomes: [unevaluated], live: [neglected] })).toEqual([]);
  });

  it('is not stale while it is still being evaluated', () => {
    expect(isStale(liveProblem({ lastEvaluatedAt: NOW - STALE_AFTER_MS }), NOW)).toBe(false);
    expect(isStale(liveProblem(), NOW)).toBe(false);
  });
});

describe('acknowledgement silences, it does not freeze', () => {
  it('keeps evaluating an acknowledged problem and resolves it when it clears', () => {
    const acknowledged = liveProblem({
      status: 'acknowledged',
      clearStreak: CLEAR_EVALUATIONS - 1,
      clearSinceAt: NOW - CLEAR_MIN_MS,
    });
    expect(run({ outcomes: [cleared], live: [acknowledged] })[0]).toMatchObject({ type: 'resolve' });
  });

  it('still touches an acknowledged problem that keeps firing', () => {
    expect(run({ outcomes: [fired], live: [liveProblem({ status: 'acknowledged' })] })[0]).toMatchObject({
      type: 'touch',
    });
  });
});

describe('a whole cycle', () => {
  it('handles several subjects and detectors at once, one transition each', () => {
    const other: SubjectRef = { type: 'service', id: 'prod/api', name: 'api', serviceId: 'prod/api' };
    const transitions = run({
      outcomes: [
        fired,
        { state: 'clear', kind: 'rds_cpu_high', subject: other },
        { state: 'not_evaluated', kind: 'elb_5xx', subject: other },
      ],
      live: [liveProblem()],
    });
    // The fired subject is touched, the clear one is not live so nothing happens, the unevaluated one is silent.
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ type: 'touch' });
  });

  it('is pure: the same cycle twice gives the same transitions', () => {
    const once = run({ outcomes: [fired, cleared], live: [liveProblem()] });
    const twice = run({ outcomes: [fired, cleared], live: [liveProblem()] });
    expect(once).toEqual(twice);
  });
});
