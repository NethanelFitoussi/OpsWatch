import 'server-only';
import type { Db } from '../db/client';
import type { ErrorGroupRow } from '../db/schema';
import { fileUrl, locateFrame, suggestRepository, type Suggestion } from '../detect/repository';
import { DEPLOYMENT_WINDOW_MS } from '../detect/correlate';
import { listDeploymentCommits } from '../store/deployment-commits';
import { listDeployments } from '../store/deployments';
import { findMapping, findRepository, listRepositories } from '../store/repositories';

/**
 * Where an error's stack frames live in the code (§J, §K).
 *
 * Deterministic and offline: a mapping an operator declared, a frame, and a repository record. No AI, no
 * GitHub call. §J insists the correlation happens before any AI precisely so that its reasoning can be read
 * and argued with, and this can all be checked by hand.
 *
 * Three states, and the page must tell them apart:
 *
 * - **mapped** — the service has a repository, and each placeable frame has a link.
 * - **suggested** — no mapping, but one repository looks like a match. Offered for a person to accept;
 *   §13 forbids applying it. A wrong mapping sends somebody to the wrong diff during an incident.
 * - **unmapped** — nothing to suggest, so the page says what to do rather than showing an empty panel.
 *
 * **The ref is pinned where it can be.** A link to a branch points at whatever that branch says today,
 * which for an error first seen three weeks ago is very likely not the code that produced it. When the
 * group's first sighting follows a deployment on the same service, the link uses **that deployment's
 * commit** — immutable, and therefore the code that actually ran. §13 asks for the distinction to be
 * visible either way, which is what `refIsMoving` carries.
 */

export type FrameEvidence = {
  /** The frame as the fingerprint recorded it. */
  raw: string;
  file: string;
  functionName: string | null;
  /** Null when the frame could not be placed — a dependency, or a path from an unknown root. */
  path: string | null;
  url: string | null;
  /** True when the link points at a branch rather than a commit, so line numbers may have moved (§13). */
  refIsMoving: boolean;
  ref: string | null;
  /**
   * Where the most recent sighting was in the file, when the stack said so.
   *
   * From the sample stored on the group, never from the fingerprint. Null when the stack carried no line —
   * in which case the link opens the file rather than guessing a line that would point at nothing.
   */
  line: number | null;
};

export type CodeEvidence =
  | { state: 'mapped'; repository: { id: string; owner: string; name: string }; frames: FrameEvidence[]; placed: number }
  | { state: 'suggested'; suggestion: Suggestion; repository: { id: string; owner: string; name: string } }
  | { state: 'unmapped'; hasRepositories: boolean };

/** Splits a stored frame, which the fingerprint wrote as `file:function`. */
export function splitFrame(frame: string): { file: string; functionName: string | null } {
  const at = frame.lastIndexOf(':');
  if (at <= 0) return { file: frame, functionName: null };
  return { file: frame.slice(0, at), functionName: frame.slice(at + 1) || null };
}

/**
 * The commit an error's first sighting followed, or null.
 *
 * Same service, before the error appeared, inside §7's deployment window, and the deployment's commits
 * already fetched. Every one of those is required: a commit from another service is not this code, a
 * deployment after the error cannot have shipped it, and a rollout an hour earlier is not a correlation
 * worth pinning a link to.
 *
 * Null is the common case and the safe one — it falls back to the default branch, which the page marks as
 * a moving reference.
 */
function pinnedCommit(db: Db, group: ErrorGroupRow): string | null {
  if (group.serviceId === null) return null;

  // The three conditions are the query's, not a filter applied afterwards: same service, started before
  // the error, inside §7's window. A mutation showed that running them again through
  // `correlateDeployments` changed nothing, so the extra pass is gone rather than left looking load-bearing.
  // `listDeployments` orders by `startedAt` descending, which over a window ending at the error is nearest
  // first — the most recent change before it is the one the link points at.
  const candidates = listDeployments(
    db,
    {
      connectionId: group.connectionId,
      scope: group.scope,
      serviceId: group.serviceId,
      sinceMs: group.firstSeenAt - DEPLOYMENT_WINDOW_MS,
      untilMs: group.firstSeenAt + 1,
    },
    10,
  );
  for (const deployment of candidates) {
    const commits = listDeploymentCommits(db, deployment.id);
    if (commits[0] !== undefined) return commits[0].sha;
  }
  return null;
}

export function readCodeEvidence(db: Db, group: ErrorGroupRow): CodeEvidence {
  const repositories = listRepositories(db);

  const pinned = pinnedCommit(db, group);
  const mapping = group.serviceId === null ? null : findMapping(db, group.connectionId, group.scope, group.serviceId);
  if (mapping !== null) {
    const repository = findRepository(db, mapping.repositoryId);
    if (repository !== null) {
      const samples = group.sampleFrames ?? [];
      const frames: FrameEvidence[] = group.topFrames.map((raw, index) => {
        const { file, functionName } = splitFrame(raw);
        // Paired by position: `sampleFrames` and `topFrames` are built from one parse, in one order, with
        // the same filter and the same cap. Matched by path as well, so a shorter sample cannot misalign
        // the rest — a line from the wrong frame is worse than no line.
        const sample = samples[index];
        const line = sample !== undefined && sample.file === file ? sample.line : null;
        // The commit of the deployment this error followed, where there is one. Without it the ref is the
        // default branch, and `refIsMoving` says so rather than letting a stale link look authoritative.
        const located = locateFrame(file, { repositoryId: repository.id, pathPrefix: mapping.pathPrefix }, repository, pinned);
        return {
          raw,
          file,
          functionName,
          path: located?.path ?? null,
          url: located === null ? null : fileUrl(repository, located, line),
          refIsMoving: located?.refIsMoving ?? false,
          ref: located?.ref ?? null,
          line,
        };
      });

      return {
        state: 'mapped',
        repository: { id: repository.id, owner: repository.owner, name: repository.name },
        frames,
        // Stated so a panel showing two links out of five does not look like the whole stack.
        placed: frames.filter((frame) => frame.path !== null).length,
      };
    }
  }

  if (group.serviceId !== null && repositories.length > 0) {
    const suggestion = suggestRepository(
      { id: group.serviceId, name: group.serviceId },
      repositories.map((repository) => ({
        id: repository.id,
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
      })),
    );
    if (suggestion !== null) {
      const repository = repositories.find((one) => one.id === suggestion.repositoryId);
      if (repository !== undefined) {
        return {
          state: 'suggested',
          suggestion,
          repository: { id: repository.id, owner: repository.owner, name: repository.name },
        };
      }
    }
  }

  return { state: 'unmapped', hasRepositories: repositories.length > 0 };
}
