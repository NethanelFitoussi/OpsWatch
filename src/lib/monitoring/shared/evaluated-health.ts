/**
 * What OpsWatch is allowed to call healthy.
 *
 * Green is the reason this file exists. A healthy estate used to render as a blank page — no problem rows,
 * nothing to draw — which reads as "OpsWatch is not working" rather than "your infrastructure is fine".
 * Colour fixes that, and colour is also the easiest thing in a monitoring product to lie with.
 *
 * So: **green is earned, never assumed.** A resource is green when somebody looked, the looking was recent
 * enough to still mean something, and the checks that ran passed. The absence of a problem is not evidence
 * of health — it is the absence of evidence, which is §2.4 and §2.6 applied to a colour.
 *
 * Pure: states in, state out. No clock of its own (`nowMs` is passed), no database, no AWS.
 */

export const EVALUATED_STATES = ['healthy', 'warning', 'critical', 'unknown', 'stale'] as const;
export type EvaluatedState = (typeof EVALUATED_STATES)[number];

/**
 * How long a reading stands for "now".
 *
 * Three detect cycles. One missed cycle is a blip; three in a row means nothing is reading this resource
 * any more, and a green tile drawn from a quarter-hour-old measurement is a claim about the present made
 * from the past.
 */
export const FRESH_FOR_MS = 15 * 60_000;

/** One check that actually ran. A check nobody ran is absent from the list, never a passing one. */
export type ResourceCheck = {
  /** A key into `Monitoring.checks.*`, so the sentence is translated and cannot drift from the rule. */
  id: string;
  outcome: 'pass' | 'warn' | 'fail';
  values?: Record<string, string | number>;
};

export type Evaluation = {
  state: EvaluatedState;
  /** The checks behind the verdict — the evidence that makes a green tile answerable. */
  checks: readonly ResourceCheck[];
  /**
   * Signals OpsWatch tried to read for this resource and could not, as keys into `Monitoring.checks.*`.
   *
   * They are the difference between "we checked everything and it is fine" and "we checked what we could".
   * A resource with an unread signal and nothing wrong is `unknown`, not green: the checks that ran did
   * pass, and that is not the same as the resource being healthy.
   */
  unread: readonly string[];
  evaluatedAt: number | null;
  /** How old the reading is, or null when there has never been one. */
  ageMs: number | null;
};

/**
 * The verdict on one resource.
 *
 * Note the two ways of not being green that are not red: `unknown` is *nobody looked*, `stale` is *we
 * looked a long time ago*. They share a colour, because they share a meaning — OpsWatch cannot tell you —
 * and never a word, because they have different fixes.
 *
 * An empty check list is `unknown`, not `healthy`. Nothing ran, so nothing passed. This is the single line
 * that stops "no problem row exists" from becoming a green tile.
 */
export function evaluate(input: {
  checks: readonly ResourceCheck[] | null;
  unread?: readonly string[];
  evaluatedAt: number | null;
  nowMs: number;
  freshForMs?: number;
}): Evaluation {
  const { checks, evaluatedAt, nowMs } = input;
  const unread = input.unread ?? [];
  const freshForMs = input.freshForMs ?? FRESH_FOR_MS;
  const ageMs = evaluatedAt === null ? null : Math.max(0, nowMs - evaluatedAt);
  const base = { checks: checks ?? [], unread, evaluatedAt, ageMs };

  if (checks === null || evaluatedAt === null || checks.length === 0) return { ...base, state: 'unknown' };
  // The checks are kept when the reading is old: "it was healthy twenty minutes ago" is worth reading, as
  // long as nothing renders it as "it is healthy".
  if (ageMs !== null && ageMs > freshForMs) return { ...base, state: 'stale' };
  if (checks.some((check) => check.outcome === 'fail')) return { ...base, state: 'critical' };
  if (checks.some((check) => check.outcome === 'warn')) return { ...base, state: 'warning' };
  // Everything that ran passed, but something did not run. That is not a healthy resource; it is a
  // resource OpsWatch has not finished looking at.
  if (unread.length > 0) return { ...base, state: 'unknown' };
  return { ...base, state: 'healthy' };
}

export type GroupHealth = {
  /**
   * The group's one-word verdict — and `healthy` only when every member is.
   *
   * A group holding one resource nobody could read is not a healthy group, so its word is `unknown`. That
   * would be alarming on its own, which is why nothing renders this word without the counts beside it:
   * "Cannot fully tell · 48 healthy, 1 not evaluated" is the sentence, and it is neither a false green nor
   * a false alarm.
   */
  state: EvaluatedState;
  counts: Record<EvaluatedState, number>;
  total: number;
};

export function rollUp(states: readonly EvaluatedState[]): GroupHealth {
  const counts: Record<EvaluatedState, number> = { healthy: 0, warning: 0, critical: 0, unknown: 0, stale: 0 };
  for (const state of states) counts[state] += 1;

  // An empty group is not a healthy one: there is nothing to have been healthy.
  const state: EvaluatedState =
    states.length === 0
      ? 'unknown'
      : counts.critical > 0
        ? 'critical'
        : counts.warning > 0
          ? 'warning'
          : counts.unknown + counts.stale > 0
            ? 'unknown'
            : 'healthy';

  return { state, counts, total: states.length };
}

/** Whether a group has anything OpsWatch could not read, which is what stops its headline being green. */
export function hasGaps(group: GroupHealth): boolean {
  return group.counts.unknown + group.counts.stale > 0;
}
