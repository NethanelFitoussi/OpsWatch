/**
 * The Checkup catalogue (Stage 3 §4, renamed by the intelligence spec's naming ruling).
 *
 * A **finding** is a standing observation about how an environment is *set up*: a permission that was never
 * granted, a log group nobody is reading, a collector that has never run. That is a different object from a
 * **problem**, which is something breaking now, opened by a detector and tracked through a lifecycle.
 * Problems resolve themselves when the trouble stops; findings stay until somebody changes a setting.
 *
 * Every check is a pure function of already-fetched inputs — no AWS client, no database, no clock (§9.6) —
 * so the whole catalogue can be run against fixtures at and around each threshold.
 *
 * **The rule that shapes the types.** A check that could not run says so. A findings list of three where two
 * checks failed is a lie about coverage, and §2.6 forbids it exactly as it forbids reporting health nobody
 * measured. So a check returns one of three outcomes and there is no fourth, silent, option.
 */

export type CheckSeverity = 'critical' | 'warning' | 'info';

/**
 * Why a check could not run. Each is a different sentence to the reader:
 *
 * - `denied` — the permission it needs was refused, so the answer is unknowable from here.
 * - `not_collected` — OpsWatch does not yet gather the data this check reads.
 * - `cap` — the scope was truncated to stay inside the query budget (§9.5).
 * - `unsupported` — the resource cannot answer it at all, such as a formula-based Aurora maximum.
 */
export type NotRunReason = 'denied' | 'not_collected' | 'cap' | 'unsupported';

export type CheckValues = Record<string, string | number>;

export type CheckOutcome =
  | { id: string; state: 'finding'; severity: CheckSeverity; subject: string | null; values: CheckValues }
  | { id: string; state: 'clear' }
  | { id: string; state: 'not_run'; reason: NotRunReason; values: CheckValues };

/** Everything the catalogue reads. Assembled by the read service; none of it is fetched here. */
export type CheckupInput = {
  /** The stored permission test, or null when the connection has never been tested. */
  permissions: {
    accountMatches: boolean;
    testedAt: string;
    checks: readonly { service: string; status: string; errorCode?: string }[];
  } | null;
  /** What the detect job last saw of each family. */
  families: readonly {
    family: string;
    unavailableReason: string | null;
    unavailableCode: string | null;
  }[];
  logSources: { total: number; enabled: number };
  history: { enabled: boolean };
  /** Today's Logs Insights usage against the hard stop, or null when no budget is configured. */
  logsBudget: {
    exhausted: boolean;
    scannedGb: number;
    /** This account's share of the day, which is the whole cap when it is the only one reading logs. */
    limitGb: number;
    /** True when the installation's cap stopped it while this account still had share left. */
    stoppedByInstance: boolean;
  } | null;
  collector: { neverRan: boolean; failingJobs: readonly string[] };
  /** The CloudFormation template the connection was created with, against the current one. */
  template: { version: number | null; current: number };
};

const finding = (id: string, severity: CheckSeverity, values: CheckValues = {}, subject: string | null = null): CheckOutcome =>
  ({ id, state: 'finding', severity, subject, values });
const clear = (id: string): CheckOutcome => ({ id, state: 'clear' });
const notRun = (id: string, reason: NotRunReason, values: CheckValues = {}): CheckOutcome => ({ id, state: 'not_run', reason, values });

/**
 * Permissions, first in the catalogue.
 *
 * Stage 3's reason, kept verbatim because it is the whole argument for the ordering: *a missing permission
 * makes every other check partial*. A reader who sees six findings and does not know that RDS was never
 * readable will draw the wrong conclusion from the six.
 */
export function permissionChecks(input: CheckupInput): CheckOutcome[] {
  if (input.permissions === null) {
    // Never tested is not the same as tested and fine, and it is not a failure either.
    return [finding('permissions_untested', 'warning')];
  }

  const outcomes: CheckOutcome[] = [];
  if (!input.permissions.accountMatches) {
    // The credentials work but reach a different account than the one configured: everything read since is
    // about the wrong estate, which outranks every other finding.
    outcomes.push(finding('account_mismatch', 'critical'));
  }

  const refused = input.permissions.checks.filter((check) => check.status === 'denied');
  const errored = input.permissions.checks.filter((check) => check.status === 'error');
  if (refused.length > 0) {
    outcomes.push(
      finding('permissions_denied', 'critical', {
        services: refused.map((check) => check.service).join(', '),
        count: refused.length,
      }),
    );
  }
  if (errored.length > 0) {
    outcomes.push(
      finding('permissions_errored', 'warning', {
        services: errored.map((check) => check.service).join(', '),
        count: errored.length,
      }),
    );
  }
  if (outcomes.length === 0) outcomes.push(clear('permissions_denied'));
  return outcomes;
}

