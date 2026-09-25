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
 * A name and a token.
 *
 * The token field is a password field and is **never** repopulated after an error, unlike every other
 * form in this product: a field filled back in with somebody's token is that token sitting in a page's
 * HTML, where a screenshot or a cached page keeps it. Retyping it is the cost of not doing that.
 */
export function NewDoConnectionForm({ action }: { action: FormAction<FormState> }) {
  const t = useTranslations('DoWizard');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction}>
      <SectionCard title={t('formTitle')} description={t('formHint')} contentClassName="space-y-4">
        <FormErrorAlert message={state.error === undefined ? undefined : t(`errors.${state.error}`)} />

        <FormField id="name" label={t('name')} hint={t('nameHint')} defaultValue={state.values?.name} required maxLength={80} />
        <FormField id="token" label={t('token')} hint={t('tokenHint')} type="password" required autoComplete="off" />

        <SubmitButton>{t('submit')}</SubmitButton>
      </SectionCard>
    </form>
  );
}
