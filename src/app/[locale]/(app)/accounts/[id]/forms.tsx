'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormState } from '../actions';

type Action = (prev: FormState, data: FormData) => Promise<FormState>;

function ErrorAlert({ state }: { state: FormState }) {
  const t = useTranslations('Wizard.errors');
  return state.error ? (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{t(state.error)}</AlertDescription>
    </Alert>
  ) : null;
}

export function RoleArnForm({ action, defaultValue }: { action: Action; defaultValue: string }) {
  const t = useTranslations('AccountDetail.role');
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <ErrorAlert state={state} />
      <Label htmlFor="roleArn">{t('roleArnLabel')}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="roleArn" name="roleArn" defaultValue={state.values?.roleArn ?? defaultValue} className="font-mono" placeholder="arn:aws:iam::123456789012:role/OpsWatchReadOnly-…" required />
        <Button type="submit" disabled={pending}>{t('saveRoleArn')}</Button>
      </div>
    </form>
  );
}

export function AccessKeysForm({ action }: { action: Action }) {
  const t = useTranslations('AccountDetail.keys');
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3" autoComplete="off">
      <ErrorAlert state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="accessKeyId">{t('accessKeyId')}</Label>
          <Input id="accessKeyId" name="accessKeyId" defaultValue={state.values?.accessKeyId} className="font-mono" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="secretAccessKey">{t('secretAccessKey')}</Label>
          <Input id="secretAccessKey" name="secretAccessKey" type="password" className="font-mono" required />
        </div>
      </div>
      <Button type="submit" disabled={pending}>{t('save')}</Button>
    </form>
  );
}
