import 'server-only';
import type { Report, ReportFigure, ReportPeriod, ReportRow, ReportSection, ReportUnavailableReason } from '@opswatch/contract';
import { PROBLEM_SEVERITIES, type ProblemSeverity } from '../db/schema';
import type { Db } from '../db/client';
import { PROBLEM_FAMILIES, kindsOfFamily, type ProblemFamily } from '../detect/family';
import { albBucket, evaluateSlo, type Bucket } from '../detect/slo';
import { readHistorySettings } from '../history/settings';
import { countDeployments, listDeployments } from '../store/deployments';
import { countOccurrences, enabledLogSources, recentErrorGroups } from '../store/errors';
import { BYTES_PER_GB, usageBetween } from '../store/logs-budget';
import { listChecks, runsBetween } from '../store/synthetics';
import { listHistorySubjects, readHistoryRange } from '../store/history';
import { objectiveFor } from '../store/slos';
import { successShare } from './synthetics';
import { countProblemsInWindow, worstSubjectsInWindow } from '../store/problems';

/**
 * A report over a period, next to the period before it (**§19**).
 *
 * Two rules decide everything in here.
 *
 * **It reads stored rollups and never AWS.** That is what makes a report cheap, repeatable and comparable:
 * running the same report twice costs nothing and gives the same answer, and nobody's bill moves because
 * somebody refreshed a page.
 *
 * **A half it cannot answer says which half and why.** With historical collection off there is genuinely
 * nothing to say about availability, and the honest output is that sentence — not a zero, and not an empty
 * section left for the reader to interpret (§2.6). Each section therefore ends up with either real figures
 * or a named `unavailable` reason, never both and never neither.
 */

export const PERIOD_MS: Record<ReportPeriod, number> = {
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

/** The resolution the metrics job writes, and therefore the one a report reads back. */
const HISTORY_RESOLUTION = '5m';
const HISTORY_RESOLUTION_MS = 5 * 60_000;

/** §19's default availability objective, used where no SLO has been defined for a service yet. */
export const DEFAULT_AVAILABILITY_OBJECTIVE = 0.999;

/** How many rows a report lists per section. A report is a summary; the section pages are where the rest is. */
export const REPORT_ROW_LIMIT = 5;

/** Which detector family each monitoring section reports on. */
export const SECTION_FAMILY: Record<string, ProblemFamily> = {
  containers: 'ecs',
  databases: 'rds',
  'load-balancers': 'alb',
  alarms: 'alarms',
};

export type ReportQuery = { connectionId: string; scope: string; section: string; period: ReportPeriod };
export type ReportContext = {
  nowMs: number;
  /**
   * Turns a detector's stored key and values into the sentence it wrote.
   *
   * Optional, and the subject's own name when it is not given — a machine reading `/api/v1/reports` is
   * entitled to identifiers, and a page is not. Without it a report listed the AWS alarm name as the
   * thing that happened, which is the identifier an operator should never have to read.
   */
  render?: (key: string, values: Record<string, string | number>) => string;
  /**
   * How a detector family is named for a reader. Optional, and the id itself when it is not given: a read
   * module has no locale of its own, and a report exported by a machine is entitled to the raw ids.
   */
  familyLabel?: (family: ProblemFamily) => string;
};

/**
 * The two windows a report compares. The previous one is the same length immediately before, so "against the
 * week before" means exactly that rather than "against some earlier week".
 */
export function windowsFor(period: ReportPeriod, nowMs: number): { period: { from: number; to: number }; previous: { from: number; to: number } } {
  const length = PERIOD_MS[period];
  return {
    period: { from: nowMs - length, to: nowMs },
    previous: { from: nowMs - 2 * length, to: nowMs - length },
  };
}

/** A figure with its comparison. `delta` stays null unless both sides are known — an unknown is not a zero. */
export function figure(id: string, value: number | null, previous: number | null, severity?: ProblemSeverity): ReportFigure {
  return {
    id,
    value,
    previous,
    delta: value === null || previous === null ? null : value - previous,
    ...(severity === undefined ? {} : { severity }),
  };
}

function unavailableSection(id: string, reason: ReportUnavailableReason): ReportSection {
  return { id, figures: [], rows: [], unavailable: reason };
}

/**
 * Problems opened and resolved, by severity.
 *
 * This section needs no history switch: `detect` runs on data the pages already fetched, so an installation
 * that has been running at all has these numbers. It is the half of a report that is real today.
 */
function problemsSection(db: Db, query: ReportQuery, family: ProblemFamily | null, windows: ReturnType<typeof windowsFor>, context: ReportContext): ReportSection {
  // `undefined` rather than every kind concatenated: the store reads it as "no kind filter", and an
  // estate-wide report must count a problem from a detector nobody has thought to add to a family yet.
  const kinds = family === null ? undefined : kindsOfFamily(family);
  const filter = { connectionId: query.connectionId, scope: query.scope, kinds };
  const now = countProblemsInWindow(db, filter, windows.period);
  const before = countProblemsInWindow(db, filter, windows.previous);

  const total = (counts: Record<ProblemSeverity, number>) => PROBLEM_SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);
  const figures: ReportFigure[] = [
    figure('opened', total(now.opened), total(before.opened)),
    figure('resolved', total(now.resolved), total(before.resolved)),
    // Per severity, because "14 opened" reads very differently when all fourteen were critical.
    //
    // `openedCritical`, not `opened.critical`: a figure id becomes a message key, and next-intl reads a dot
    // as a path separator — so `figure.opened.critical` looked for a child of the string `figure.opened`,
    // found nothing, and printed `Monitoring.report.figure.opened.critical` onto four report pages.
    ...PROBLEM_SEVERITIES.map((severity) =>
      figure(`opened${severity[0].toUpperCase()}${severity.slice(1)}`, now.opened[severity], before.opened[severity], severity),
    ),
  ];

  const previousBySubject = new Map(
    worstSubjectsInWindow(db, filter, windows.previous, REPORT_ROW_LIMIT * 4).map((row) => [row.subjectId, row.total]),
  );
  const rows: ReportRow[] = worstSubjectsInWindow(db, filter, windows.period, REPORT_ROW_LIMIT).map((row) => {
    // A subject absent from the previous window opened nothing then, which is a real zero rather than unknown.
    const previous = previousBySubject.get(row.subjectId) ?? 0;
    const sentence = context.render?.(row.titleKey, row.values);
    return {
      id: row.subjectId,
      // What happened, with what it happened to underneath. Never the identifier as the headline.
      label: sentence ?? row.subjectName,
      ...(sentence === undefined ? {} : { detail: row.subjectName }),
      value: row.total,
      previous,
      delta: row.total - previous,
      severity: row.severity,
      // The problem itself, so a reader can open the thing the sentence is about.
      ref: { type: 'problem' as const, id: row.problemId, label: row.subjectName },
    };
  });

  return { id: 'problems', figures, rows, unavailable: null };
}

