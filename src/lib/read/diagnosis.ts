import 'server-only';
import type { Db } from '../db/client';
import type { ProblemRow } from '../db/schema';
import { DEPLOYMENT_WINDOW_MS, correlateDeployments } from '../detect/correlate';
import { checksFor, impactFor, recoveryFor, ruleFor, type Check, type DetectionRule, type Impact, type Recovery } from '../detect/explain';
import { listDeploymentCommits } from '../store/deployment-commits';
import { listDeployments } from '../store/deployments';
import { recentErrorGroups } from '../store/errors';
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

export type Diagnosis = {
  rule: DetectionRule | null;
  impact: Impact;
  recovery: Recovery;
  checks: Check[];
};

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

  return {
    rule,
    // The score's own terms are where blast and user-facing live, and §33.7 already keeps `null` for
    // "not known" apart from `0` for "known to be none" — so the impact inherits that honesty for free.
    impact: impactFor(row.kind, row.values, row.scoreTerms),
    recovery: recoveryFor(rule),
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
