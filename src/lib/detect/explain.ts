/**
 * Why OpsWatch opened a problem, what it can establish about the damage, and what to look at first.
 *
 * Pure: kind, values and what the caller already read, in — structure out. No clock, no database, no AWS.
 *
 * **The whole file is about not over-claiming.** A detector knows what it measured and which rule fired;
 * it does not know whether users noticed. So `impact.established` is a real field, `expected` is absent
 * where nothing was measured to expect, and every recommended check carries the evidence that produced it
 * rather than being a generic list somebody would learn to skip.
 */

import { ALB_5XX_RATE_LEVELS, ALB_ELB_5XX_COUNT, ECS_UTILIZATION_LEVELS, FREEABLE_MEMORY_LEVELS, REPLICA_LAG_LEVELS, RDS_CPU_LEVELS } from '../monitoring/insights';

export type Severity = 'critical' | 'warning' | 'info';

/**
 * What made the detector fire.
 *
 * `threshold` is a fixed number written in the rules; `presence` is "any at all", which has no threshold to
 * quote; `state` is a fact reported by AWS rather than a measurement OpsWatch took. A reader should never
 * have to reverse-engineer which of the three they are looking at.
 */
export type DetectionRule =
  | { kind: 'threshold'; observed: number; threshold: number; clearAt: number | null; unit: Unit }
  | { kind: 'presence'; observed: number; unit: Unit }
  | { kind: 'state'; unit: Unit };

export type Unit = 'count' | 'percent' | 'ms' | 'requests';

const NUMBER = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The threshold a severity crossed, for a two-level rule. */
function levelOf(levels: { warning: { threshold: number; clearAt?: number }; critical?: { threshold: number; clearAt?: number } }, severity: Severity) {
  const level = severity === 'critical' && levels.critical !== undefined ? levels.critical : levels.warning;
  return { threshold: level.threshold, clearAt: level.clearAt ?? null };
}

/**
 * The rule behind one problem, or null for a kind with no numeric rule to quote.
 *
 * Every entry names the constant the detector actually used, so a threshold cannot drift apart from the
 * sentence that explains it — changing one changes the other.
 */
export function ruleFor(kind: string, values: Record<string, unknown>, severity: Severity): DetectionRule | null {
  switch (kind) {
    case 'alb_elb_5xx_count': {
      const observed = NUMBER(values.count);
      if (observed === null) return null;
      const threshold = severity === 'critical' ? ALB_ELB_5XX_COUNT.critical : ALB_ELB_5XX_COUNT.warning;
      return { kind: 'threshold', observed, threshold, clearAt: null, unit: 'count' };
    }
    case 'alb_5xx_rate': {
      const observed = NUMBER(values.rate);
      if (observed === null) return null;
      const { threshold, clearAt } = levelOf(ALB_5XX_RATE_LEVELS, severity);
      return { kind: 'threshold', observed, threshold, clearAt, unit: 'percent' };
    }
    case 'alb_unhealthy_hosts': {
      const observed = NUMBER(values.count);
      // "Any unhealthy host at all" has no threshold worth quoting, and pretending it is `> 0` reads as
      // arithmetic where the rule is a presence check.
      return observed === null ? null : { kind: 'presence', observed, unit: 'count' };
    }
    case 'ecs_cpu_high':
    case 'ecs_memory_high': {
      const observed = NUMBER(values.value);
      if (observed === null) return null;
      const { threshold, clearAt } = levelOf(ECS_UTILIZATION_LEVELS, severity);
      return { kind: 'threshold', observed, threshold, clearAt, unit: 'percent' };
    }
    case 'rds_cpu_high': {
      const observed = NUMBER(values.value);
      if (observed === null) return null;
      const { threshold, clearAt } = levelOf(RDS_CPU_LEVELS, severity);
      return { kind: 'threshold', observed, threshold, clearAt, unit: 'percent' };
    }
    case 'rds_freeable_memory_low': {
      const observed = NUMBER(values.value);
      if (observed === null) return null;
      const { threshold, clearAt } = levelOf(FREEABLE_MEMORY_LEVELS, severity);
      return { kind: 'threshold', observed, threshold, clearAt, unit: 'percent' };
    }
    case 'aurora_replica_lag': {
      const observed = NUMBER(values.lagging);
      if (observed === null) return null;
      return { kind: 'threshold', observed, threshold: REPLICA_LAG_LEVELS.warning.threshold, clearAt: REPLICA_LAG_LEVELS.warning.clearAt ?? null, unit: 'ms' };
    }
    case 'ecs_tasks_below_desired': {
      const running = NUMBER(values.running);
      const desired = NUMBER(values.desired);
      if (running === null || desired === null) return null;
      // The rule is "fewer than asked for", and the number that matters is how many are missing.
      return { kind: 'threshold', observed: running, threshold: desired, clearAt: null, unit: 'count' };
    }
    // Reported by AWS rather than measured here: an alarm's own state, a rollout's own outcome.
    case 'alarm_firing':
    case 'ecs_rollout_failed':
    case 'ecs_rollout_stuck':
      return { kind: 'state', unit: 'count' };
    default:
      return null;
  }
}

