import 'server-only';
import type { ProblemSeverity } from '../db/schema';
import { listConnections } from '../connections/repository';
import type { Provider } from '../connections/types';
import type { Db } from '../db/client';
import { countLiveProblemsByConnection, findProblemById, listEvidence, listLiveProblemsAcross } from '../store/problems';
import type { ProblemRow } from '../db/schema';
import type { Evidence } from '@opswatch/contract';
import { toEvidence, type Render } from './problems';

/**
 * What is wrong anywhere, across every connection this installation has (§G).
 *
 * The monitoring rail answers "what is wrong in this account and this region", which is the right
 * question once you know where to look. An operator with three AWS accounts and a Google project has
 * a different one — "what is wrong at all" — and answering it by visiting each environment in turn
 * means the answer depends on where they happened to start.
 *
 * **Provider identity is carried, not flattened.** Every row says which cloud produced it and which
 * connection, because "the payments database is at 98 % CPU" and "Google has an open incident on
 * checkout" are not interchangeable facts, and an operator fixes them in different places. A unified
 * view that dropped the cloud would be a list nobody could act on.
 */

/** How many problems are open, per cloud. Every connected provider is present, so a zero is stated. */
export type ProblemCounts = { total: number; byProvider: Record<Provider, number> };

export type CrossProblem = {
  id: string;
  title: string;
  severity: ProblemSeverity;
  /** Which cloud produced the evidence. From the problem row, not from the connection: they are the
   *  same today and the row is what was true when the problem was written. */
  provider: string;
  connectionId: string;
  connectionName: string;
  /** A region, a project or an account, depending on the cloud. The page says which it is. */
  scope: string;
  subject: string;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Where to go, when there is somewhere: the rail exists for AWS and not yet for the others. */
  href: string | null;
};

/**
 * One problem, from anywhere, in the terms every cloud shares.
 *
 * Deliberately a *subset* of what the AWS section page shows. That page has the diagnosis, the
 * investigation and the workspace, all of which read AWS-shaped rows, and cloning it under generic
 * names for the sake of symmetry is the failure this whole piece of work exists to avoid. What is
 * here is what a problem row and its evidence actually carry, whichever cloud produced them — and
 * that is enough to answer what happened, how bad, since when, and on what grounds.
 */
export type CrossProblemDetail = CrossProblem & {
  status: string;
  occurrences: number;
  score: number;
  scoreTerms: ProblemRow['scoreTerms'];
  evidence: Evidence[];
  kind: string;
  /** Null unless this is an AWS problem, which has a fuller page of its own in the section rail. */
  sectionHref: string | null;
};

export function readProblemAcross(db: Db, id: string, context: { nowMs: number; render: Render }): CrossProblemDetail | null {
  const row = findProblemById(db, id);
  if (row === null) return null;
  const connection = listConnections(db).find((entry) => entry.id === row.connectionId) ?? null;
  const provider = connection?.provider ?? null;

  return {
    id: row.id,
    title: context.render(row.titleKey, row.values),
    severity: row.severity,
    provider: row.source,
    connectionId: row.connectionId,
    connectionName: connection?.name ?? '',
    scope: row.scope,
    subject: row.subjectName,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    href: usableHref(provider, row.href),
    status: row.status,
    occurrences: row.occurrences,
    score: row.score,
    scoreTerms: row.scoreTerms,
    evidence: listEvidence(db, row.id).map((item) => toEvidence(item, context)),
    kind: row.kind,
    // The section page, which is AWS's and has more on it. Offered rather than duplicated.
    sectionHref: provider === 'aws' ? `/c/${row.connectionId}/${row.scope}/overview/problems/${row.id}` : null,
  };
}

/**
 * The link on a problem, when following it would land somewhere that exists.
 *
 * `href` is a monitoring-rail path for AWS rows and the provider's own page for the others. The rail
 * resolves for AWS and nothing else, so a rail path on a non-AWS row is refused rather than followed
 * — that would open a page about a service that cloud does not have.
 */
const usableHref = (provider: string | null, href: string): string | null => {
  if (href === '') return null;
  if (provider === 'aws') return href;
  return href.startsWith('/c/') ? null : href;
};

/** The most a single page shows. Past it the page says so rather than implying it is everything. */
export const ACROSS_LIMIT = 100;

export type AcrossQuery = { providers?: readonly Provider[]; severities?: readonly ProblemSeverity[] };

export function readProblemsAcross(
  db: Db,
  query: AcrossQuery,
  context: { nowMs: number; render: Render },
): { problems: CrossProblem[]; counts: ProblemCounts; truncated: boolean } {
  const connections = listConnections(db);
  const byId = new Map(connections.map((row) => [row.id, row]));

  // Counted from every open problem, never from the filtered list: a count that changed when you
  // filtered would be answering a different question from the one it appears to answer.
  const byProvider = { aws: 0, gcp: 0, do: 0 } as Record<Provider, number>;
  let total = 0;
  for (const row of countLiveProblemsByConnection(db)) {
    const provider = byId.get(row.connectionId)?.provider;
    if (provider === undefined) continue;
    byProvider[provider] += row.total;
    total += row.total;
  }

  const rows = listLiveProblemsAcross(
    db,
    {
      ...(query.providers === undefined
        ? {}
        : // Resolved to connection ids here rather than filtered on `source` in SQL, because `source`
          // is what wrote the row and a connection is what an operator picked. They agree today, and
          // the one an operator means is the connection.
          { connectionIds: connections.filter((row) => query.providers?.includes(row.provider)).map((row) => row.id) }),
      ...(query.severities === undefined ? {} : { severities: query.severities }),
    },
    ACROSS_LIMIT + 1,
  );

  const problems = rows.slice(0, ACROSS_LIMIT).map((row): CrossProblem => {
    const connection = byId.get(row.connectionId);
    return {
      id: row.id,
      title: context.render(row.titleKey, row.values),
      severity: row.severity,
      provider: row.source,
      connectionId: row.connectionId,
      // A connection that has gone is named as gone rather than as an empty string, which would read
      // as a problem belonging to nothing.
      connectionName: connection?.name ?? '',
      scope: row.scope,
      subject: row.subjectName,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      // `href` is a monitoring-rail path, and the rail is AWS's. A link into it for a Google problem
      // would be a link to a page about a service that cloud does not have.
      href: usableHref(connection?.provider ?? null, row.href),
    };
  });

  return { problems, counts: { total, byProvider }, truncated: rows.length > ACROSS_LIMIT };
}
