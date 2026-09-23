import 'server-only';
import type { Db } from '../db/client';
import type { ProblemRow } from '../db/schema';
import { DEPLOYMENT_WINDOW_MS, correlateDeployments } from '../detect/correlate';
import { causesFor, checksFor, impactFor, recoveryFor, ruleFor, type Check, type DetectionRule, type Impact, type Recovery } from '../detect/explain';
import { listDeploymentCommits } from '../store/deployment-commits';
import { listDeployments } from '../store/deployments';
import { recentErrorGroups } from '../store/errors';
import { listEvents } from '../store/events';
import { readHistoryRange } from '../store/history';
import { readHistorySettings } from '../history/settings';
import { subsectionPath } from '../monitoring/shared/paths';

/**
 * Everything a reader needs to understand one problem, gathered in one place.
 *
 * The intelligence OpsWatch has built — deployment correlation, repository evidence, error groups, the
 * detector's own rule — has lived on separate pages. This is where it converges, because the moment
 * somebody wants all of it is the moment they are looking at the problem.
 *
 * **Read-only and stored-only.** Every part comes from rows the collector already wrote, so opening a
 * problem costs nothing and answers the same way twice.
 */

/** How near an error group has to be to the problem's start to be worth showing beside it (§7). */
const ERROR_WINDOW_MS = 15 * 60_000;
/** How many of each kind of evidence a page carries. A diagnosis is a short list, not a search result. */
const LIMIT = 5;

/** One thing that happened to this problem, for the timeline a reader can see at a glance. */
export type LifecycleMark = { at: number; kind: 'opened' | 'reopened' | 'resolved' | 'deployment' };

/**
 * The measured signal behind a problem, where it was stored.
 *
 * `null` when historical collection is off — which is the common case and is said on the page rather than
 * drawn as an empty chart. An empty chart and "we did not collect this" look identical and mean opposite
 * things.
 */
export type ProblemSeries = { metric: string; timestamps: number[]; values: number[] };

export type Diagnosis = {
  rule: DetectionRule | null;
  impact: Impact;
  recovery: Recovery;
  checks: Check[];
  /**
   * What commonly makes this rule fire — possibilities, kept apart from everything else here because
   * everything else here was measured and these were not.
   */
  causes: readonly string[];
  /** Open, reopen, resolve and the deployments near them, oldest first. */
  timeline: LifecycleMark[];
  /** The stored rollups for this subject, or an empty list when there are none to draw. */
  series: ProblemSeries[];
  /** Whether history is collected at all, so an empty chart can say which kind of empty it is. */
  historyEnabled: boolean;
};

/** Which stored metrics are worth drawing beside each detector family. */
const SERIES_FOR: Record<string, readonly string[]> = {
  alb_5xx_rate: ['requests', 'elb5xx', 'target5xx'],
  alb_elb_5xx_count: ['elb5xx', 'requests'],
  alb_unhealthy_hosts: ['requests'],
};

/** How much history a problem's chart shows: its own life, plus an hour of lead-in. */
const CHART_LEAD_MS = 60 * 60_000;

/**
 * A function of the stored row alone — no clock.
 *
 * That is a property worth keeping: the diagnosis of a problem does not change because somebody opened the
 * page twice, and a reader comparing two screenshots is comparing the same answer.
 */