export type Impact = {
  /** Requests in the window the rule looked at, where the detector measured one. */
  requests: number | null;
  /** Failed requests, where the detector measured them. */
  errors: number | null;
  /**
   * The share of a group that is affected, 0–1, or null when the detector could not tell.
   *
   * §33.7's rule: a term that is unknown is **left out**, never zero-filled — so null here means "not
   * measured" and 0 means "measured, and nothing is affected". Rendering them the same would turn an
   * absence into a reassurance.
   */
  blastShare: number | null;
  /** Whether §17's dependency map could say the subject is something a user reaches. It does not exist yet. */
  userFacingKnown: boolean;
  /**
   * Whether anything can be said about *users* at all.
   *
   * False is the common answer and the honest one. A load balancer returning 5xx is a measurement; how many
   * people saw an error page is not something OpsWatch reads, and a page that implies otherwise is lying
   * in the direction that feels most helpful.
   */
  established: boolean;
};

export function impactFor(
  kind: string,
  values: Record<string, unknown>,
  terms: { b: number | null; u: number | null },
): Impact {
  const requests = NUMBER(values.requests);
  const errors = NUMBER(values.errors) ?? (kind === 'alb_elb_5xx_count' ? NUMBER(values.count) : null);
  return {
    requests,
    errors,
    blastShare: terms.b,
    userFacingKnown: terms.u !== null,
    // Only a measured share of real traffic says anything about what reached a person. Everything else —
    // a count with no denominator, a CPU figure, an unhealthy host — is a fact about the estate.
    established: requests !== null && requests > 0 && errors !== null,
  };
}

/** One thing to look at, and the evidence that put it on the list. */
export type Check = {
  id: string;
  /** What the reader is being asked to do. */
  action: string;
  /** Why *this* problem produced *this* suggestion. Never a generic sentence. */
  reasonKey: string;
  reasonValues: Record<string, string | number>;
  /** Where to go, when OpsWatch has somewhere useful. */
  href: string | null;
};

export type CheckInput = {
  kind: string;
  values: Record<string, unknown>;
  /** Deployments correlated with the problem's start, nearest first. */
  deployments: readonly { id: string; label: string; minutesBefore: number; href: string | null; filesChanged: number | null; changesHref: string | null }[];
  /** Error groups that appeared or came back near the problem's start. */
  errorGroups: readonly { id: string; message: string; href: string | null }[];
  /** Unhealthy targets measured on the same subject, where the family reports them. */
  unhealthyTargets: number | null;
  /** Where the subject itself can be opened. */
  subjectHref: string | null;
};

/**
 * What to look at, in the order the evidence justifies.
 *
 * Ordered by how directly the evidence points, not by a fixed checklist: a deployment eight minutes before
 * the errors is a better first stop than "look at the logs", and a list that always says the same thing in
 * the same order is a list operators learn to scroll past.
 *
 * **Nothing here is generated without evidence for it.** An empty list is a real answer, and the page says
 * so rather than inventing three plausible steps.
 */
export function checksFor(input: CheckInput): Check[] {
  const checks: Check[] = [];

  // Unhealthy targets first where they exist: they explain 5xx that never reached an application.
  if (input.unhealthyTargets !== null && input.unhealthyTargets > 0) {
    checks.push({
      id: 'targets',
      action: 'targets',
      reasonKey: 'targetsUnhealthy',
      reasonValues: { count: input.unhealthyTargets },
      href: input.subjectHref,
    });
  }

  // §7's correlation, as an instruction rather than a claim: the nearest change before it started.
  const nearest = input.deployments[0];
  if (nearest !== undefined) {
    checks.push({
      id: 'deployment',
      action: 'deployment',
      reasonKey: 'deploymentBefore',
      reasonValues: { minutes: nearest.minutesBefore, version: nearest.label },
      href: nearest.href,
    });
    // Only when the commits were actually fetched. "0 files changed" for a deployment nobody enriched
    // would read as "nothing changed", which is the failure the whole chain exists to avoid.
    if (nearest.filesChanged !== null && nearest.filesChanged > 0) {
      checks.push({
        id: 'changes',
        action: 'changes',
        reasonKey: 'filesChanged',
        reasonValues: { files: nearest.filesChanged, version: nearest.label },
        href: nearest.changesHref,
      });
    }
  }

  const error = input.errorGroups[0];
  if (error !== undefined) {
    checks.push({
      id: 'errors',
      action: 'errors',
      reasonKey: 'errorsNearby',
      reasonValues: { count: input.errorGroups.length, message: error.message },
      href: error.href,
    });
  }

  // The one suggestion that is about the *rule* rather than the estate, and only where it is diagnostic:
  // errors the load balancer returned itself never reached a target, which rules a whole class out.
  if (input.kind === 'alb_elb_5xx_count') {
    checks.push({
      id: 'elbItself',
      action: 'loadBalancer',
      reasonKey: 'elbGenerated',
      reasonValues: { count: typeof input.values.count === 'number' ? input.values.count : 0 },
      href: input.subjectHref,
    });
  }

  return checks;
}

/**
 * How a reader will know it is over.
 *
 * Taken from the lifecycle rather than invented: §33.5 resolves a problem after three consecutive
 * evaluated-and-clear cycles over at least fifteen minutes. A rule with a clearing margin says the number
 * the measurement has to come back under, which is not the same as the number it crossed.
 */
export type Recovery = { clearAt: number | null; unit: Unit } | null;

export function recoveryFor(rule: DetectionRule | null): Recovery {
  if (rule === null || rule.kind !== 'threshold') return null;
  return { clearAt: rule.clearAt, unit: rule.unit };
}
