import 'server-only';
import type { UserFacing } from './score';
import type { DetectedProblem, SubjectOutcome } from './types';
import { certificateSeverity, isSlow, medianLatency, statusFrom, type RunOutcome } from './synthetic';

/**
 * §5's synthetic detectors: `synthetic_down`, `synthetic_slow`, `cert_expiring`.
 *
 * Pure, and shaped like every other detector so the lifecycle treats a failing check exactly as it treats a
 * failing service — it opens, it reopens, it flaps, it resolves. That uniformity is the point: a synthetic
 * failure is not a second kind of alert living beside problems, it *is* a problem.
 *
 * §33.5's three outcomes apply here too. A check that has never run is **not evaluated**, not clear: nobody
 * has looked, and recording it as healthy would let the lifecycle resolve a problem on the strength of a
 * measurement nobody made.
 */

export type SyntheticSubject = {
  id: string;
  name: string;
  url: string;
  latencyThresholdMs: number | null;
  runs: readonly RunOutcome[];
  /** The certificate expiry from the newest run that saw one, or null when no run has. */
  certificateExpiresAt: number | null;
};

/** A synthetic check is user-facing by construction: somebody pointed it at an endpoint users reach. */
const USER_FACING: UserFacing = 'direct';

/**
 * One thing the check actually measured.
 *
 * `labelKey` is relative to the `Insights` namespace, the same convention `lib/detect/aws.ts` uses when it
 * passes an insight's own `messageKey` through — so an evidence row renders through exactly the renderer
 * every other detector's evidence renders through, rather than needing a namespace of its own.
 */
function evidence(label: string, values: Record<string, string | number>, at: number, value: number | null, unit: string | null = null) {
  // `value: null` is "not measured" and `unit: null` is "no unit"; neither is ever written as zero (§2.4).
  return { kind: 'check' as const, labelKey: `evidence.${label}`, values, value, unit, at };
}

/**
 * Every detector's verdict for one check.
 *
 * Returns outcomes rather than only problems, so a check that was looked at and found healthy is recorded
 * as `clear` and one that has never run is recorded as `not_evaluated` — the distinction §33.5 exists for.
 */
export function syntheticOutcomes(subject: SyntheticSubject, nowMs: number): SubjectOutcome[] {
  const ref = { type: 'synthetic' as const, id: subject.id, name: subject.name, serviceId: null };
  const href = `/overview/synthetics`;
  const status = statusFrom(subject.runs);
  const newest = [...subject.runs].sort((a, b) => b.at - a.at)[0];

  // Nothing has run: no detector may speak for this subject, in either direction.
  if (subject.runs.length === 0) {
    return [
      { subject: ref, kind: 'synthetic_down', state: 'not_evaluated' as const },
      { subject: ref, kind: 'synthetic_slow', state: 'not_evaluated' as const },
      { subject: ref, kind: 'cert_expiring', state: 'not_evaluated' as const },
    ];
  }

  const outcomes: SubjectOutcome[] = [];

  const down: DetectedProblem = {
    kind: 'synthetic_down',
    subject: ref,
    level: 'critical',
    titleKey: 'Insights.messages.synthetic_down',
    values: { name: subject.name, url: subject.url },
    href,
    evidence: [evidence('syntheticStatus', { name: subject.name }, newest.at, null)],
    blast: null,
    // Two consecutive failures is §14's bar, so by the time this fires the check has been failing a while.
    minutesBreaching: 10,
    userFacing: USER_FACING,
    robustZ: null,
  };
  outcomes.push(status === 'down' ? { subject: ref, kind: 'synthetic_down', state: 'fired' as const, problem: down } : { subject: ref, kind: 'synthetic_down', state: 'clear' as const });

  const median = medianLatency(subject.runs);
  if (subject.latencyThresholdMs === null || median === null) {
    // No threshold, or nothing timed: there is no question to answer, so no verdict is given.
    outcomes.push({ subject: ref, kind: 'synthetic_slow', state: 'not_evaluated' as const });
  } else if (isSlow(subject.runs, subject.latencyThresholdMs)) {
    outcomes.push({
      subject: ref,
      kind: 'synthetic_slow',
      state: 'fired' as const,
      problem: {
        kind: 'synthetic_slow',
        subject: ref,
        level: 'warning',
        titleKey: 'Insights.messages.synthetic_slow',
        values: { name: subject.name, median: Math.round(median), threshold: subject.latencyThresholdMs },
        href,
        evidence: [evidence('syntheticLatency', { name: subject.name }, newest.at, median, 'ms')],
        blast: null,
        minutesBreaching: 15,
        userFacing: USER_FACING,
        robustZ: null,
      },
    });
  } else {
    outcomes.push({ subject: ref, kind: 'synthetic_slow', state: 'clear' as const });
  }

  const certificate = certificateSeverity(subject.certificateExpiresAt, nowMs);
  if (subject.certificateExpiresAt === null) {
    // A plain-HTTP check has no certificate. That is not a healthy certificate.
    outcomes.push({ subject: ref, kind: 'cert_expiring', state: 'not_evaluated' as const });
  } else if (certificate === null) {
    outcomes.push({ subject: ref, kind: 'cert_expiring', state: 'clear' as const });
  } else {
    const days = Math.max(0, Math.floor((subject.certificateExpiresAt - nowMs) / (24 * 60 * 60_000)));
    outcomes.push({
      subject: ref,
      kind: 'cert_expiring',
      state: 'fired' as const,
      problem: {
        kind: 'cert_expiring',
        subject: ref,
        level: certificate,
        titleKey: 'Insights.messages.cert_expiring',
        values: { name: subject.name, days },
        href,
        evidence: [evidence('certificateExpiry', { name: subject.name }, newest.at, days, 'days')],
        blast: null,
        // A certificate does not get better on its own, so it has been "breaching" since it was issued.
        minutesBreaching: 60,
        userFacing: USER_FACING,
        robustZ: null,
      },
    });
  }

  return outcomes;
}
