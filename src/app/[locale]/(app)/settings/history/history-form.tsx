'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import { HISTORY_INTERVALS, RETENTION_CHOICES } from '@/lib/history/shared';
import type { HistoryState } from './actions';

const SELECT_CLASS = 'h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm';

export type HistoryFormSettings = {
  enabled: boolean;
  intervalMinutes: number;
  categories: string[];
  retentionDays: number;
  providerId: string;
};

/**
 * The history switch.
 *
 * Enabling it starts spending an operator's money, so the control is an explicit checkbox that is **off
 * until they tick it** — never a default, never inferred from anything else they did.
 */
export function HistoryForm({
  action,
  settings,
  categories,
}: {
  action: FormAction<HistoryState>;
  settings: HistoryFormSettings;
  categories: string[];
}) {
  const t = useTranslations('Settings.history');
  const [state, formAction] = useActionState(action, {});
  const [enabled, setEnabled] = useState(settings.enabled);

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />
      {state.saved && <p className="text-sm">{t('saved')}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{enabled ? t('state.on') : t('state.off')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              id="enabled"
              name="enabled"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="size-4"
            />
            {/* An action, not the state: the card title above already says which state it is in. */}
            <Label htmlFor="enabled">{t('enable')}</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intervalMinutes">{t('interval')}</Label>
            <select id="intervalMinutes" name="intervalMinutes" className={SELECT_CLASS} defaultValue={settings.intervalMinutes}>
              {HISTORY_INTERVALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t('intervalOption', { minutes })}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('categories')}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {categories.map((category) => (
                <label key={category} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="categories"
                    value={category}
                    defaultChecked={settings.categories.includes(category)}
                    className="size-4"
                  />
                  {t(`category.${category}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="retentionDays">{t('retention')}</Label>
            <select id="retentionDays" name="retentionDays" className={SELECT_CLASS} defaultValue={settings.retentionDays}>
              {RETENTION_CHOICES.map((days) => (
                <option key={days} value={days}>
                  {t('retentionDays', { days })}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-muted-foreground">
            {t('provider')}: {settings.providerId}
          </p>
        </CardContent>
      </Card>

      <SubmitButton>{t('save')}</SubmitButton>
    </form>
  );
}
