'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { getDb } from '@/lib/db/client';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { discoverRepositories, fetchRepository, removeGithubConnection, saveGithubToken, testGithubConnection } from '@/lib/github/connection';
import { deleteRepository, upsertRepository } from '@/lib/store/repositories';

export type RepositoryState = ActionState<'invalid_owner' | 'invalid_name' | 'invalid_branch', { saved?: boolean }>;
export type TokenState = ActionState<
  'invalid_token' | 'not_configured' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'not_found' | 'unreachable' | 'bad_response' | 'timeout',
  { saved?: boolean; tested?: boolean; removed?: boolean; account?: string; discovered?: { owner: string; name: string; defaultBranch: string; private: boolean }[] }
>;

/** GitHub owners and repository names: letters, digits, dots, dashes and underscores. */
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
/** A branch name, loose enough for `release/1.0` and tight enough to keep a path out of a URL. */
const BRANCH = /^[A-Za-z0-9._\-/]{1,200}$/;

export async function saveRepositoryAction(locale: string, _prev: RepositoryState, formData: FormData): Promise<RepositoryState> {
  return auditedAdmin(resolveLocale(locale), 'repository_update', 'repository', async (): Promise<RepositoryState> => {
  const owner = formString(formData, 'owner').trim();
  if (!NAME.test(owner)) return { error: 'invalid_owner' };
  const name = formString(formData, 'name').trim();
  if (!NAME.test(name)) return { error: 'invalid_name' };
  const typed = formString(formData, 'defaultBranch').trim() || 'main';
  if (!BRANCH.test(typed)) return { error: 'invalid_branch' };

  // With a token connected the branch is read rather than trusted: a repository recorded against a branch
  // that does not exist builds links to files nobody can open, and nothing would say why.
  const now = Date.now();
  const fetched = await fetchRepository(getDb(), owner, name, now);
  const branch = fetched.ok ? fetched.repository.defaultBranch : typed;

  upsertRepository(getDb(), { owner, name, defaultBranch: branch }, now);
  revalidatePath(`/${resolveLocale(locale)}/settings/repositories`);
  return { saved: true };
  });
}

export async function deleteRepositoryAction(locale: string, _prev: RepositoryState, formData: FormData): Promise<RepositoryState> {
  return auditedAdmin(resolveLocale(locale), 'repository_update', 'repository', async (): Promise<RepositoryState> => {
  const id = formString(formData, 'repositoryId').trim();
  if (id === '') return { error: 'invalid_name' };

  // The mapping cascades, so a service can never be left pointing at a repository that is gone.
  deleteRepository(getDb(), id);
  revalidatePath(`/${resolveLocale(locale)}/settings/repositories`);
  return { saved: true };
  });
}

/**
 * Stores a GitHub token.
 *
 * Encrypted with its own purpose-scoped key before it reaches the store, which never sees plaintext. §13's
 * scopes are Contents: Read and Metadata: Read — the client built on it has no write verb at all, so the
 * token being read-only is belt as well as braces.
 */
export async function saveTokenAction(locale: string, _prev: TokenState, formData: FormData): Promise<TokenState> {
  return auditedAdmin(resolveLocale(locale), 'integration_update', 'integration', async (): Promise<TokenState> => {
  const token = formString(formData, 'token').trim();
  // A blank submission means "leave it alone", which is how a form can be saved without retyping a secret.
  if (token === '') return { saved: true };
  if (token.length < 20 || token.length > 500) return { error: 'invalid_token' };

  saveGithubToken(getDb(), token, Date.now());
  revalidatePath(`/${resolveLocale(locale)}/settings/repositories`);
  return { saved: true };
  });
}

/** §13's permission validation: does the stored token work, and whose is it. */
export async function testTokenAction(locale: string, _prev: TokenState, _formData: FormData): Promise<TokenState> {
  return auditedAdmin(resolveLocale(locale), 'integration_update', 'integration', async (): Promise<TokenState> => {
    const result = await testGithubConnection(getDb(), Date.now());
    revalidatePath(`/${resolveLocale(locale)}/settings/repositories`);
    return result.ok ? { tested: true, account: result.account } : { error: result.error };
  });
}

/** Discovery, so an operator picks a repository from what the token can see rather than typing a name. */
export async function discoverRepositoriesAction(locale: string, _prev: TokenState, _formData: FormData): Promise<TokenState> {
  return auditedAdmin(resolveLocale(locale), 'integration_update', 'integration', async (): Promise<TokenState> => {
    const result = await discoverRepositories(getDb(), Date.now());
    if (!result.ok) return { error: result.error };
    return {
      discovered: result.repositories.map((one) => ({ owner: one.owner, name: one.name, defaultBranch: one.defaultBranch, private: one.private })),
    };
  });
}

/** Records the repositories an operator ticked, with the default branch GitHub reported rather than a guess. */
export async function importRepositoriesAction(locale: string, _prev: RepositoryState, formData: FormData): Promise<RepositoryState> {
  return auditedAdmin(resolveLocale(locale), 'repository_update', 'repository', async (): Promise<RepositoryState> => {
    const now = Date.now();
    for (const value of formData.getAll('repository').map((one) => String(one))) {
      // `owner/name@branch`, built by the page from what GitHub answered.
      const at = value.lastIndexOf('@');
      const [owner, name] = value.slice(0, at).split('/');
      const branch = value.slice(at + 1);
      if (owner === undefined || name === undefined || !NAME.test(owner) || !NAME.test(name) || !BRANCH.test(branch)) continue;
      upsertRepository(getDb(), { owner, name, defaultBranch: branch }, now);
    }
    revalidatePath(`/${resolveLocale(locale)}/settings/repositories`);
    return { saved: true };
  });
}

/** Disconnect: the token is deleted. The repositories stay, because links and mapping work without one. */
export async function disconnectGithubAction(locale: string, _prev: TokenState, _formData: FormData): Promise<TokenState> {
  return auditedAdmin(resolveLocale(locale), 'integration_update', 'integration', async (): Promise<TokenState> => {
    removeGithubConnection(getDb());
    revalidatePath(`/${resolveLocale(locale)}/settings/repositories`);
    return { removed: true };
  });
}
