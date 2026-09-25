/**
 * When an alert fires, and when it stays quiet (§15.2).
 *
 * Pure. The whole file is about *not* alerting: a dedupe key so one problem is one alert, a cooldown so a
 * flapping problem is not forty of them, and a count of what the cooldown swallowed so the quiet is visible
 * rather than merely quiet.
 *
 * The failure this prevents is the one that kills monitoring tools. A tool that sends forty messages about
 * one outage is a tool whose messages get filtered, and then the one that mattered is filtered too.
 */

export const DEFAULT_COOLDOWN_SECONDS = 1800;

export type AlertSeverity = 'critical' | 'warning' | 'info';

const RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Whether a severity meets a rule's floor. `critical` meets a `warning` floor; `info` does not. */
export function meetsSeverity(severity: AlertSeverity, minimum: AlertSeverity): boolean {
  return RANK[severity] <= RANK[minimum];
}

export type Rule = {
  id: string;
  enabled: boolean;
  condition: 'problem' | 'synthetic' | 'slo' | 'machine';
  minSeverity: AlertSeverity;
  /** Empty means every kind this condition covers. */
  kinds: readonly string[];
  cooldownSeconds: number;
};

export type Candidate = {
  /** The problem, check, objective or machine this is about. */
  subjectKey: string;
  kind: string;
  severity: AlertSeverity;
  problemId: string | null;
  /** The machine this is about, where it is about one: what the alert links to instead of a problem. */
  hostId?: string | null;
  titleKey: string;
  values: Record<string, string | number>;
};

/** §15.2: one open alert per rule and subject. Two rules may both alert on one problem; that is deliberate. */
export function dedupeKeyFor(ruleId: string, subjectKey: string): string {
  return `${ruleId}|${subjectKey}`;
}

/** The synthetic detector kinds, so a `synthetic` rule knows what it covers without listing them everywhere. */
export const SYNTHETIC_KINDS = ['synthetic_down', 'synthetic_slow', 'cert_expiring'] as const;

/** §19's two burn rates, as alert kinds. A `slo` rule covers these and nothing else. */
const SLO_BURN_KINDS = ['slo_burn_fast', 'slo_burn_slow'] as const;

/**
 * What an agent on a Linux host can find, as alert kinds.
 *
 * A `machine` rule covers these and nothing else. They are their own condition rather than more
 * `problem` kinds because the two are measured by different things and an operator turns them on for
 * different reasons: a `problem` rule is about what AWS reports, and a machine rule is about a box
 * AWS cannot see inside.
 */
export const MACHINE_KINDS = [
  'stopped_reporting',
  'disk_full',
  'disk_nearly_full',
  'memory_nearly_exhausted',
  'redis_no_memory_limit',
  'redis_near_memory_limit',
  'redis_last_save_failed',
] as const;

/** Which condition a kind belongs to. Every kind belongs to exactly one, which is what stops overlap. */
function conditionOf(kind: string): Rule['condition'] {
  if ((SYNTHETIC_KINDS as readonly string[]).includes(kind)) return 'synthetic';
  if ((SLO_BURN_KINDS as readonly string[]).includes(kind)) return 'slo';
  if ((MACHINE_KINDS as readonly string[]).includes(kind)) return 'machine';
  return 'problem';
}

export function ruleMatches(rule: Rule, candidate: Candidate): boolean {
  if (!rule.enabled) return false;
  if (!meetsSeverity(candidate.severity, rule.minSeverity)) return false;

  // The conditions partition the space rather than overlapping, so one candidate cannot match two of them
  // by accident and be announced twice under different names.
  if (rule.condition !== conditionOf(candidate.kind)) return false;

  // An empty list means every kind this condition covers, which is what makes the install rules useful
  // without an operator having to enumerate detectors they have never heard of.
  return rule.kinds.length === 0 || rule.kinds.includes(candidate.kind);
}

export type ExistingAlert = {
  dedupeKey: string;
  lastFiredAt: number;
  status: 'firing' | 'acknowledged' | 'resolved';
};

export type FireDecision =
  | { action: 'open'; dedupeKey: string }
  | { action: 'refire'; dedupeKey: string }
  | { action: 'suppress'; dedupeKey: string; reason: 'cooldown' | 'acknowledged' };

/**
 * What to do about one match.
 *
 * `acknowledged` suppresses until the alert resolves and fires again (§15.2) — acknowledging means "I know,
 * stop telling me", and a tool that keeps telling them anyway has made the acknowledgement meaningless.
 */
export function decide(rule: Rule, candidate: Candidate, existing: ExistingAlert | null, nowMs: number): FireDecision {
  const dedupeKey = dedupeKeyFor(rule.id, candidate.subjectKey);
  if (existing === null || existing.status === 'resolved') return { action: 'open', dedupeKey };
  if (existing.status === 'acknowledged') return { action: 'suppress', dedupeKey, reason: 'acknowledged' };

  const elapsed = nowMs - existing.lastFiredAt;
  // Inside the cooldown: the alert is updated but nothing is announced, and the count records that.
  if (elapsed < rule.cooldownSeconds * 1000) return { action: 'suppress', dedupeKey, reason: 'cooldown' };
  return { action: 'refire', dedupeKey };
}

/**
 * The rules an installation starts with (§15.1).
 *
 * Created at install, **visible and editable, never hidden**. Every one is in-app, because §15 promises
 * that installing OpsWatch never sends anything outside the instance.
 */
export const INSTALL_RULES: readonly { name: string; condition: Rule['condition']; minSeverity: AlertSeverity; kinds: string[] }[] = [
  { name: 'critical_problems', condition: 'problem', minSeverity: 'critical', kinds: [] },
  { name: 'synthetic_down', condition: 'synthetic', minSeverity: 'critical', kinds: ['synthetic_down'] },
  { name: 'certificate_expiring', condition: 'synthetic', minSeverity: 'warning', kinds: ['cert_expiring'] },
  // §19's multi-window burn. `warning` rather than `critical`, because the slow burn is the one that gives
  // anybody time to act and a critical floor would drop exactly half of what §19 asks for.
  { name: 'slo_burn', condition: 'slo', minSeverity: 'warning', kinds: [] },
  /*
   * `critical` rather than `warning`: a machine that has stopped reporting and a disk past 95% are the
   * two that cannot wait, and a disk at 86% every night would train an operator to ignore the rest. A
   * warning floor is one edit away for anybody who wants it.
   */
  { name: 'machine_critical', condition: 'machine', minSeverity: 'critical', kinds: [] },
];
