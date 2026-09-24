'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { CodeBlock } from '@/components/code-block';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import type { FormAction } from '@/lib/forms/action-state';
import type { NotifyState } from './actions';

/**
 * Creating a destination, and testing one.
 *
 * The signing secret comes back from the server exactly once and is rendered here, with the warning that
 * it will not be shown again. It is never read from the database by a page — the only accessor is the
 * delivery path.
 */
export function CreateDestinationForm({ action }: { action: FormAction<NotifyState> }) {
  const t = useTranslations('Settings.notifications');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error ? t(`errors.${state.error}`) : undefined} />
      <div className="grid gap-3 md:grid-cols-2">
        <FormField id="name" label={t('name')} required maxLength={80} />
        <FormField id="url" label={t('url')} type="url" placeholder="https://example.com/opswatch" required maxLength={2048} hint={t('urlHint')} />
      </div>
      <SubmitButton>{t('create')}</SubmitButton>

      {state.signingSecret !== undefined && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">{t('secretTitle')}</p>
          <p className="mt-1 mb-2 text-sm text-muted-foreground">{t('secretHint')}</p>
          <CodeBlock value={state.signingSecret} />
        </div>
      )}
    </form>
  );
}

export function TestDestinationForm({ action }: { action: FormAction<NotifyState> }) {
  const t = useTranslations('Settings.notifications');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <SubmitButton>{t('test')}</SubmitButton>
      {state.tested === true && <span className="text-sm text-emerald-600 dark:text-emerald-400">{t('testOk')}</span>}
      {state.error !== undefined && <span className="text-sm text-red-600 dark:text-red-400">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}
