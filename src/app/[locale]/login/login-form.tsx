'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import type { FormAction } from '@/lib/forms/action-state';
import type { LoginState } from './actions';

export function LoginForm({ action }: { action: FormAction<LoginState> }) {
  const t = useTranslations('Auth');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />
      <FormField id="email" label={t('login.email')} type="email" autoComplete="email" defaultValue={state.email} required />
      <FormField id="password" label={t('login.password')} type="password" autoComplete="current-password" required />
      <SubmitButton className="w-full">{t('login.submit')}</SubmitButton>
    </form>
  );
}