/**
 * Top error groups. Present only when something is actually reading logs — with no enabled log source the
 * answer is `not_collected`, which is a different sentence from "no errors".
 */
function errorsSection(db: Db, query: ReportQuery, windows: ReturnType<typeof windowsFor>): ReportSection {
  if (enabledLogSources(db, query.connectionId, query.scope).length === 0) {
    return unavailableSection('errors', 'not_collected');
  }

  const groups = recentErrorGroups(
    db,
    { connectionId: query.connectionId, scope: query.scope, sinceMs: windows.period.from },
    REPORT_ROW_LIMIT,
  );
  const rows: ReportRow[] = groups.map((group) => {
    const now = countOccurrences(db, group.id, windows.period).count;
    const before = countOccurrences(db, group.id, windows.previous).count;
    return {
      id: group.id,
      label: group.sampleMessage,
      value: now,
      previous: before,
      delta: now - before,
      ref: { type: 'error' as const, id: group.id },
    };
  });

  const sum = (pick: (row: ReportRow) => number | null) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  return {
    id: 'errors',
    figures: [figure('occurrences', sum((row) => row.value), sum((row) => row.previous)), figure('groups', rows.length, null)],
    rows,
    unavailable: null,
  };
}

/**
 * Availability, from stored metric rollups (§19).
 *
 * What is measured here is the share of 5-minute intervals in which the family reported **no affected
 * resource**. That is a bucket-based approximation, exactly as §19 accepts for latency and for the same
 * reason — a read-only account gives no per-request histogram — and the page says so in one sentence rather
 * than presenting it as a request-level SLA.
 *
 * The rollups only exist once an operator turns historical collection on, so the usual answer on a fresh
 * installation is `history_off`: a decision to make, not a fault to fix.
 */
