import 'server-only';
import type { Db } from '../db/client';
import type { ErrorGroupRow } from '../db/schema';
import { fileUrl, locateFrame, suggestRepository, type Suggestion } from '../detect/repository';
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

export function readCodeEvidence(db: Db, group: ErrorGroupRow): CodeEvidence {
  const repositories = listRepositories(db);

  const mapping = group.serviceId === null ? null : findMapping(db, group.connectionId, group.scope, group.serviceId);
  if (mapping !== null) {
    const repository = findRepository(db, mapping.repositoryId);
    if (repository !== null) {
      const frames: FrameEvidence[] = group.topFrames.map((raw) => {
        const { file, functionName } = splitFrame(raw);
        // No commit is known: error groups are not yet tied to a deployment (ERR-9), so the ref is the
        // default branch and the page says it may have moved.
        const located = locateFrame(file, { repositoryId: repository.id, pathPrefix: mapping.pathPrefix }, repository, null);
        return {
          raw,
          file,
          functionName,
          path: located?.path ?? null,
          url: located === null ? null : fileUrl(repository, located),
          refIsMoving: located?.refIsMoving ?? false,
          ref: located?.ref ?? null,
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
