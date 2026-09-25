'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SubmitButton } from '@/components/submit-button';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { DefaultEnvironmentState } from './actions';

/**
 * Which AWS account and region this person's own pages open in.
 *
 * It is a **user** preference, not an instance setting: two operators looking after different clients
 * should not have to agree about it, and the row it writes is keyed by the user.
 *
 * It exists because the alternative was silent. A section link clicked from a page with no environment
 * in its URL — Settings, the documentation, Cloudflare — used to go to whichever connection happened to
 * be first, so somebody working in one client's account could land in another's with nothing on screen
 * to say they had moved.
 */

export type EnvironmentChoice = { id: string; label: string };

export function DefaultEnvironment({
  action,
  current,
  choices,
}: {
  action: FormAction<DefaultEnvironmentState>;
  current: string | null;
  choices: EnvironmentChoice[];
}) {
  const t = useTranslations('Settings.defaultEnvironment');
  const [state, submit] = useActionState(action, {});

  return (
    <MonitoringCard title={t('title')} description={t('description')}>
      {choices.length === 0 ? (
        // Nothing to choose between: a select with one entry reading "none" is a control that does nothing.
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <form action={submit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 space-y-1">
            <Label htmlFor="defaultEnvironmentId">{t('label')}</Label>
            <select
              id="defaultEnvironmentId"
              name="defaultEnvironmentId"
              defaultValue={current ?? ''}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">{t('unset')}</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton>{t('save')}</SubmitButton>
          {state.saved === true && <p className="text-sm text-muted-foreground">{t('saved')}</p>}
          {state.error !== undefined && (
            <p role="alert" className="text-sm text-destructive">
              {t(`errors.${state.error}`)}
            </p>
          )}
        </form>
      )}
    </MonitoringCard>
  );
}
