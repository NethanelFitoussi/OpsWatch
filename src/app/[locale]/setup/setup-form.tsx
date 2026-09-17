'use client';

import { useTranslations } from 'next-intl';
import { AuthForm } from '@/components/auth-form';
import { FormField } from '@/components/form-field';
import type { FormAction } from '@/lib/forms/action-state';
import { MIN_PASSWORD_LENGTH } from '@/lib/limits';
import type { SetupState } from './actions';

export function SetupForm({ action }: { action: FormAction<SetupState> }) {
  const t = useTranslations('Auth.setup');
  return (
    <AuthForm action={action} emailLabel={t('email')} submitLabel={t('submit')}>
      <FormField
        id="password"
        label={t('password')}
        hint={t('passwordHint')}
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        required
      />
      <FormField id="confirmPassword" label={t('confirmPassword')} type="password" autoComplete="new-password" required />
    </AuthForm>
  );
}