function availabilitySection(
  db: Db,
  query: ReportQuery,
  family: ProblemFamily,
  windows: ReturnType<typeof windowsFor>,
): ReportSection {
  if (!readHistorySettings(db).enabled) return unavailableSection('availability', 'history_off');

  const series = {
    category: 'metric' as const,
    connectionId: query.connectionId,
    scope: query.scope,
    subjectId: family,
    metric: 'affected',
    resolution: HISTORY_RESOLUTION,
  };
  const now = readHistoryRange(db, series, windows.period.from, windows.period.to);
  // On, but the window asked for is not covered. §19: never a number it cannot stand behind.
  if (now.length === 0) return unavailableSection('availability', 'not_enough_history');
  const before = readHistoryRange(db, series, windows.previous.from, windows.previous.to);

  // An interval whose value could not be measured is left out of both halves rather than counted as healthy.
  const share = (rows: readonly { value: number | null }[]): number | null => {
    const measured = rows.filter((row) => row.value !== null);
    if (measured.length === 0) return null;
    return (measured.filter((row) => row.value === 0).length / measured.length) * 100;
  };

  const figures: ReportFigure[] = [
    figure('healthyShare', share(now), share(before)),
    figure('intervals', now.length, before.length),
  ];

  // Real request-level availability, where the metrics job has stored it (§19). This is the number that is
  // *not* an approximation, so it is offered alongside the bucket share rather than replacing it.
  const slo = requestAvailability(db, query, windows);
  const rows: ReportRow[] = [];
  if (slo !== null) {
    figures.push(figure('availability', slo.current === null ? null : slo.current * 100, null));
    figures.push(figure('errorBudget', slo.budgetRemaining === null ? null : slo.budgetRemaining * 100, null));
    rows.push(...slo.rows);
  }

  return { id: 'availability', figures, rows, unavailable: null };
}

/**
 * Availability per load balancer, computed by §19's arithmetic over the rollups the metrics job stored.
 *
 * Null when nothing has been stored for any load balancer, so the section falls back to the bucket share
 * rather than showing an empty table that looks like "no load balancers".
 */
function requestAvailability(
  db: Db,
  query: ReportQuery,
  windows: ReturnType<typeof windowsFor>,
): { current: number | null; budgetRemaining: number | null; rows: ReportRow[] } | null {
  const subjects = listHistorySubjects(db, {
    category: 'metric',
    connectionId: query.connectionId,
    scope: query.scope,
    metric: 'requests',
    resolution: HISTORY_RESOLUTION,
    fromMs: windows.period.from,
    toMs: windows.period.to,
  });
  if (subjects.length === 0) return null;

  const expected = Math.max(1, Math.round((windows.period.to - windows.period.from) / HISTORY_RESOLUTION_MS));
  const rows: ReportRow[] = [];
  const all: Bucket[] = [];

  for (const subjectId of subjects.slice(0, REPORT_ROW_LIMIT)) {
    const read = (metric: string) =>
      new Map(
        readHistoryRange(
          db,
          { category: 'metric', connectionId: query.connectionId, scope: query.scope, subjectId, metric, resolution: HISTORY_RESOLUTION },
          windows.period.from,
          windows.period.to,
        ).map((row) => [row.intervalStart, row.value]),
      );

    const requests = read('requests');
    const elb = read('elb5xx');
    const target = read('target5xx');
    const buckets = [...requests.keys()].map((at) => albBucket(requests.get(at) ?? null, elb.get(at) ?? null, target.get(at) ?? null));
    all.push(...buckets);

    // The objective an operator defined for this subject, where there is one. Without a definition the
    // figure is measured against §19's default, which is the tool's suggestion rather than their target.
    const defined = objectiveFor(db, query.connectionId, query.scope, subjectId);
    const result = evaluateSlo(buckets, defined?.objective ?? DEFAULT_AVAILABILITY_OBJECTIVE, expected);
    rows.push({
      id: subjectId,
      label: subjectId,
      value: result.current === null ? null : result.current * 100,
      previous: null,
      delta: null,
      // Breached is the one an operator has to act on, so it is the one carrying a severity.
      ...(result.status === 'breached' ? { severity: 'critical' as const } : {}),
      ref: { type: 'infrastructure' as const, id: subjectId, label: subjectId },
    });
  }

  // The environment figure stays on the default: pooling subjects that were given different objectives
  // into one ratio would measure them against a target nobody set. The per-subject rows carry theirs.
  const overall = evaluateSlo(all, DEFAULT_AVAILABILITY_OBJECTIVE, expected * Math.max(1, subjects.length));
  return { current: overall.current, budgetRemaining: overall.budgetRemaining, rows };
}

/**
 * What shipped in the period, and how much of it failed.
 *
 * The collector only remembers deployments from the moment it first ran, so a report over a window that
 * predates it would show a suspiciously quiet week. `not_collected` covers that: an environment the
 * deployments job has never recorded anything for is not an environment where nothing shipped.
 */
