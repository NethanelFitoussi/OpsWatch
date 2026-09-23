'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { encrypt } from '@/lib/crypto';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import type { ActionState } from '@/lib/forms/action-state';
import { formString } from '@/lib/forms/form-data';
import { deleteRepository, upsertIntegration, upsertRepository } from '@/lib/store/repositories';

export type RepositoryState = ActionState<'invalid_owner' | 'invalid_name' | 'invalid_branch', { saved?: boolean }>;
export type TokenState = ActionState<'invalid_token', { saved?: boolean }>;

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
  const branch = formString(formData, 'defaultBranch').trim() || 'main';
  if (!BRANCH.test(branch)) return { error: 'invalid_branch' };

  upsertRepository(getDb(), { owner, name, defaultBranch: branch }, Date.now());
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

  upsertIntegration(
    getDb(),
    { kind: 'github', name: 'github', credentialCiphertext: encrypt(token, env().OPSWATCH_SECRET, 'access-keys') },
    Date.now(),
  );
  revalidatePath(`/${resolveLocale(locale)}/settings/repositories`);
  return { saved: true };
  });
}
