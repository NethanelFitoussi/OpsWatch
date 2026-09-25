import 'server-only';
import { DOCS, docPath } from '../docs/catalogue';
import type { Db } from '../db/client';
import { listConnections } from '../connections/repository';
import { subsectionPath, type ScopeRef } from '../monitoring/shared/paths';
import { rank, type SearchCandidate, type SearchResult } from '../search/rank';
import { listAlerts } from '../store/alerts';
import { listDeployments } from '../store/deployments';
import { recentErrorGroups } from '../store/errors';
import { listIncidents } from '../store/incidents';
import { pageProblems } from '../store/problems';
import { listRepositories } from '../store/repositories';
import { listSloDefinitions } from '../store/slos';
import { listChecks } from '../store/synthetics';

/**
 * What global search can actually find.
 *
 * **Only what OpsWatch holds.** Problems, errors, alerts, incidents, deployments, repositories, synthetic
 * checks, objectives, connections, its own pages and its own documentation are all in the database or in
 * a catalogue, so they are searched instantly and for nothing.
 *
 * Live infrastructure — ECS services, EC2 instances, Redis nodes, Kubernetes pods — is **not** indexed.
 * OpsWatch has no inventory of them; reading them means calling AWS, and calling AWS on every keystroke
 * would be a bill nobody agreed to. Rather than pretend, search offers a row per section that carries the
 * query into that section's own search. It is one keystroke further and it is honest about which it is.
 *
 * Scope is the caller's: an environment's rows are only ever read for the environment the operator is in.
 */

/** How many of each kind are considered. Search is navigation; it does not need the long tail. */
const PER_KIND = 200;
export const SEARCH_LIMIT = 20;

/** Renders the one-line context of a result, in the caller's locale. */
export type SearchLabels = {
  kind: (kind: string) => string;
  /** A problem or incident's headline, which lives in the message catalogue rather than the row. */
  headline: (titleKey: string, values: Record<string, string | number>) => string;
  severity: (severity: string) => string;
  sectionSearch: (section: string) => string;
  environment: string;
};

/** The sections whose own search can take a query. Each one is a page that really filters by it. */
const SECTION_SEARCHES: readonly { section: 'containers' | 'instances' | 'redis' | 'kubernetes' | 'logs'; subsection: string }[] = [
  { section: 'containers', subsection: 'services' },
  { section: 'instances', subsection: 'list' },
  { section: 'redis', subsection: 'nodes' },
  { section: 'kubernetes', subsection: 'workloads' },
  { section: 'logs', subsection: 'search' },
];

function candidates(db: Db, scope: ScopeRef, labels: SearchLabels, query: string): SearchCandidate[] {
  const env = { connectionId: scope.connectionId, scope: scope.region };
  const found: SearchCandidate[] = [];
  const context = (kind: string) => `${labels.kind(kind)} · ${labels.environment} · ${scope.region}`;

  for (const connection of listConnections(db)) {
    found.push({
      kind: 'connection',
      id: connection.id,
      title: connection.name,
      // The account or project it is, whichever this connection has. Never an empty gap where the
      // other cloud's identifier would be.
      context: `${labels.kind('connection')} · ${connection.awsAccountId ?? connection.gcpProjectId ?? ''}`,
      href: `/accounts/${connection.id}`,
      // An operator often remembers the account number rather than the name they gave it.
      terms: [connection.awsAccountId ?? connection.gcpProjectId ?? '', ...connection.regions],
    });
  }

  for (const problem of pageProblems(db, env, null, PER_KIND).items) {
    found.push({
      kind: 'problem',
      id: problem.id,
      title: problem.subjectName,
      context: context('problem'),
      state: labels.severity(problem.severity),
      href: `${subsectionPath(scope, 'overview', 'problems')}/${problem.id}`,
      terms: [labels.headline(problem.titleKey, problem.values), problem.kind, problem.subjectId],
    });
  }

  for (const group of recentErrorGroups(db, env, PER_KIND)) {
    found.push({
      kind: 'error',
      id: group.id,
      title: group.exceptionType ?? group.sampleMessage.slice(0, 80),
      context: context('error'),
      href: `/c/${scope.connectionId}/${scope.region}/errors/groups/${group.id}`,
      terms: [group.sampleMessage],
    });
  }

  for (const alert of listAlerts(db, scope.connectionId, scope.region, PER_KIND)) {
    found.push({
      kind: 'alert',
      id: alert.id,
      title: labels.headline(alert.titleKey, alert.values),
      context: context('alert'),
      state: labels.severity(alert.severity),
      href: subsectionPath(scope, 'overview', 'alerts'),
    });
  }

  for (const incident of listIncidents(db, scope.connectionId, scope.region, PER_KIND)) {
    found.push({
      kind: 'incident',
      id: incident.id,
      title: labels.headline(incident.titleKey, incident.values),
      context: context('incident'),
      state: labels.severity(incident.severity),
      href: `${subsectionPath(scope, 'overview', 'incidents')}/${incident.id}`,
    });
  }

  for (const deployment of listDeployments(db, env, PER_KIND)) {
    found.push({
      kind: 'deployment',
      id: deployment.id,
      title: deployment.serviceName,
      context: `${labels.kind('deployment')} · ${deployment.taskDefinition}`,
      href: `${subsectionPath(scope, 'containers', 'deployments')}/${deployment.id}`,
      terms: [deployment.cluster, deployment.taskDefinition],
    });
  }

  for (const repository of listRepositories(db)) {
    found.push({
      kind: 'repository',
      id: repository.id,
      title: `${repository.owner}/${repository.name}`,
      context: labels.kind('repository'),
      href: '/settings/repositories',
    });
  }

  for (const check of listChecks(db, scope.connectionId, scope.region)) {
    found.push({
      kind: 'synthetic',
      id: check.id,
      title: check.name,
      context: context('synthetic'),
      href: subsectionPath(scope, 'overview', 'synthetics'),
      terms: [check.url],
    });
  }

  for (const objective of listSloDefinitions(db, scope.connectionId, scope.region)) {
    found.push({
      kind: 'objective',
      id: objective.id,
      title: objective.name,
      context: context('objective'),
      href: subsectionPath(scope, 'load-balancers', 'objectives'),
    });
  }

  for (const guide of DOCS) {
    found.push({
      kind: 'doc',
      id: guide.slug,
      title: labels.headline(`Docs.guides.${guide.slug}.title`, {}),
      context: labels.kind('doc'),
      href: docPath(guide.slug),
      terms: guide.keywords,
    });
  }

  // The offer, never a claim: OpsWatch has no inventory of live resources, so this carries the query into
  // the section that can ask AWS for it.
  for (const { section, subsection } of SECTION_SEARCHES) {
    found.push({
      kind: 'sectionSearch',
      id: `${section}/${subsection}`,
      title: labels.sectionSearch(section),
      context: `${labels.environment} · ${scope.region}`,
      href: `${subsectionPath(scope, section, subsection)}?q=${encodeURIComponent(query)}`,
      // Every word matches, so the row is always offered once something else has been ruled out.
      terms: [query],
    });
  }

  return found;
}

export function search(db: Db, scope: ScopeRef, query: string, labels: SearchLabels, limit = SEARCH_LIMIT): SearchResult[] {
  return rank(candidates(db, scope, labels, query), query, limit);
}