function deploymentsSection(db: Db, query: ReportQuery, windows: ReturnType<typeof windowsFor>): ReportSection {
  const filter = { connectionId: query.connectionId, scope: query.scope };
  // Nothing recorded at all means the job has not run here, which is different from a quiet period.
  if (countDeployments(db, filter).total === 0) return unavailableSection('deployments', 'not_collected');

  const now = countDeployments(db, { ...filter, sinceMs: windows.period.from, untilMs: windows.period.to });
  const before = countDeployments(db, { ...filter, sinceMs: windows.previous.from, untilMs: windows.previous.to });

  const rows: ReportRow[] = listDeployments(db, { ...filter, sinceMs: windows.period.from, untilMs: windows.period.to }, REPORT_ROW_LIMIT).map(
    (row) => ({
      id: row.deploymentId,
      label: `${row.serviceName} · ${row.taskDefinition}`,
      // A deployment is one event, so the figure that means something about it is whether it failed.
      value: row.status === 'failed' ? 1 : 0,
      previous: null,
      delta: null,
      ...(row.status === 'failed' ? { severity: 'critical' as const } : {}),
      ref: { type: 'deployment' as const, id: row.deploymentId, label: row.serviceName },
    }),
  );

  return {
    id: 'deployments',
    figures: [figure('deployments', now.total, before.total), figure('deploymentsFailed', now.failed, before.failed)],
    rows,
    unavailable: null,
  };
}

/**
 * What OpsWatch's own checks saw over the period (§14, REP-5).
 *
 * `not_collected` when no check is configured — "nobody set one up" and "everything passed" are different
 * answers, and the second is the one a blank section would be read as. Once checks exist the section is
 * answered even if none of them ran in the window: each says `null`, which the page renders as "not
 * measured" beside the check's name, rather than the whole section disappearing behind one sentence.
 */
function syntheticsSection(db: Db, query: ReportQuery, windows: ReturnType<typeof windowsFor>): ReportSection {
  const checks = listChecks(db, query.connectionId, query.scope);
  if (checks.length === 0) return unavailableSection('synthetics', 'not_collected');

  const runsIn = (checkId: string, window: { from: number; to: number }) => runsBetween(db, checkId, window.from, window.to);

  const now = checks.flatMap((check) => runsIn(check.id, windows.period));
  const before = checks.flatMap((check) => runsIn(check.id, windows.previous));
  const share = (runs: readonly { ok: boolean }[]) => {
    const value = successShare(runs);
    return value === null ? null : value * 100;
  };

  const rows: ReportRow[] = checks.slice(0, REPORT_ROW_LIMIT).map((check) => {
    const value = share(runsIn(check.id, windows.period));
    const previous = share(runsIn(check.id, windows.previous));
    return {
      id: check.id,
      label: check.name,
      value,
      previous,
      delta: value === null || previous === null ? null : value - previous,
      // A check that failed at all in the period is the one worth looking at first.
      ...(value !== null && value < 100 ? { severity: 'warning' as const } : {}),
    };
  });

  return {
    id: 'synthetics',
    figures: [
      figure('syntheticUptime', share(now), share(before)),
      // A count rather than a share, because "two failures" is what somebody goes looking for.
      figure('syntheticFailures', now.filter((run) => !run.ok).length, before.filter((run) => !run.ok).length),
      figure('syntheticRuns', now.length, before.length),
    ],
    rows,
    unavailable: null,
  };
}

/**
 * How each family fared, side by side (the Overview report).
 *
 * One row per family rather than one figure per family, so the reader sees the same shape they see
 * everywhere else: this period, the one before, and the difference. A family with nothing in either window
 * is still listed at zero — that is a measured zero, because `detect` ran over all of them.
 */
function familiesSection(db: Db, query: ReportQuery, windows: ReturnType<typeof windowsFor>, context: ReportContext): ReportSection {
  const rows: ReportRow[] = PROBLEM_FAMILIES.map((family) => {
    const filter = { connectionId: query.connectionId, scope: query.scope, kinds: kindsOfFamily(family) };
    const total = (counts: Record<ProblemSeverity, number>) => PROBLEM_SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);
    const now = total(countProblemsInWindow(db, filter, windows.period).opened);
    const before = total(countProblemsInWindow(db, filter, windows.previous).opened);
    return { id: family, label: context.familyLabel?.(family) ?? family, value: now, previous: before, delta: now - before };
  });
  return { id: 'families', figures: [], rows, unavailable: null };
}

