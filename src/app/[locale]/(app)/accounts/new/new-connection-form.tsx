'use client';

import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AWS_REGIONS } from '@/lib/aws/regions';
import { CONNECTION_METHODS, type ConnectionMethod } from '@/lib/connections/types';
import type { FormAction } from '@/lib/forms/action-state';
import { CONNECTION_NAME_MAX } from '@/lib/limits';
import { cn } from '@/lib/utils';
import type { FormState } from '../actions';

/** One group of the form: a bordered panel, like the cards of the other pages. */
const PANEL = 'rounded-xl border bg-card p-4 sm:p-6';

export function NewConnectionForm({ action }: { action: FormAction<FormState> }) {
  const t = useTranslations('Wizard');
  const [state, formAction] = useActionState(action, {});
  const [method, setMethod] = useState<ConnectionMethod>('role');
  const selectedRegions = new Set(state.values?.regions);

  return (
    <form action={formAction} className="max-w-5xl space-y-6">
      <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />

      <fieldset className={PANEL}>
        <legend className="float-left mb-4 w-full font-semibold">{t('methodLegend')}</legend>
        <div className="clear-left grid gap-3 md:grid-cols-3">
          {CONNECTION_METHODS.map((m) => (
            <label
              key={m}
              className={cn(
                'relative cursor-pointer rounded-xl border p-4 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
                method === m ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40 hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name="method"
                value={m}
                // Uncontrolled on purpose: React resets the form after the action, and a reset
                // restores the default, which follows the selected method.
                defaultChecked={method === m}
                onChange={() => setMethod(m)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 pr-6 font-medium">
                {t(`methods.${m}.title`)}
                {m === 'role' && <Badge>{t('recommended')}</Badge>}
              </span>
              {method === m && <CircleCheck className="absolute top-4 right-4 size-5 text-primary" aria-hidden />}
              <span className="mt-1 block text-sm text-muted-foreground">{t(`methods.${m}.description`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={cn(PANEL, 'grid gap-6 md:grid-cols-2')}>
        <FormField
          id="name"
          label={t('name')}
          defaultValue={state.values?.name}
          placeholder={t('namePlaceholder')}
          maxLength={CONNECTION_NAME_MAX}
          required
        />
        <FormField
          id="awsAccountId"
          label={t('accountId')}
          hint={t('accountIdHint')}
          defaultValue={state.values?.awsAccountId}
          inputMode="numeric"
          pattern="[0-9 -]{12,14}"
          placeholder="123456789012"
          required
        />
      </div>

      <fieldset className={PANEL} aria-describedby="regions-hint">
        <legend className="float-left w-full font-semibold">{t('regions')}</legend>
        <p id="regions-hint" className="clear-left mb-4 pt-1 text-sm text-muted-foreground">{t('regionsHint')}</p>
        <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded-lg border bg-muted/30 p-2 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {AWS_REGIONS.map((region) => (
            <label key={region} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-mono text-sm hover:bg-accent">
              {/* Radix resets a checkbox to the value it mounted with when the form resets after an
                  action, so a checkbox remounts whenever the echoed selection changes its state. */}
              <Checkbox
                key={`${region}:${selectedRegions.has(region)}`}
                name="regions"
                value={region}
                defaultChecked={selectedRegions.has(region)}
              />
              {region}
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton className="h-9 px-4">{t('submit')}</SubmitButton>
    </form>
  );
}
