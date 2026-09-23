/**
 * Mapping a service to a repository, and a stack frame to a file in it (§13, §J).
 *
 * Pure, and deliberately deterministic: §J insists that code correlation happens **before** any AI, by
 * rules that can be read and argued with. Everything here is a string comparison whose reasoning a person
 * can check.
 *
 * **The rule that shapes the whole file:** OpsWatch *suggests* a mapping and **never applies one**. A wrong
 * mapping sends an operator to the wrong diff during an incident, which is worse than having no mapping at
 * all — they would be reading real code that has nothing to do with their outage, and believing it.
 */

/** A suggestion below this is not offered: a weak guess is worse than none, for the reason above. */
export const MIN_SUGGESTION_SCORE = 0.6;

export type RepositoryRef = { id: string; owner: string; name: string; defaultBranch: string };

export type Suggestion = {
  repositoryId: string;
  /** 0–1. Stated so a person can see how much of a guess they are being asked to accept. */
  score: number;
  /** Which comparison produced it, so the suggestion can be argued with rather than only trusted. */
  because: 'exact_name' | 'service_contains_repo' | 'repo_contains_service' | 'image_matches';
};

/** Strips the noise that makes two names look different when they are not: case, separators, common suffixes. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^.*\//, '')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(service|svc|api|app|server)$/, '');
}

/** The repository part of an image reference, if it looks like one: `ghcr.io/acme/web:sha` → `web`. */
export function repositoryFromImage(image: string | null): string | null {
  if (image === null || image.trim() === '') return null;
  const withoutTag = image.split('@')[0].split(':')[0];
  const last = withoutTag.split('/').pop();
  return last === undefined || last === '' ? null : last;
}

/**
 * The best suggestion for one service, or null.
 *
 * Returns at most one: offering three near-identical guesses makes the decision harder, not easier, and the
 * point of a suggestion is to save a person typing rather than to hand them a shortlist to adjudicate.
 */
export function suggestRepository(
  service: { id: string; name: string; image?: string | null },
  repositories: readonly RepositoryRef[],
): Suggestion | null {
  const serviceName = normalizeName(service.name);
  const imageName = normalizeName(repositoryFromImage(service.image ?? null) ?? '');

  const scored = repositories
    .map((repository): Suggestion | null => {
      const repoName = normalizeName(repository.name);
      if (repoName === '') return null;
      if (imageName !== '' && repoName === imageName) return { repositoryId: repository.id, score: 1, because: 'image_matches' };
      if (repoName === serviceName) return { repositoryId: repository.id, score: 0.9, because: 'exact_name' };
      // A containment match is weaker in both directions, and weaker still the more surplus there is.
      if (serviceName !== '' && serviceName.includes(repoName)) {
        return { repositoryId: repository.id, score: 0.6 * (repoName.length / serviceName.length), because: 'service_contains_repo' };
      }
      if (repoName.includes(serviceName) && serviceName !== '') {
        return { repositoryId: repository.id, score: 0.6 * (serviceName.length / repoName.length), because: 'repo_contains_service' };
      }
      return null;
    })
    .filter((suggestion): suggestion is Suggestion => suggestion !== null && suggestion.score >= MIN_SUGGESTION_SCORE)
    .sort((a, b) => b.score - a.score || a.repositoryId.localeCompare(b.repositoryId));

  return scored[0] ?? null;
}

export type FrameLocation = {
  repositoryId: string;
  /** The path inside the repository, with any monorepo prefix applied. */
  path: string;
  /** The commit when one is known, otherwise the default branch. */
  ref: string;
  /**
   * True when `ref` is a branch rather than a commit. §13: a frame without a commit is a guess about line
   * numbers, and the page must say "shown from `main`, which may have moved since this error".
   */
  refIsMoving: boolean;
};

/**
 * Where a container puts the application. Everything after one of these is the repository path.
 *
 * A list rather than a pattern, because each entry is a convention somebody chose — Lambda's `/var/task`,
 * the Node images' `/home/node/app`, the common `/app` — and a reader should be able to see which ones are
 * recognised rather than reverse-engineer a regex.
 */
const CONTAINER_ROOT = /^\/(?:usr\/src\/app|home\/node\/app|var\/task|srv\/app|workspace|app|code)(?=\/)/;

/** Paths that belong to a runtime or a dependency, which are never in the operator's repository. */
const FOREIGN = [/(^|\/)node_modules\//, /^node:/, /^internal\//, /^<.*>/, /(^|\/)site-packages\//, /(^|\/)dist\/vendor\//];

/**
 * A stack frame's file, as a path inside a repository.
 *
 * Returns null rather than a guess for anything it cannot place: a dependency's file, an absolute path with
 * no recognisable root, or a service with no mapping. §J's pipeline is deterministic, which means it must
 * also be allowed to decline.
 */
export function locateFrame(
  file: string,
  mapping: { repositoryId: string; pathPrefix: string | null },
  repository: Pick<RepositoryRef, 'defaultBranch'>,
  commitSha: string | null,
): FrameLocation | null {
  const cleaned = file.trim();
  if (cleaned === '') return null;
  if (FOREIGN.some((pattern) => pattern.test(cleaned))) return null;

  // A container's working directory is stripped; everything after it is the repository path. Guessing a
  // *source* root instead (`src/`, `lib/`) looked simpler and was wrong: `/app/` is both a container root
  // and a real source directory in a Next.js repository, so `/app/src/pay.ts` came out as `app/src/pay.ts`.
  // Stripping a known container root keeps `packages/web/src/a.ts` intact, which a source-root guess lost.
  const rooted = CONTAINER_ROOT.test(cleaned);
  // Nothing recognisable: an absolute path from a machine nobody here knows is not a repository path.
  // Tested before stripping, because stripping the leading slash would make any absolute path look changed.
  if (!rooted && cleaned.startsWith('/')) return null;
  const withoutRoot = cleaned.replace(CONTAINER_ROOT, '').replace(/^\/+/, '');

  const prefix = mapping.pathPrefix?.replace(/^\/+|\/+$/g, '') ?? '';
  return {
    repositoryId: mapping.repositoryId,
    path: prefix === '' ? withoutRoot : `${prefix}/${withoutRoot}`,
    ref: commitSha ?? repository.defaultBranch,
    refIsMoving: commitSha === null,
  };
}

/** The link a reader follows. Built from stored fields, so it works without a credential. */
export function fileUrl(repository: Pick<RepositoryRef, 'owner' | 'name'>, location: FrameLocation): string {
  return `https://github.com/${repository.owner}/${repository.name}/blob/${encodeURIComponent(location.ref)}/${location.path}`;
}
