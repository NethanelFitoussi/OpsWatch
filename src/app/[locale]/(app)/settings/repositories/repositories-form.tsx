'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { RepositoryState, TokenState } from './actions';

export type RepositoryView = { id: string; owner: string; name: string; defaultBranch: string };

/**
 * Declaring the repositories OpsWatch knows about, and optionally a token to read them with.
 *
 * The two are deliberately separate. A repository can be recorded with no credential at all — that is
 * enough to place a stack frame and build a link — and the page says which of the two capabilities it has,
 * rather than refusing to do the free half until somebody supplies a secret.
 */
export function RepositoriesForm({
  save,
  remove,
  saveToken,
  repositories,
  hasToken,
  tokenStatus,
  tokenError,
}: {
  save: FormAction<RepositoryState>;
  remove: FormAction<RepositoryState>;
  saveToken: FormAction<TokenState>;
  repositories: RepositoryView[];
  hasToken: boolean;
  tokenStatus: string;
  tokenError: string | null;
}) {
  const t = useTranslations('Settings.repositories');
  const [saveState, saveAction] = useActionState(save, {});
  const [removeState, removeAction] = useActionState(remove, {});
  const [tokenState, tokenAction] = useActionState(saveToken, {});

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('known')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FormErrorAlert message={removeState.error && t(`errors.${removeState.error}`)} />
          {repositories.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noneYet')}</p>
          ) : (
            <ul className="divide-y">
              {repositories.map((repository) => (
                <li key={repository.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-all">
                    {repository.owner}/{repository.name}
                    <span className="ml-2 text-xs text-muted-foreground">{t('branch', { branch: repository.defaultBranch })}</span>
                  </span>
                  <form action={removeAction}>
                    <input type="hidden" name="repositoryId" value={repository.id} />
                    <SubmitButton>{t('remove')}</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <form action={saveAction}>
        <Card>
          <CardHeader>
            <CardTitle>{t('add')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormErrorAlert message={saveState.error && t(`errors.${saveState.error}`)} />
            {saveState.saved && <p className="text-sm">{t('saved')}</p>}
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="owner">{t('owner')}</Label>
                <Input id="owner" name="owner" required placeholder="acme" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="name">{t('name')}</Label>
                <Input id="name" name="name" required placeholder="storefront" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="defaultBranch">{t('defaultBranch')}</Label>
                <Input id="defaultBranch" name="defaultBranch" placeholder="main" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('addHint')}</p>
            <SubmitButton>{t('addAction')}</SubmitButton>
          </CardContent>
        </Card>
      </form>

      <form action={tokenAction}>
        <Card>
          <CardHeader>
            <CardTitle>{t('token')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormErrorAlert message={tokenState.error && t(`errors.${tokenState.error}`)} />
            {tokenState.saved && <p className="text-sm">{t('saved')}</p>}

            {/* What works without a token, and what does not, said before the field rather than after. */}
            <p className="text-sm">{hasToken ? t('tokenPresent', { status: tokenStatus }) : t('tokenAbsent')}</p>
            {tokenError !== null && <p className="text-sm">{t('tokenError', { error: tokenError })}</p>}
            <p className="text-xs text-muted-foreground">{t('tokenHint')}</p>

            <div className="space-y-1">
              <Label htmlFor="token">{t('tokenLabel')}</Label>
              {/* Write-only: the stored value is never sent to the browser, so there is nothing to prefill. */}
              <Input id="token" name="token" type="password" autoComplete="off" placeholder={hasToken ? t('tokenKeep') : ''} />
              <p className="text-xs text-muted-foreground">{t('tokenScopes')}</p>
            </div>
            <SubmitButton>{t('tokenSave')}</SubmitButton>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
