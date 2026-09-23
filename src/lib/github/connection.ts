import 'server-only';
import { DecryptionError, decrypt, encrypt } from '../crypto';
import type { Db } from '../db/client';
import { env } from '../env';
import { credentialFor, deleteIntegration, listIntegrations, recordIntegrationTest, upsertIntegration } from '../store/repositories';
import { getRepository, listCommits, listRepositories, verifyToken, type GithubDeps, type GithubRepository } from './api';
import type { GithubFailure } from './failures';

/**
 * The GitHub connection (§13, REPO-1).
 *
 * One token, encrypted under its **own** derivation. It was previously sealed with the `access-keys`
 * purpose, which is the one AWS credentials use — so a path that could read one could read the other. New
 * tokens use `github`, and a token still sealed the old way is re-sealed the first time it is read, which
 * is a migration rather than a permanent fallback.
 */

const NAME = 'github';
const PURPOSE = 'github' as const;
/** The purpose GitHub tokens were sealed with before each secret got its own. Read, re-sealed, gone. */
const LEGACY_PURPOSE = 'access-keys' as const;

export type GithubConnectionView = {
  status: 'configured' | 'untested' | 'failed';
  lastTestedAt: number | null;
  lastError: string | null;
  /** The account the token belongs to, as GitHub reported it on the last successful verification. */
  account: string | null;
  hasCredential: boolean;
};

const row = (db: Db) => listIntegrations(db, 'github').find((one) => one.name === NAME);

export function readGithubConnection(db: Db): GithubConnectionView | null {
  const found = row(db);
  if (found === undefined) return null;
  const config = typeof found.config === 'object' && found.config !== null ? (found.config as { account?: unknown }) : {};
  return {
    status: found.status,
    lastTestedAt: found.lastTestedAt,
    lastError: found.lastError,
    account: typeof config.account === 'string' ? config.account : null,
    hasCredential: found.hasCredential,
  };
}

/** Whether GitHub is genuinely usable: a token that has been verified, not merely stored. */
export function githubIsReady(db: Db): boolean {
  return readGithubConnection(db)?.status === 'configured';
}

export function saveGithubToken(db: Db, token: string, nowMs: number): void {
  upsertIntegration(db, { kind: 'github', name: NAME, credentialCiphertext: encrypt(token, env().OPSWATCH_SECRET, PURPOSE) }, nowMs);
}

export function removeGithubConnection(db: Db): boolean {
  const found = row(db);
  if (found === undefined) return false;
  return deleteIntegration(db, found.id) > 0;
}

type Held = { ok: true; token: string } | { ok: false; error: GithubFailure };

/**
 * The decrypted token, alive only inside one caller's frame.
 *
 * A token sealed under the legacy purpose is re-sealed under its own before this returns, so the fallback
 * is used once per token and then never again.
 */
function heldToken(db: Db, nowMs: number): Held {
  const found = row(db);
  if (found === undefined) return { ok: false, error: 'not_configured' };
  const ciphertext = credentialFor(db, found.id);
  if (ciphertext === null) return { ok: false, error: 'not_configured' };

  const secret = env().OPSWATCH_SECRET;
  try {
    return { ok: true, token: decrypt(ciphertext, secret, PURPOSE) };
  } catch (error) {
    if (!(error instanceof DecryptionError)) throw error;
  }

  try {
    const token = decrypt(ciphertext, secret, LEGACY_PURPOSE);
    // Migrated in place, keeping the status: the token has not changed, only how it is sealed.
    upsertIntegration(db, { kind: 'github', name: NAME, credentialCiphertext: encrypt(token, secret, PURPOSE), resetStatus: false }, nowMs);
    return { ok: true, token };
  } catch (error) {
    // Sealed under a different `OPSWATCH_SECRET`, so it is unusable. That is what to tell the operator.
    if (error instanceof DecryptionError) return { ok: false, error: 'unauthorized' };
    throw error;
  }
}

/** §13's permission validation, recorded so the page can show connected, invalid or unavailable. */
export async function testGithubConnection(
  db: Db,
  nowMs: number,
  deps: GithubDeps = {},
): Promise<{ ok: true; account: string } | { ok: false; error: GithubFailure }> {
  const found = row(db);
  if (found === undefined) return { ok: false, error: 'not_configured' };
  const held = heldToken(db, nowMs);
  if (!held.ok) return held;

  const result = await verifyToken(held.token, deps);
  // The code, never GitHub's sentence. The account login is not a secret and is worth showing.
  recordIntegrationTest(db, found.id, result.ok ? { ok: true } : { ok: false, error: result.error }, nowMs);
  if (!result.ok) return { ok: false, error: result.error };

  upsertIntegration(db, { kind: 'github', name: NAME, config: { account: result.data.login }, resetStatus: false }, nowMs);
  return { ok: true, account: result.data.login };
}

/** Discovery: what this token can see, so an operator picks rather than types an owner and a name. */
export async function discoverRepositories(
  db: Db,
  nowMs: number,
  deps: GithubDeps = {},
): Promise<{ ok: true; repositories: GithubRepository[] } | { ok: false; error: GithubFailure }> {
  const held = heldToken(db, nowMs);
  if (!held.ok) return held;
  const result = await listRepositories(held.token, deps);
  return result.ok ? { ok: true, repositories: result.data } : { ok: false, error: result.error };
}

/** One repository's metadata, so a default branch is read rather than typed. */
export async function fetchRepository(
  db: Db,
  owner: string,
  name: string,
  nowMs: number,
  deps: GithubDeps = {},
): Promise<{ ok: true; repository: GithubRepository } | { ok: false; error: GithubFailure }> {
  const held = heldToken(db, nowMs);
  if (!held.ok) return held;
  const result = await getRepository(held.token, owner, name, deps);
  return result.ok ? { ok: true, repository: result.data } : { ok: false, error: result.error };
}

/** The commits behind a deployment (REPO-4). Bounded by the window the caller asks about. */
export async function fetchCommits(
  db: Db,
  repository: { owner: string; name: string; branch: string },
  window: { sinceMs: number; untilMs: number },
  nowMs: number,
  deps: GithubDeps = {},
) {
  const held = heldToken(db, nowMs);
  if (!held.ok) return held;
  return listCommits(held.token, repository, window, deps);
}
