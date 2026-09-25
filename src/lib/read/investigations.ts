import 'server-only';
import type { Investigation as WireInvestigation } from '@opswatch/contract';
import type { Db } from '../db/client';
import { findProblemById } from '../store/problems';
import { readInvestigation, type InvestigationLabels } from './investigation';
import type { Render } from './problems';

/**
 * An investigation as the API serves it (INV-1).
 *
 * **It is derived, not stored, and the shape says so.** OpsWatch does not keep an investigation object
 * that somebody opens and closes; it assembles the timeline from the events spine whenever it is asked,
 * which is why a problem opened weeks ago still has one and why it costs nothing. An investigation is
 * therefore *of a problem*, and carries the problem's id — a separate id would imply a separate record
 * that a client could create, rename or close, and there is none.
 *
 * What that means for the fields the contract asks for:
 *
 *   - `status` follows the problem. A problem that is resolved is an investigation that is concluded; one
 *     that is still open is an investigation that is still open. Nothing else could set it.
 *   - `concludedAt` is the problem's `resolvedAt`, and is absent while it is open rather than `0`.
 *   - `summary` is **absent**. Nobody wrote one, and the engine's job is to lay the evidence out in three
 *     bands, not to conclude. A generated sentence here would be a conclusion with an author's authority.
 *
 * The timeline is the same one the Problem page renders — the same function, the same three bands — so a
 * client and the web can never show a different investigation of the same problem.
 */
export function readInvestigationById(
  db: Db,
  query: { connectionId: string; scope: string; id: string },
  context: { nowMs: number; labels: InvestigationLabels; render: Render },
): WireInvestigation | null {
  const problem = findProblemById(db, query.id);
  // Scoped exactly as the problem is: an id from another environment reads as absent, not as somebody else's.
  if (!problem || problem.connectionId !== query.connectionId || problem.scope !== query.scope) return null;

  const { timeline } = readInvestigation(db, problem, context.labels, context.nowMs);

  return {
    id: problem.id,
    // The problem's own sentence, so the investigation is titled with what is being investigated.
    title: context.render(problem.titleKey, problem.values),
    subject: { type: 'problem', id: problem.id, label: problem.subjectName },
    status: problem.status === 'resolved' ? 'concluded' : 'open',
    startedAt: problem.firstSeenAt,
    ...(problem.resolvedAt === null ? {} : { concludedAt: problem.resolvedAt }),
    timeline,
  };
}
