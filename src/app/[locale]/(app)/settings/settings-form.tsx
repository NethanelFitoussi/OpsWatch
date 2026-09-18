'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import { TIME_RANGES } from '@/lib/monitoring/shared/time-range';
import { COST_SERVICES, REFRESH_INTERVALS_MS, refreshCostPerHour, type AppSettings } from '@/lib/settings/shared';
import type { SettingsFormState } from './actions';

const SELECT_CLASS = 'h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm';

export function SettingsForm({ action, current }: { action: FormAction<SettingsFormState>; current: AppSettings }) {
  const t = useTranslations('Settings');
  const rangeOptions = useTranslations('Monitoring.client.range.options');
  const format = useFormatter();
  const [state, formAction] = useActionState(action, {});
  // The cost sentence follows the choice before it is saved, so the price is visible while choosing.
  const [refreshMs, setRefreshMs] = useState(current.refreshIntervalMs);
  const cost = refreshCostPerHour(refreshMs);

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />
      <Card>
        <CardHeader>
          <CardTitle>{t('refresh.title')}</CardTitle>
          <CardDescription>{t('refresh.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="refreshIntervalMs">{t('refresh.label')}</Label>
          <select
            id="refreshIntervalMs"
            name="refreshIntervalMs"
            className={SELECT_CLASS}
            value={refreshMs}
            onChange={(event) => setRefreshMs(Number(event.target.value))}
            aria-describedby="refreshIntervalMs-cost"
          >
            {REFRESH_INTERVALS_MS.map((ms) => (
              <option key={ms} value={ms}>
                {t(`refresh.options.${ms}`)}
              </option>
            ))}
          </select>
          <p id="refreshIntervalMs-cost" className="text-sm text-muted-foreground">
            {refreshMs <= 0
              ? t('refresh.costOff')
              : t('refresh.cost', {
                  services: COST_SERVICES,
                  metrics: format.number(cost.metricsPerHour),
                  usd: format.number(cost.usdPerHour, { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }),
                })}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('range.title')}</CardTitle>
          <CardDescription>{t('range.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="defaultRange">{t('range.label')}</Label>
          <select id="defaultRange" name="defaultRange" className={SELECT_CLASS} defaultValue={current.defaultRange}>
            {TIME_RANGES.map((range) => (
              <option key={range} value={range}>
                {rangeOptions(range)}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t('save')}</SubmitButton>
        {state.saved && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  );
}
