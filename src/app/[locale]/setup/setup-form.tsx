'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import type { FormAction } from '@/lib/forms/action-state';
import { MIN_PASSWORD_LENGTH } from '@/lib/limits';
import type { SetupState } from './actions';

export function SetupForm({ action }: { action: FormAction<SetupState> }) {
  const t = useTranslations('Auth');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />
      <FormField id="email" label={t('setup.email')} type="email" autoComplete="email" defaultValue={state.email} required />
      <FormField
        id="password"
        label={t('setup.password')}
        hint={t('setup.passwordHint')}
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        required
      />
      <FormField id="confirmPassword" label={t('setup.confirmPassword')} type="password" autoComplete="new-password" required />
      <SubmitButton className="w-full">{t('setup.submit')}</SubmitButton>
    </form>
  );
}
