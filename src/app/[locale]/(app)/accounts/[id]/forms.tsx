'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';
import { AWS_REGIONS } from '@/lib/aws/regions';
import { CONNECTION_NAME_MAX } from '@/lib/limits';
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

/**
 * The connection's own details: what it is called, and which regions OpsWatch reads.
 *
 * Both are corrections a running installation needs — a renamed environment, a service that moved — and
 * neither should cost the connection its history. The account and the method are not here: they are what
 * the connection *is*, and changing them is a new connection rather than an edit.
 */
export function ConnectionDetailsForm({
  action,
  name,
  regions,
}: {
  action: FormAction<FormState>;
  name: string;
  regions: readonly string[];
}) {
  const t = useTranslations('AccountDetail.details');
  const { state, formAction, error } = useConnectionForm(action);
  const chosen = new Set(state.values?.regions ?? regions);

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={error} />
      <FormField id="name" label={t('name')} defaultValue={state.values?.name ?? name} required maxLength={CONNECTION_NAME_MAX} />
      <fieldset aria-describedby="edit-regions-hint">
        <legend className="font-medium">{t('regions')}</legend>
        <p id="edit-regions-hint" className="mt-1 mb-3 text-sm text-muted-foreground">
          {t('regionsHint')}
        </p>
        <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-3">
          {AWS_REGIONS.map((region) => (
            <label key={region} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-mono text-sm hover:bg-accent">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                // Re-keyed on the value so a re-render after a failed submit shows what was sent.
                key={`${region}:${chosen.has(region)}`}
                name="regions"
                value={region}
                defaultChecked={chosen.has(region)}
              />
              {region}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton>{t('save')}</SubmitButton>
    </form>
  );
}
