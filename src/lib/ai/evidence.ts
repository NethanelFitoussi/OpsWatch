import 'server-only';
import type { Ref } from '@opswatch/contract';
import type { Db } from '../db/client';
import { listDeployments } from '../store/deployments';
import { recentErrorGroups } from '../store/errors';
import { listFamilySnapshots } from '../store/health';
import { countBySeverity, topProblems, type ReadContext } from '../read/problems';

/**
 * The evidence pack a question is answered from (§23, AI-4).
 *
 * **The model is given structure, never a dump.** No SQL reaches it, no log line reaches it, no credential
 * and no AWS identifier reaches it. What it gets is the same handful of things a reader would look at:
 * what each family looks like, the worst problems, what has shipped, and which error groups are new — all
 * of it already computed, all of it citable back to a page.
 *
 * Everything is bounded before it is built, not truncated afterwards. §23's limits are the shape of the
 * pack rather than a check at the end: a fixed number of rows per section, a fixed number of sections, and
 * a hard cap on the rendered size — because an unbounded context is how a question becomes an export.
 */

/** §23: one bounded pack, never more than this once rendered. */
export const MAX_CONTEXT_BYTES = 32_000;

/** How many rows each section may carry. A question is answered from the worst few, not from everything. */
const PROBLEM_LIMIT = 8;
const DEPLOYMENT_LIMIT = 5;
const ERROR_LIMIT = 5;

/** How far back the pack looks. A question about now is not answered from last month. */
const WINDOW_MS = 24 * 60 * 60_000;

export type EvidencePack = {
  /** Rendered for the model: plain text, already bounded. */
  text: string;
  /** What the answer may cite, so a reader can check it rather than believe it. */
  citations: Ref[];
};

/** Truncates a value the model does not need in full. A message is evidence; an essay is a context leak. */
const short = (value: string, max = 160) => (value.length <= max ? value : `${value.slice(0, max)}…`);

export function buildEvidence(
  db: Db,
  query: { connectionId: string; scope: string },
  context: ReadContext,
): EvidencePack {
  const lines: string[] = [];
  const citations: Ref[] = [];

  const counts = countBySeverity(db, query);
  lines.push(`Open problems: ${counts.critical} critical, ${counts.warning} warning.`);

  const families = listFamilySnapshots(db, query.connectionId, query.scope);
  if (families.length === 0) {
    // Said plainly, because a model told nothing would otherwise infer that nothing is wrong.
    lines.push('No family has been read yet, so OpsWatch cannot say whether this environment is healthy.');
  } else {
    for (const family of families) {
      const measured = family.total === null ? 'not measured' : `${family.affected ?? 0} of ${family.total} affected`;
      lines.push(`Family ${family.family}: ${family.status}, ${measured}.`);
    }
  }

  const problems = topProblems(db, query, context).slice(0, PROBLEM_LIMIT);
  if (problems.length > 0) {
    lines.push('', 'Worst open problems, worst first:');
    for (const problem of problems) {
      lines.push(`- [${problem.severity}] ${short(problem.title)} (id ${problem.id}, since ${new Date(problem.firstSeenAt).toISOString()})`);
      citations.push({ type: 'problem', id: problem.id, label: short(problem.title, 80) });
    }
  }

  const deployments = listDeployments(db, { ...query, sinceMs: context.nowMs - WINDOW_MS }, DEPLOYMENT_LIMIT);
  if (deployments.length > 0) {
    lines.push('', 'Deployments in the last 24 hours:');
    for (const deployment of deployments) {
      lines.push(`- ${deployment.serviceName} ${deployment.taskDefinition} ${deployment.status} at ${new Date(deployment.startedAt).toISOString()}`);
      citations.push({ type: 'deployment', id: deployment.deploymentId, label: deployment.serviceName });
    }
  }

  const errors = recentErrorGroups(db, { ...query, sinceMs: context.nowMs - WINDOW_MS }, ERROR_LIMIT);
  if (errors.length > 0) {
    lines.push('', 'Error groups that changed in the last 24 hours:');
    for (const group of errors) {
      lines.push(`- [${group.status}] ${short(group.sampleMessage)} (id ${group.id})`);
      citations.push({ type: 'error', id: group.id, label: short(group.sampleMessage, 80) });
    }
  }

  const text = lines.join('\n');
  return {
    // Bounded as a promise rather than as a hope: §23's ceiling is enforced here, once.
    text: text.length <= MAX_CONTEXT_BYTES ? text : `${text.slice(0, MAX_CONTEXT_BYTES)}\n[truncated]`,
    citations,
  };
}

/** Whether there is anything at all to answer from, which decides whether a question is worth sending. */
export function hasEvidence(pack: EvidencePack): boolean {
  return pack.citations.length > 0 || pack.text.includes('Family ');
}
