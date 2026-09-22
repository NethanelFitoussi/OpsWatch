import 'server-only';
import type { DetectorCycle } from './framework';
import { problemKey } from './key';
import type { DetectedProblem, SubjectOutcome } from './types';

/**
 * The problem lifecycle: `open → acknowledged → resolved → closed` (§4.3), as amended by **§33.5**.
 *
 * Pure, and deliberately so. It is handed the live rows as a plain projection, this cycle's outcomes and the
 * clock, and it answers transitions for the store to apply. Nothing here writes, and nothing here asks what
 * time it is — every rule below is therefore testable with literals.
 */

/** Three consecutive evaluated-and-clear cycles, and at least fifteen minutes of them. */
export const CLEAR_EVALUATIONS = 3;
export const CLEAR_MIN_MS = 15 * 60_000;
/** Firing again inside this window reopens the same row; beyond it, a new row succeeds the old one. */
export const REOPEN_WINDOW_MS = 2 * 60 * 60_000;
/** A subject nobody has evaluated for this long is reported stale rather than resolved. */
export const STALE_AFTER_MS = 60 * 60_000;

/** What the store hands in: a projection of the row, never the row — `detect` may not import the schema. */
export type LiveProblem = {
  id: string;
  key: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'closed';
  firstSeenAt: number;
  lastSeenAt: number;
  lastEvaluatedAt: number;
  clearStreak: number;
  clearSinceAt: number | null;
  occurrences: number;
  flapCount: number;
  resolvedAt: number | null;
};

export type Transition =
  /** Nothing like this has been seen, or the last one is too old to continue. */
  | { type: 'open'; key: string; at: number; problem: DetectedProblem; previousProblemId: string | null }
  /** Trouble returned inside the window: the same row continues, and the flap is counted. */
  | { type: 'reopen'; id: string; key: string; at: number; problem: DetectedProblem }
  /** Still firing. */
  | { type: 'touch'; id: string; at: number; problem: DetectedProblem; resetClear: boolean }
  /** Evaluated and found clear, but not for long enough yet. */
  | { type: 'progress_clear'; id: string; at: number; clearStreak: number; clearSinceAt: number }
  /** Evaluated and clear, three times, over at least fifteen minutes. */
  | { type: 'resolve'; id: string; at: number };

export function isStale(problem: LiveProblem, nowMs: number): boolean {
  return nowMs - problem.lastEvaluatedAt > STALE_AFTER_MS;
}

const keyOf = (connectionId: string, scope: string, outcome: SubjectOutcome) =>
  problemKey({ connectionId, scope, kind: outcome.kind, subjectId: outcome.subject.id });

export type CycleInput = {
  connectionId: string;
  scope: string;
  /** Every problem currently live for this environment, by key. */
  live: readonly LiveProblem[];
  /** Rows resolved recently enough to still be reopenable, plus any older ones for the same key. */
  resolvedInWindow: readonly LiveProblem[];
  cycle: DetectorCycle;
  nowMs: number;
};

/**
 * Turns one cycle's outcomes into the transitions the store should apply.
 *
 * The rule that matters most is the one that produces *nothing*: a `not_evaluated` outcome yields no
 * transition at all. It does not advance a clear streak, it does not reset one, and it does not touch
 * `lastEvaluatedAt` — which is precisely what later lets `isStale` notice that nobody has looked. §33.5:
 * "a monitoring tool that quietly closes what it stopped looking at is worse than one that admits the gap."
 */
export function applyCycle(input: CycleInput): Transition[] {
  const live = new Map(input.live.map((problem) => [problem.key, problem]));
  const resolved = new Map<string, LiveProblem>();
  for (const problem of input.resolvedInWindow) {
    const held = resolved.get(problem.key);
    // Keep the most recently resolved row per key: that is the one a reopen should continue.
    if (!held || (problem.resolvedAt ?? 0) > (held.resolvedAt ?? 0)) resolved.set(problem.key, problem);
  }

  const transitions: Transition[] = [];
  for (const outcome of input.cycle.outcomes) {
    // §33.5: silence is not evidence. No transition, and `lastEvaluatedAt` is left alone on purpose.
    if (outcome.state === 'not_evaluated') continue;

    const key = keyOf(input.connectionId, input.scope, outcome);
    const current = live.get(key);

    if (outcome.state === 'fired') {
      transitions.push(firing(key, current, resolved.get(key), outcome.problem, input.nowMs));
      continue;
    }

    // Evaluated, and found clear.
    if (current) transitions.push(clearing(current, input.nowMs));
  }
  return transitions;
}

function firing(
  key: string,
  current: LiveProblem | undefined,
  lastResolved: LiveProblem | undefined,
  problem: DetectedProblem,
  nowMs: number,
): Transition {
  if (current) {
    // A row that had begun clearing and fired again has not cleared *consecutively*, so the streak restarts.
    return { type: 'touch', id: current.id, at: nowMs, problem, resetClear: current.clearStreak > 0 };
  }
  if (lastResolved && lastResolved.resolvedAt !== null && nowMs - lastResolved.resolvedAt <= REOPEN_WINDOW_MS) {
    // Inside the window the same row continues, so firstSeenAt, occurrences and the acknowledgement survive.
    // This is what stops a flapping service producing forty rows a day.
    return { type: 'reopen', id: lastResolved.id, key, at: nowMs, problem };
  }
  return { type: 'open', key, at: nowMs, problem, previousProblemId: lastResolved?.id ?? null };
}

function clearing(current: LiveProblem, nowMs: number): Transition {
  const clearStreak = current.clearStreak + 1;
  const clearSinceAt = current.clearSinceAt ?? nowMs;
  // Both conditions, not either: three cycles a minute apart have not shown fifteen minutes of health.
  if (clearStreak >= CLEAR_EVALUATIONS && nowMs - clearSinceAt >= CLEAR_MIN_MS) {
    return { type: 'resolve', id: current.id, at: nowMs };
  }
  return { type: 'progress_clear', id: current.id, at: nowMs, clearStreak, clearSinceAt };
}
