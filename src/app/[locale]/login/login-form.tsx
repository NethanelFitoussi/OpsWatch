'use client';

import { useTranslations } from 'next-intl';
import { AuthForm } from '@/components/auth-form';
import { FormField } from '@/components/form-field';
import type { FormAction } from '@/lib/forms/action-state';
import type { LoginState } from './actions';

export function LoginForm({ action, initialError }: { action: FormAction<LoginState>; initialError?: LoginState['error'] }) {
  const t = useTranslations('Auth.login');
  return (
    <AuthForm action={action} emailLabel={t('email')} submitLabel={t('submit')} initialError={initialError}>
      <FormField id="password" label={t('password')} type="password" autoComplete="current-password" required />
    </AuthForm>
  );
}