export function readDiagnosis(db: Db, row: ProblemRow): Diagnosis {
  const scope = { connectionId: row.connectionId, scope: row.scope };
  const subjectHref = row.href === null || row.href === '' ? null : row.href;

  const deployments = correlateDeployments(
    listDeployments(
      db,
      {
        ...scope,
        ...(row.serviceId === null ? {} : { serviceId: row.serviceId }),
        sinceMs: row.firstSeenAt - DEPLOYMENT_WINDOW_MS,
        untilMs: row.firstSeenAt + 1,
      },
      LIMIT * 2,
    ),
    { serviceId: row.serviceId, firstSeenAt: row.firstSeenAt },
  )
    .slice(0, LIMIT)
    .map((correlated) => {
      const commits = listDeploymentCommits(db, correlated.deployment.id);
      const files = new Set(commits.flatMap((commit) => commit.files.map((file) => file.path)));
      return {
        id: correlated.deployment.deploymentId,
        label: correlated.deployment.taskDefinition,
        minutesBefore: correlated.minutesBefore,
        href: subsectionPath({ connectionId: row.connectionId, region: row.scope }, 'containers', 'deployments', correlated.deployment.deploymentId),
        // Null rather than zero when nobody fetched the commits: "no files changed" is a claim.
        filesChanged: commits.length === 0 ? null : files.size,
        changesHref: subsectionPath({ connectionId: row.connectionId, region: row.scope }, 'containers', 'deployments', correlated.deployment.deploymentId),
      };
    });

  // Error groups that appeared or came back around the time the problem opened. Not "errors on this
  // service" — the relation is temporal, and the card that shows them says so.
  const errorGroups = recentErrorGroups(db, { ...scope, sinceMs: row.firstSeenAt - ERROR_WINDOW_MS }, LIMIT)
    .filter((group) => Math.abs(group.statusSince - row.firstSeenAt) <= ERROR_WINDOW_MS)
    .map((group) => ({
      id: group.id,
      message: group.sampleMessage.slice(0, 120),
      href: subsectionPath({ connectionId: row.connectionId, region: row.scope }, 'errors', 'groups', group.id),
    }));

  const rule = ruleFor(row.kind, row.values, row.severity);

  // The lifecycle, from the events spine: when it opened, when it came back, when it stopped. Always
  // available, because the spine is written whether or not historical collection is on.
  const marks: LifecycleMark[] = listEvents(
    db,
    { ...scope, sinceMs: row.firstSeenAt - CHART_LEAD_MS, untilMs: (row.resolvedAt ?? row.lastSeenAt) + 60_000 },
    null,
    50,
  )
    .items.flatMap((event): LifecycleMark[] => {
      if (event.payload.problemId !== row.id && event.subjectId !== row.subjectId) return [];
      if (event.kind === 'problem_opened') return [{ at: event.at, kind: 'opened' }];
      if (event.kind === 'problem_reopened') return [{ at: event.at, kind: 'reopened' }];
      if (event.kind === 'problem_resolved') return [{ at: event.at, kind: 'resolved' }];
      if (event.kind.startsWith('deployment_')) return [{ at: event.at, kind: 'deployment' }];
      return [];
    })
    .sort((a, b) => a.at - b.at);

  const historyEnabled = readHistorySettings(db).enabled;
  const from = row.firstSeenAt - CHART_LEAD_MS;
  const to = (row.resolvedAt ?? row.lastSeenAt) + 60_000;
  const series = (historyEnabled ? (SERIES_FOR[row.kind] ?? []) : []).flatMap((metric): ProblemSeries[] => {
    const points = readHistoryRange(
      db,
      { category: 'metric', ...scope, subjectId: row.subjectId, metric, resolution: '5m' },
      from,
      to,
    ).filter((point) => point.value !== null);
    // A series with nothing in it is not drawn: an empty line implies a measurement of zero.
    return points.length === 0 ? [] : [{ metric, timestamps: points.map((p) => p.intervalStart), values: points.map((p) => p.value as number) }];
  });

  return {
    timeline: marks,
    series,
    historyEnabled,
    rule,
    // The score's own terms are where blast and user-facing live, and §33.7 already keeps `null` for
    // "not known" apart from `0` for "known to be none" — so the impact inherits that honesty for free.
    impact: impactFor(row.kind, row.values, row.scoreTerms),
    recovery: recoveryFor(rule),
    causes: causesFor(row.kind),
    checks: checksFor({
      kind: row.kind,
      values: row.values,
      deployments,
      errorGroups,
      // Only the unhealthy-hosts detector measures this, and only about its own subject.
      unhealthyTargets: row.kind === 'alb_unhealthy_hosts' && typeof row.values.count === 'number' ? row.values.count : null,
      subjectHref,
    }),
  };
}
