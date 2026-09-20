import 'server-only';
import type { Insight, InsightKind, InsightSeverity, InsightValues } from '../monitoring/insights';
import { INSIGHT_WINDOW_MINUTES } from '../monitoring/insights';
import type { SubjectKind } from './key';
import type { DetectorLevel } from './score';
import type { Evidence, SubjectOutcome, SubjectRef } from './types';

/**
 * The Stage 2 insight rules, as detectors (§5).
 *
 * The rules themselves are **not rewritten**. `src/lib/monitoring/insights.ts` keeps its thresholds, its
 * hysteresis and its catalogue keys; this file is an adapter from what those rules already produce to what the
 * lifecycle needs. Two sets of thresholds to keep in step is exactly the duplication the quality rules forbid.
 *
 * `Insight` is imported as a **type only**. It is a plain data shape with no AWS in it, and a type import is
 * erased at runtime, so nothing here reaches a client, a clock or a socket.
 */

/** Which kind of thing each rule is about. The resource of an `ecs_*` insight *is* the service id. */
const SUBJECT_OF: Record<InsightKind, SubjectKind> = {
  ecs_tasks_below_desired: 'service',
  ecs_cpu_high: 'service',
  ecs_memory_high: 'service',
  ecs_rollout_failed: 'service',
  ecs_rollout_stuck: 'service',
  rds_cpu_high: 'resource',
  rds_freeable_memory_low: 'resource',
  aurora_replica_lag: 'resource',
  alb_5xx_rate: 'resource',
  alb_elb_5xx_count: 'resource',
  alb_unhealthy_hosts: 'resource',
  alarm_firing: 'resource',
};

export const INSIGHT_DETECTOR_KINDS = Object.keys(SUBJECT_OF) as InsightKind[];

/** A Stage 2 severity is already the detector's own level; the score decides what it is worth. */
const levelOf = (severity: InsightSeverity): DetectorLevel => severity;

export type EvaluatedPair = { subject: SubjectRef; kinds: readonly InsightKind[] };

export type InsightCycleInput = {
  insights: readonly Insight[];
  /** Every `(subject, detector)` pair the cycle actually looked at. Silence here means **clear**. */
  evaluated: readonly EvaluatedPair[];
  /** Pairs a cap, a throttle or a failure stopped the cycle reaching. Silence here means **nothing** (§33.5). */
  notEvaluated?: readonly EvaluatedPair[];
  nowMs: number;
  /**
   * How long this subject has been breaching. A Stage 2 insight does not carry it — the rules evaluate a window
   * rather than tracking a start — so the caller supplies it from the live problem's `firstSeenAt`. Until it
   * does, the rules' own window is the honest floor: the breach was active across all of it.
   */
  breachingMinutes?: (kind: InsightKind, subjectId: string) => number | undefined;
};

const numeric = (values: InsightValues, key: string): number | null => {
  const value = values[key];
  return typeof value === 'number' ? value : null;
};

/**
 * §4.3's named floor and §33.7's total failure, read from the insight's own values rather than assumed.
 *
 * Zero healthy targets behind a load balancer and zero running tasks are both "the subject has failed
 * completely" — the state in which the score's other inputs are precisely what is missing.
 */
function floors(insight: Insight): { totalFailure?: boolean; floorCritical?: boolean } {
  const healthy = numeric(insight.values, 'healthy');
  const running = numeric(insight.values, 'running');
  if (insight.kind === 'alb_unhealthy_hosts' && healthy === 0) return { floorCritical: true, totalFailure: true };
  if (insight.kind === 'ecs_tasks_below_desired' && running === 0) return { totalFailure: true };
  return {};
}

/**
 * The blast radius, only where the rule actually measured one. `aurora_replica_lag` counts lagging readers out
 * of the cluster's readers; nothing else carries both halves, and inventing the denominator would be the
 * zero-filling §33.7 forbids.
 */
function blastOf(insight: Insight): { affected: number; members: number } | null {
  const affected = numeric(insight.values, 'lagging');
  const members = numeric(insight.values, 'readers');
  return affected !== null && members !== null && members > 0 ? { affected, members } : null;
}

function evidenceOf(insight: Insight, severity: InsightSeverity, values: InsightValues, nowMs: number): Evidence {
  return {
    kind: 'metric',
    // The rule's own catalogue key, so EN and FR stay at parity without a second catalogue (§24).
    labelKey: insight.messageKey,
    values,
    // The rules format their measurement into `values` rather than carrying it separately, so there is no bare
    // number to put here. `null` is "not measured", which is the honest answer and never renders as 0.
    value: numeric(values, 'value'),
    unit: null,
    at: nowMs,
    href: insight.href,
  };
}

const pairKey = (kind: string, subjectId: string) => `${kind}\u0000${subjectId}`;

/**
 * Turns one cycle of Stage 2 insights into outcomes.
 *
 * **A grouped insight is expanded back into its members.** Stage 2 collapses four or more services of a cluster
 * into one row for rendering; §33.8 rules that collapse is a lifecycle transition and requires the children to
 * keep accruing evidence and keep their history. So each member becomes its own outcome here, and
 * `planFleet` performs the collapse at the problem level. Without this the children would never exist.
 */
export function outcomesFromInsights(input: InsightCycleInput): SubjectOutcome[] {
  const outcomes: SubjectOutcome[] = [];
  const fired = new Set<string>();

  for (const insight of input.insights) {
    const kind = insight.kind;
    const subjectType = SUBJECT_OF[kind];
    const rows = insight.members?.length
      ? insight.members.map((member) => ({
          resource: member.resource,
          severity: member.severity,
          messageKey: member.messageKey,
          values: member.values,
          href: member.href,
        }))
      : [{ resource: insight.resource, severity: insight.severity, messageKey: insight.messageKey, values: insight.values, href: insight.href }];

    for (const row of rows) {
      const subject: SubjectRef = {
        type: subjectType,
        id: row.resource,
        name: row.resource,
        serviceId: subjectType === 'service' ? row.resource : null,
      };
      fired.add(pairKey(kind, row.resource));
      outcomes.push({
        state: 'fired',
        kind,
        subject,
        problem: {
          kind,
          subject,
          level: levelOf(row.severity),
          titleKey: row.messageKey,
          values: row.values,
          href: row.href,
          evidence: [evidenceOf({ ...insight, messageKey: row.messageKey, href: row.href }, row.severity, row.values, input.nowMs)],
          blast: blastOf({ ...insight, values: row.values }),
          minutesBreaching: input.breachingMinutes?.(kind, row.resource) ?? INSIGHT_WINDOW_MINUTES,
          // Unknown, and left unknown: §17's dependency map and §8's baselines do not exist yet, and a zero
          // here is what §33.7 was written to stop.
          userFacing: null,
          robustZ: null,
          ...floors({ ...insight, values: row.values }),
        },
      });
    }
  }

  // Evaluated and silent is clear. This is only sound because the caller told us what it evaluated.
  for (const pair of input.evaluated) {
    for (const kind of pair.kinds) {
      if (!fired.has(pairKey(kind, pair.subject.id))) {
        outcomes.push({ state: 'clear', kind, subject: pair.subject });
      }
    }
  }

  // Never inferred from absence: a pair is not-evaluated only because the caller said so (§33.5).
  for (const pair of input.notEvaluated ?? []) {
    for (const kind of pair.kinds) {
      outcomes.push({ state: 'not_evaluated', kind, subject: pair.subject });
    }
  }
  return outcomes;
}
