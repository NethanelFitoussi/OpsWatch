'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { FormState } from '../actions';

function useConnectionForm(action: FormAction<FormState>) {
  const errors = useTranslations('Wizard.errors');
  const [state, formAction] = useActionState(action, {});
  return { state, formAction, error: state.error && errors(state.error) };
}

export function RoleArnForm({ action, defaultValue }: { action: FormAction<FormState>; defaultValue: string }) {
  const t = useTranslations('AccountDetail.role');
  const { state, formAction, error } = useConnectionForm(action);
  return (
    <form action={formAction} className="space-y-3">
      <FormErrorAlert message={error} />
      <Label htmlFor="roleArn">{t('roleArnLabel')}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="roleArn" name="roleArn" defaultValue={state.values?.roleArn ?? defaultValue} className="font-mono" placeholder="arn:aws:iam::123456789012:role/OpsWatchReadOnly-…" required />
        <SubmitButton>{t('saveRoleArn')}</SubmitButton>
      </div>
    </form>
  );
}

export function AccessKeysForm({ action }: { action: FormAction<FormState> }) {
  const t = useTranslations('AccountDetail.keys');
  const { state, formAction, error } = useConnectionForm(action);
  return (
    <form action={formAction} className="space-y-3" autoComplete="off">
      <FormErrorAlert message={error} />
      <div className="grid gap-3 md:grid-cols-2">
        <FormField id="accessKeyId" label={t('accessKeyId')} defaultValue={state.values?.accessKeyId} className="font-mono" required />
        <FormField id="secretAccessKey" label={t('secretAccessKey')} type="password" className="font-mono" required />
      </div>
      <SubmitButton>{t('save')}</SubmitButton>
    </form>
  );
}
