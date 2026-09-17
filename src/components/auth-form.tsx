'use client';

import { useTranslations } from 'next-intl';
import { useActionState, type ReactNode } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import type { ActionState, FormAction } from '@/lib/forms/action-state';

type AuthState = ActionState<string, { email: string }>;

/**
 * The sign-in and setup forms: the error, an email field that keeps its value after an error, the
 * password fields given as children (never echoed back), and the submit button.
 */
export function AuthForm<S extends AuthState>({
  action,
  emailLabel,
  submitLabel,
  children,
}: {
  action: FormAction<S>;
  emailLabel: string;
  submitLabel: string;
  children: ReactNode;
}) {
  const t = useTranslations('Auth.errors');
  // Every field of an action state is optional, so the empty object is a valid initial state.
  const [state, formAction] = useActionState(action, {} as Awaited<S>);

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error && t(state.error)} />
      <FormField id="email" label={emailLabel} type="email" autoComplete="email" defaultValue={state.email} required />
      {children}
      <SubmitButton className="w-full">{submitLabel}</SubmitButton>
    </form>
  );
}
