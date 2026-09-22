import 'server-only';
import type { DetectedProblem, SubjectRef } from './types';

/**
 * The error detectors of §4.4: the two cases where an error group is worth opening a *problem* for.
 *
 * Most error groups are not problems. A group that has existed for months and ticks over at a steady rate is
 * information, not an interruption. These two are the exceptions: something that was never here before, and
 * something that is suddenly far worse than it was.
 *
 * Pure, like the rest of `detect`: the caller supplies the counts and the clock.
 */

/** Below this an error is noise however sharply it rose: three occurrences up from one is not a spike. */
export const SPIKE_MIN_OCCURRENCES = 10;
/** How many times its own baseline a group must reach to count as spiking (§4.4). */
export const SPIKE_MULTIPLE = 3;

export type ErrorGroupFacts = {
  id: string;
  fingerprint: string;
  serviceId: string | null;
  exceptionType: string | null;
  sampleMessage: string;
  status: 'new' | 'regressed' | 'ongoing' | 'resolved' | 'muted';
  firstSeenAt: number;
  statusSince: number;
  /** Occurrences in the window being judged. */
  occurrences: number;
  /** The usual count for this hour of the week, or null when there is not enough history to say. */
  baseline: number | null;
  href: string;
};

/**
 * Whether a group is spiking: `occurrences >= max(10, 3 × baseline)` (§4.4).
 *
 * With no baseline the answer is **false**, not true. A group OpsWatch has not watched long enough to have a
 * baseline for is not evidence of a spike — it is evidence of a short history, and calling it a spike would
 * make every new installation look like it was on fire.
 */
export function isSpiking(facts: Pick<ErrorGroupFacts, 'occurrences' | 'baseline'>): boolean {
  if (facts.baseline === null) return false;
  return facts.occurrences >= Math.max(SPIKE_MIN_OCCURRENCES, SPIKE_MULTIPLE * facts.baseline);
}

const subjectOf = (facts: ErrorGroupFacts): SubjectRef => ({
  type: 'error_group',
  id: facts.fingerprint,
  name: facts.sampleMessage.slice(0, 120),
  serviceId: facts.serviceId,
});

/**
 * `error_group_new` — a group that has just appeared, or come back after a day of silence.
 *
 * A regression counts because §4.4 treats it as news: something that was fixed, or had stopped, is happening
 * again, and that is worth the same attention as a first appearance.
 */
export function errorGroupNew(facts: ErrorGroupFacts, nowMs: number): DetectedProblem | null {
  if (facts.status !== 'new' && facts.status !== 'regressed') return null;
  return {
    kind: 'error_group_new',
    subject: subjectOf(facts),
    // An error nobody has seen before is worth a look, not an alarm: `warning` unless the volume argues more.
    level: facts.occurrences >= SPIKE_MIN_OCCURRENCES ? 'critical' : 'warning',
    titleKey: facts.status === 'regressed' ? 'Errors.problem.regressed' : 'Errors.problem.new',
    values: { message: facts.sampleMessage.slice(0, 120), count: facts.occurrences },
    href: facts.href,
    evidence: [
      {
        kind: 'log',
        labelKey: 'Errors.evidence.occurrences',
        values: { count: facts.occurrences },
        value: facts.occurrences,
        unit: 'count',
        at: nowMs,
      },
    ],
    // How many resources an error group affects is not knowable from the group alone.
    blast: null,
    minutesBreaching: Math.max(0, Math.round((nowMs - facts.statusSince) / 60_000)),
    userFacing: null,
    robustZ: null,
  };
}

/** `error_group_spike` — a group whose rate has jumped far above its own baseline. */
export function errorGroupSpike(facts: ErrorGroupFacts, nowMs: number): DetectedProblem | null {
  if (facts.status === 'muted' || facts.status === 'resolved') return null;
  if (!isSpiking(facts)) return null;
  const baseline = facts.baseline ?? 0;
  return {
    kind: 'error_group_spike',
    subject: subjectOf(facts),
    level: 'critical',
    titleKey: 'Errors.problem.spike',
    values: { message: facts.sampleMessage.slice(0, 120), count: facts.occurrences, baseline },
    href: facts.href,
    evidence: [
      {
        kind: 'log',
        labelKey: 'Errors.evidence.occurrences',
        values: { count: facts.occurrences },
        value: facts.occurrences,
        unit: 'count',
        at: nowMs,
      },
      {
        kind: 'log',
        labelKey: 'Errors.evidence.baseline',
        values: { baseline },
        value: baseline,
        unit: 'count',
        at: nowMs,
      },
    ],
    blast: null,
    minutesBreaching: Math.max(0, Math.round((nowMs - facts.statusSince) / 60_000)),
    userFacing: null,
    // The deviation is expressed as a multiple of the baseline, which is what the score's D term reads.
    robustZ: baseline > 0 ? Math.min(6, facts.occurrences / baseline) : null,
  };
}

/** Both detectors over one group, worst first. A group can be both new and spiking; both are worth saying. */
export function errorDetectors(facts: ErrorGroupFacts, nowMs: number): DetectedProblem[] {
  return [errorGroupSpike(facts, nowMs), errorGroupNew(facts, nowMs)].filter(
    (problem): problem is DetectedProblem => problem !== null,
  );
}