/** A family the detect job could not read leaves every check about it unanswerable, so it is named. */
export function coverageChecks(input: CheckupInput): CheckOutcome[] {
  const unreadable = input.families.filter((family) => family.unavailableReason !== null);
  if (unreadable.length === 0) return [clear('family_unreadable')];
  return unreadable.map((family) =>
    finding(
      'family_unreadable',
      'warning',
      { family: family.family, reason: family.unavailableReason ?? '', code: family.unavailableCode ?? '' },
      family.family,
    ),
  );
}

/** What OpsWatch is and is not collecting, which decides what the rest of the product can answer. */
export function collectionChecks(input: CheckupInput): CheckOutcome[] {
  const outcomes: CheckOutcome[] = [];

  outcomes.push(
    input.logSources.enabled === 0
      ? // Not a fault: nothing is switched on, and switching one on costs money. Stated as the trade it is.
        finding('errors_not_collected', 'warning', { discovered: input.logSources.total })
      : clear('errors_not_collected'),
  );

  outcomes.push(
    input.history.enabled
      ? clear('history_off')
      : // Info, not a warning: off is the shipped default and a deliberate decision (§31.1).
        finding('history_off', 'info'),
  );

  if (input.logsBudget === null) {
    outcomes.push(notRun('logs_budget', 'not_collected'));
  } else if (input.logsBudget.exhausted) {
    // Two different facts, and saying the wrong one is worse than saying nothing: "used up (0.00 of
    // 5 GB)" is a contradiction, and it is what this account sees when another one spent the cap.
    outcomes.push(
      input.logsBudget.stoppedByInstance
        ? finding('logs_budget_instance_exhausted', 'critical', { limit: input.logsBudget.limitGb })
        : finding('logs_budget_exhausted', 'critical', {
            scanned: input.logsBudget.scannedGb,
            limit: input.logsBudget.limitGb,
          }),
    );
  } else {
    outcomes.push(clear('logs_budget_exhausted'), clear('logs_budget_instance_exhausted'));
  }

  return outcomes;
}

/** Whether OpsWatch itself is working, because a silent collector looks exactly like a healthy estate. */
export function selfChecks(input: CheckupInput): CheckOutcome[] {
  const outcomes: CheckOutcome[] = [];
  outcomes.push(input.collector.neverRan ? finding('collector_never_ran', 'critical') : clear('collector_never_ran'));
  outcomes.push(
    input.collector.failingJobs.length > 0
      ? finding('collector_job_failing', 'warning', {
          jobs: [...input.collector.failingJobs].join(', '),
          count: input.collector.failingJobs.length,
        })
      : clear('collector_job_failing'),
  );

  if (input.template.version === null) {
    outcomes.push(notRun('template_outdated', 'not_collected'));
  } else {
    outcomes.push(
      input.template.version < input.template.current
        ? finding('template_outdated', 'info', { version: input.template.version, current: input.template.current })
        : clear('template_outdated'),
    );
  }
  return outcomes;
}

/**
 * The checks this build cannot yet run, declared rather than omitted.
 *
 * Each needs data OpsWatch does not collect today. Listing them is the difference between "your log groups
 * all have retention" and "nobody looked at your log groups", and the second is the true statement.
 */
export const NOT_COLLECTED_CHECKS = [
  'log_retention_missing',
  'log_group_share',
  'alarm_coverage',
  'pi_disabled',
  'container_insights',
  'idle_load_balancer',
] as const;

function pendingChecks(): CheckOutcome[] {
  return NOT_COLLECTED_CHECKS.map((id) => notRun(id, 'not_collected'));
}

/** Worst first, and within a severity the order the catalogue declared, which keeps the page stable. */
const SEVERITY_RANK: Record<CheckSeverity, number> = { critical: 0, warning: 1, info: 2 };

export type Checkup = {
  findings: Extract<CheckOutcome, { state: 'finding' }>[];
  /** Coverage, said plainly: a reader can see how much of the catalogue actually answered. */
  coverage: { ran: number; notRun: number; total: number };
  notRun: Extract<CheckOutcome, { state: 'not_run' }>[];
};

export function runCheckup(input: CheckupInput): Checkup {
  // Permissions first, for the reason in `permissionChecks`.
  const outcomes = [
    ...permissionChecks(input),
    ...coverageChecks(input),
    ...collectionChecks(input),
    ...selfChecks(input),
    ...pendingChecks(),
  ];

  const findings = outcomes.filter((outcome): outcome is Extract<CheckOutcome, { state: 'finding' }> => outcome.state === 'finding');
  const notRun = outcomes.filter((outcome): outcome is Extract<CheckOutcome, { state: 'not_run' }> => outcome.state === 'not_run');

  return {
    findings: findings
      .map((outcome, index) => ({ outcome, index }))
      .sort((a, b) => SEVERITY_RANK[a.outcome.severity] - SEVERITY_RANK[b.outcome.severity] || a.index - b.index)
      .map(({ outcome }) => outcome),
    coverage: { ran: outcomes.length - notRun.length, notRun: notRun.length, total: outcomes.length },
    notRun,
  };
}
