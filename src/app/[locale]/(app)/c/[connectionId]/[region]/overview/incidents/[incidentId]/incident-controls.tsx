'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { IncidentActionState } from './actions';

const SELECT_CLASS = 'h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm';

/**
 * Moving an incident along, and adding a note to its timeline.
 *
 * The status control offers the *stored* lifecycle rather than the contract's four, because this is where
 * somebody records what is actually happening — "identified" is a real state of an investigation even
 * though a reader elsewhere sees it as "investigating".
 */
export function IncidentControls({
  action,
  incidentId,
  status,
  canDismiss,
}: {
  action: FormAction<IncidentActionState>;
  incidentId: string;
  status: string;
  canDismiss: boolean;
}) {
  const t = useTranslations('Monitoring.incidents');
  const [state, formAction] = useActionState(action, {});

  return (
    <div className="space-y-4">
      <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />
      {state.saved && <p className="text-sm">{t('saved')}</p>}

      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="incidentId" value={incidentId} />
        <div className="space-y-1">
          <Label htmlFor="intent">{t('setStatus')}</Label>
          <select id="intent" name="intent" className={SELECT_CLASS} defaultValue={status}>
            {['investigating', 'identified', 'monitoring', 'resolved'].map((option) => (
              <option key={option} value={option}>
                {t(`stored.${option}`)}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton>{t('update')}</SubmitButton>
      </form>

      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="incidentId" value={incidentId} />
        <input type="hidden" name="intent" value="note" />
        <div className="grow space-y-1">
          <Label htmlFor="note">{t('addNote')}</Label>
          <Input id="note" name="note" placeholder={t('notePlaceholder')} />
        </div>
        <SubmitButton>{t('add')}</SubmitButton>
      </form>

      {canDismiss && (
        <form action={formAction}>
          <input type="hidden" name="incidentId" value={incidentId} />
          <input type="hidden" name="intent" value="dismiss" />
          {/* Only for one OpsWatch raised: dismissing a person's incident would delete their judgement. */}
          <p className="text-xs text-muted-foreground">{t('dismissHint')}</p>
          <SubmitButton>{t('dismiss')}</SubmitButton>
        </form>
      )}
    </div>
  );
}
