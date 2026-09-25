'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { CodeBlock } from '@/components/code-block';
import { FormErrorAlert } from '@/components/form-error-alert';
import { FormField } from '@/components/form-field';
import { SubmitButton } from '@/components/submit-button';
import type { FormAction } from '@/lib/forms/action-state';
import type { DigestState, NotifyState } from './actions';

/**
 * Creating a destination, and testing one.
 *
 * The signing secret comes back from the server exactly once and is rendered here, with the warning that
 * it will not be shown again. It is never read from the database by a page — the only accessor is the
 * delivery path.
 */
export type DestinationScope = { id: string; name: string };

export function CreateDestinationForm({ action, connections }: { action: FormAction<NotifyState>; connections: DestinationScope[] }) {
  const t = useTranslations('Settings.notifications');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error ? t(`errors.${state.error}`) : undefined} />
      <div className="grid gap-3 md:grid-cols-2">
        <FormField id="name" label={t('name')} required maxLength={80} />
        <FormField id="url" label={t('url')} type="url" placeholder="https://example.com/opswatch" required maxLength={2048} hint={t('urlHint')} />
      </div>
      {/* Only worth asking once there is more than one account: with one, "all of them" is the only
          answer, and a select with a single entry is a question nobody needs to be asked. */}
      {connections.length > 1 && (
        <div className="max-w-md space-y-1">
          <label htmlFor="connectionId" className="text-sm font-medium">
            {t('scope')}
          </label>
          <select id="connectionId" name="connectionId" defaultValue="" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">{t('scopeAll')}</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t('scopeHint')}</p>
        </div>
      )}
      <SubmitButton>{t('create')}</SubmitButton>

      {state.signingSecret !== undefined && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">{t('secretTitle')}</p>
          <p className="mt-1 mb-2 text-sm text-muted-foreground">{t('secretHint')}</p>
          <CodeBlock value={state.signingSecret} />
        </div>
      )}
    </form>
  );
}

export function TestDestinationForm({ action }: { action: FormAction<NotifyState> }) {
  const t = useTranslations('Settings.notifications');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <SubmitButton>{t('test')}</SubmitButton>
      {state.tested === true && <span className="text-sm text-emerald-700 dark:text-emerald-400">{t('testOk')}</span>}
      {state.error !== undefined && <span className="text-sm text-red-700 dark:text-red-400">{t(`errors.${state.error}`)}</span>}
    </form>
  );
}

/**
 * The weekly summary (REP-7).
 *
 * The sentence under the switch is the part that matters: with no destination there is nowhere for a
 * summary to go, and the form says so rather than accepting a setting that can never take effect.
 */
export function DigestForm({
  action,
  settings,
  hasDestination,
}: {
  action: FormAction<DigestState>;
  settings: { enabled: boolean; dayOfWeek: number; hourUtc: number; lastSentAt: number | null };
  hasDestination: boolean;
}) {
  const t = useTranslations('Settings.notifications');
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormErrorAlert message={state.error ? t(`errors.${state.error}`) : undefined} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="mt-0.5 size-4" />
        <span>{t('digest.enable')}</span>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="dayOfWeek" className="text-sm font-medium">
            {t('digest.day')}
          </label>
          <select id="dayOfWeek" name="dayOfWeek" defaultValue={settings.dayOfWeek} className="h-9 rounded-md border bg-background px-2 text-sm">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <option key={day} value={day}>
                {t(`digest.days.${day}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="hourUtc" className="text-sm font-medium">
            {t('digest.hour')}
          </label>
          <select id="hourUtc" name="hourUtc" defaultValue={settings.hourUtc} className="h-9 rounded-md border bg-background px-2 text-sm">
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>
        <SubmitButton>{t('digest.save')}</SubmitButton>
      </div>

      {/* A setting that can never take effect is worth saying out loud rather than storing quietly. */}
      {!hasDestination && <p className="text-sm text-muted-foreground">{t('digest.noDestination')}</p>}
      {state.saved === true && <p className="text-sm text-muted-foreground">{t('digest.saved')}</p>}
    </form>
  );
}
