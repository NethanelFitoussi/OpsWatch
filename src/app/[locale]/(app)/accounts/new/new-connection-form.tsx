'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CONNECTION_METHODS, type ConnectionMethod } from '@/lib/connections/types';
import { AWS_REGIONS } from '@/lib/connections/validation';
import { cn } from '@/lib/utils';
import type { FormState } from '../actions';

export function NewConnectionForm({ action }: { action: (prev: FormState, data: FormData) => Promise<FormState> }) {
  const t = useTranslations('Wizard');
  const [state, formAction, pending] = useActionState(action, {});
  const [method, setMethod] = useState<ConnectionMethod>('role');

  return (
    <form action={formAction} className="space-y-8">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
        </Alert>
      )}

      <fieldset>
        <legend className="mb-3 font-medium">{t('methodLegend')}</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {CONNECTION_METHODS.map((m) => (
            <label
              key={m}
              className={cn(
                'relative cursor-pointer rounded-xl border p-4 transition-colors focus-within:outline-2 focus-within:outline-ring',
                method === m ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
              )}
            >
              <input
                type="radio"
                name="method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 font-medium">
                {t(`methods.${m}.title`)}
                {m === 'role' && <Badge>{t('recommended')}</Badge>}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(`methods.${m}.description`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">{t('name')}</Label>
          <Input id="name" name="name" placeholder={t('namePlaceholder')} maxLength={80} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="awsAccountId">{t('accountId')}</Label>
          <Input
            id="awsAccountId"
            name="awsAccountId"
            inputMode="numeric"
            pattern="[0-9 -]{12,14}"
            placeholder="123456789012"
            required
            aria-describedby="account-hint"
          />
          <p id="account-hint" className="text-xs text-muted-foreground">{t('accountIdHint')}</p>
        </div>
      </div>

      <fieldset>
        <legend className="font-medium">{t('regions')}</legend>
        <p className="mb-3 text-xs text-muted-foreground">{t('regionsHint')}</p>
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-3 lg:grid-cols-4">
          {AWS_REGIONS.map((region) => (
            <label key={region} className="flex items-center gap-2 font-mono text-sm">
              <Checkbox name="regions" value={region} />
              {region}
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>{t('submit')}</Button>
    </form>
  );
}
