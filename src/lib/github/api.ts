import 'server-only';
import { SsrfError, safeFetch } from '../net/safe-fetch';
import type { GithubFailure } from './failures';

/**
 * Talking to GitHub (§13, REPO-1).
 *
 * **There is no write verb in this file.** Every function is a `GET`, and that is the enforcement of §13's
 * promise rather than a note about it: OpsWatch cannot modify a repository because it has no code that
 * could. A token with write permission would still only ever be used to read.
 *
 * The token is passed as an argument, put into one header, and never logged, returned or placed in an
 * error. The base URL is fixed: unlike an AI provider there is one GitHub, and a configurable address
 * would be an invitation to point a token somewhere else.
 */

const BASE_URL = 'https://api.github.com';
const TIMEOUT_MS = 15_000;
const ACCEPT = 'application/vnd.github+json';

/** How many repositories one discovery call returns. An operator with hundreds pages by choosing. */
export const REPO_PAGE_SIZE = 100;
/** How many commits one window returns. A deployment is explained by a handful, not by a history. */
export const COMMIT_PAGE_SIZE = 20;
/**
 * How many changed files one commit reports.
 *
 * A generated-lockfile commit can touch thousands, and a page that listed them would be useless as well as
 * enormous. The count is kept whole; the list is the first few, and the page says when it was cut.
 */
export const CHANGED_FILE_LIMIT = 20;

export type GithubResult<T> = { ok: true; data: T } | { ok: false; error: GithubFailure };

export type GithubAccount = { login: string };
export type GithubRepository = { owner: string; name: string; defaultBranch: string; private: boolean };
export type GithubCommit = { sha: string; message: string; author: string | null; at: number };
export type GithubChangedFile = { path: string; additions: number; deletions: number; status: string };
export type GithubCommitDetail = GithubCommit & { files: GithubChangedFile[] };

export type GithubDeps = { fetch?: typeof safeFetch; timeoutMs?: number };

function failureOf(status: number): GithubFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'bad_response';
}

async function get<T>(path: string, token: string, parse: (payload: unknown) => T | null, deps: GithubDeps): Promise<GithubResult<T>> {
  const send = deps.fetch ?? safeFetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);

  try {
    const response = await send(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: ACCEPT, 'x-github-api-version': '2022-11-28' },
      signal: controller.signal,
    });
    // A rate limit arrives as 403 with a header rather than 429, and the two are fixed differently.
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      return { ok: false, error: 'rate_limited' };
    }
    if (!response.ok) return { ok: false, error: failureOf(response.status) };

    const payload: unknown = await response.json().catch(() => null);
    const data = parse(payload);
    return data === null ? { ok: false, error: 'bad_response' } : { ok: true, data };
  } catch (error) {
    if (error instanceof SsrfError) return { ok: false, error: 'unreachable' };
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, error: 'timeout' };
    // Never the cause: it can carry the URL, and one day a proxy's message could carry more.
    return { ok: false, error: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** §13's permission validation: does this token work, and whose is it. */
export function verifyToken(token: string, deps: GithubDeps = {}): Promise<GithubResult<GithubAccount>> {
  return get(
    '/user',
    token,
    (payload) => {
      const login = str((payload as { login?: unknown } | null)?.login);
      return login === null ? null : { login };
    },
    deps,
  );
}

function toRepository(entry: unknown): GithubRepository | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const row = entry as { name?: unknown; default_branch?: unknown; private?: unknown; owner?: { login?: unknown } };
  const name = str(row.name);
  const owner = str(row.owner?.login);
  if (name === null || owner === null) return null;
  return { owner, name, defaultBranch: str(row.default_branch) ?? 'main', private: row.private === true };
}

/** Discovery: what this token can see, so an operator picks rather than types an owner and a name. */
export function listRepositories(token: string, deps: GithubDeps = {}): Promise<GithubResult<GithubRepository[]>> {
  return get(
    `/user/repos?per_page=${REPO_PAGE_SIZE}&sort=pushed&affiliation=owner,organization_member`,
    token,
    (payload) => (Array.isArray(payload) ? payload.map(toRepository).filter((one): one is GithubRepository => one !== null) : null),
    deps,
  );
}

/** One repository's metadata, which is how a default branch stops being something somebody typed. */
export function getRepository(token: string, owner: string, name: string, deps: GithubDeps = {}): Promise<GithubResult<GithubRepository>> {
  return get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token, toRepository, deps);
}

/**
 * Commits on the default branch up to a moment (REPO-4).
 *
 * Bounded by a window and a count, because "what shipped with this deployment" is answered by the last few
 * commits before it and never by the repository's history.
 */
export function listCommits(
  token: string,
  repository: { owner: string; name: string; branch: string },
  window: { sinceMs: number; untilMs: number },
  deps: GithubDeps = {},
): Promise<GithubResult<GithubCommit[]>> {
  const query = new URLSearchParams({
    sha: repository.branch,
    since: new Date(window.sinceMs).toISOString(),
    until: new Date(window.untilMs).toISOString(),
    per_page: String(COMMIT_PAGE_SIZE),
  });
  return get(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits?${query.toString()}`,
    token,
    (payload) => {
      if (!Array.isArray(payload)) return null;
      return payload
        .map((entry): GithubCommit | null => {
          if (typeof entry !== 'object' || entry === null) return null;
          const row = entry as { sha?: unknown; commit?: { message?: unknown; author?: { name?: unknown; date?: unknown } } };
          const sha = str(row.sha);
          if (sha === null) return null;
          const at = Date.parse(str(row.commit?.author?.date) ?? '');
          return {
            sha,
            // First line only: a commit body can be long, and a summary is what a timeline shows.
            message: (str(row.commit?.message) ?? '').split('\n')[0].slice(0, 200),
            author: str(row.commit?.author?.name),
            at: Number.isFinite(at) ? at : window.untilMs,
          };
        })
        .filter((one): one is GithubCommit => one !== null);
    },
    deps,
  );
}

/** One commit with the files it changed (REPO-4). Paths and counts — never file contents. */
export function getCommit(
  token: string,
  repository: { owner: string; name: string },
  sha: string,
  deps: GithubDeps = {},
): Promise<GithubResult<GithubCommitDetail>> {
  return get(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}`,
    token,
    (payload) => {
      if (typeof payload !== 'object' || payload === null) return null;
      const row = payload as {
        sha?: unknown;
        commit?: { message?: unknown; author?: { name?: unknown; date?: unknown } };
        files?: unknown;
      };
      const id = str(row.sha);
      if (id === null) return null;
      const at = Date.parse(str(row.commit?.author?.date) ?? '');
      const files = Array.isArray(row.files) ? row.files : [];
      return {
        sha: id,
        message: (str(row.commit?.message) ?? '').split('\n')[0].slice(0, 200),
        author: str(row.commit?.author?.name),
        at: Number.isFinite(at) ? at : 0,
        files: files
          .map((entry): GithubChangedFile | null => {
            if (typeof entry !== 'object' || entry === null) return null;
            const file = entry as { filename?: unknown; additions?: unknown; deletions?: unknown; status?: unknown };
            const path = str(file.filename);
            if (path === null) return null;
            return {
              path,
              additions: typeof file.additions === 'number' ? file.additions : 0,
              deletions: typeof file.deletions === 'number' ? file.deletions : 0,
              status: str(file.status) ?? 'modified',
            };
          })
          .filter((one): one is GithubChangedFile => one !== null)
          .slice(0, CHANGED_FILE_LIMIT),
      };
    },
    deps,
  );
}