/**
 * What searching logs cost, and what that cost stopped (the Logs report).
 *
 * **For the whole connected account, not one region.** `logs_usage` is keyed by the UTC day and the
 * account, because the bill and the budget share belong to the account rather than to one of its regions.
 * Splitting it per region here would be inventing a split the data does not hold, so the figure is
 * reported as what it is.
 *
 * `stoppedDays` is the figure that matters most and is the easiest to miss: on a day the hard stop was
 * reached, error collection did not run for the rest of it. Errors look quiet on such a day, and quiet is
 * exactly what an operator must not read as calm.
 */
function logsSpendSection(db: Db, query: ReportQuery, windows: ReturnType<typeof windowsFor>): ReportSection {
  const now = usageBetween(db, query.connectionId, windows.period);
  const before = usageBetween(db, query.connectionId, windows.previous);
  // Nothing recorded in either window means no query has ever run, not a spend of zero gigabytes.
  if (now.days === 0 && before.days === 0) return unavailableSection('logsSpend', 'not_collected');

  const gb = (bytes: number) => Math.round((bytes / BYTES_PER_GB) * 1000) / 1000;
  return {
    id: 'logsSpend',
    figures: [
      figure('gbScanned', gb(now.bytesScanned), gb(before.bytesScanned)),
      figure('queriesRun', now.queries, before.queries),
      figure('budgetStops', now.stoppedDays, before.stoppedDays, now.stoppedDays > 0 ? 'warning' : undefined),
    ],
    rows: [],
    unavailable: null,
  };
}

/**
 * Which log groups OpsWatch is reading errors out of.
 *
 * Not a period figure and it does not pretend to be one: `previous` is null everywhere, so no delta is
 * shown. It is here because the first question a quiet errors section raises is "was anything even being
 * read", and this is the section that answers it.
 */
function logSourcesSection(db: Db, query: ReportQuery): ReportSection {
  const sources = enabledLogSources(db, query.connectionId, query.scope);
  if (sources.length === 0) return unavailableSection('logSources', 'not_collected');
  return {
    id: 'logSources',
    figures: [figure('enabledSources', sources.length, null)],
    rows: sources.slice(0, REPORT_ROW_LIMIT).map((source) => ({
      id: source.logGroup,
      label: source.logGroup,
      value: null,
      previous: null,
      delta: null,
    })),
    unavailable: null,
  };
}

/** The sections a report may be asked for. A closed list: an unknown one is refused, never reported on. */
export const REPORT_SECTIONS = ['overview', 'containers', 'databases', 'load-balancers', 'alarms', 'logs'] as const;
export type ReportSectionId = (typeof REPORT_SECTIONS)[number];

export function isReportSection(value: string): value is ReportSectionId {
  return (REPORT_SECTIONS as readonly string[]).includes(value);
}

export function readReport(db: Db, query: ReportQuery, context: ReportContext): Report {
  const family = SECTION_FAMILY[query.section] ?? null;
  const windows = windowsFor(query.period, context.nowMs);
  const sections: ReportSection[] = [];

  // A section nobody reports on gets a stated reason rather than an estate-wide report under the wrong
  // name. `overview` genuinely has no family and is still a real report, so the guard is the closed list
  // of sections rather than the absence of a family.
  if (!isReportSection(query.section)) {
    return {
      generatedAt: context.nowMs,
      section: query.section,
      period: { id: query.period, ...windows.period },
      previousPeriod: windows.previous,
      sections: [unavailableSection('problems', 'not_measured')],
    };
  }

  if (query.section === 'logs') {
    // A logs report is about what was read out of logs and what reading them cost — not about one
    // infrastructure family, which it has none of.
    sections.push(errorsSection(db, query, windows), logSourcesSection(db, query), logsSpendSection(db, query, windows));
    return { generatedAt: context.nowMs, section: query.section, period: { id: query.period, ...windows.period }, previousPeriod: windows.previous, sections };
  }

  // `overview` reports on the whole estate: every problem, whatever family its detector belongs to.
  sections.push(problemsSection(db, query, family, windows, context));
  if (query.section === 'overview') sections.push(familiesSection(db, query, windows, context));
  sections.push(errorsSection(db, query, windows));
  // Availability is measured per family, so the estate-wide report has no single number to give and says so
  // rather than averaging four families into one figure nobody could act on.
  sections.push(family === null ? unavailableSection('availability', 'not_measured') : availabilitySection(db, query, family, windows));
  sections.push(deploymentsSection(db, query, windows));
  sections.push(syntheticsSection(db, query, windows));

  return {
    generatedAt: context.nowMs,
    section: query.section,
    period: { id: query.period, ...windows.period },
    previousPeriod: windows.previous,
    sections,
  };
}
