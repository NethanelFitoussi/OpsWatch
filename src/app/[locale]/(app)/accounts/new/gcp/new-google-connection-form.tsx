'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { SubmitButton } from '@/components/submit-button';
import type { FormAction } from '@/lib/forms/action-state';
import type { FormState } from '../../actions';

/**
 * The names a Google Cloud connection is made of.
 *
 * Every field is a name, and none of them is a secret — which is the whole point of the method and
 * worth the operator noticing. The pool and provider are what they will call the things they are about
 * to create, so the defaults are the names the instructions on the next page will use.
 */
export function NewGoogleConnectionForm({ action }: { action: FormAction<FormState> }) {
  const t = useTranslations('GoogleWizard');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction}>
      <SectionCard title={t('formTitle')} description={t('formHint')} contentClassName="space-y-4">
        <FormErrorAlert message={state.error === undefined ? undefined : t(`errors.${state.error}`)} />

        <FormField id="name" label={t('name')} hint={t('nameHint')} defaultValue={state.values?.name} required maxLength={80} />
        <FormField id="projectId" label={t('projectId')} hint={t('projectIdHint')} required />
        <FormField id="regions" label={t('regions')} hint={t('regionsHint')} defaultValue="us-central1" required />
        <FormField id="projectNumber" label={t('projectNumber')} hint={t('projectNumberHint')} required inputMode="numeric" />
        <FormField id="poolId" label={t('poolId')} hint={t('poolIdHint')} defaultValue="opswatch" required />
        <FormField id="providerId" label={t('providerId')} hint={t('providerIdHint')} defaultValue="opswatch" required />
        {/* Optional, and said so: federating straight to a resource without impersonating anything is
            equally valid, and an operator whose organisation reviews service accounts will want one. */}
        <FormField id="serviceAccount" label={t('serviceAccount')} hint={t('serviceAccountHint')} />

        <SubmitButton>{t('submit')}</SubmitButton>
      </SectionCard>
    </form>
  );
}
