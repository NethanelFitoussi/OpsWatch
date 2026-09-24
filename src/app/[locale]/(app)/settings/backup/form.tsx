'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import type { FormAction } from '@/lib/forms/action-state';
import type { BackupState } from './actions';

/** Taking a backup now. One button, because one button is the whole feature. */
export function BackupForm({ action }: { action: FormAction<BackupState> }) {
  const t = useTranslations('Settings.backup');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <FormErrorAlert message={state.error ? t(`errors.${state.error}`) : undefined} />
      <SubmitButton>{t('createNow')}</SubmitButton>
      {state.created !== undefined && (
        <p className="text-sm text-muted-foreground">{t('created', { name: state.created })}</p>
      )}
    </form>
  );
}
