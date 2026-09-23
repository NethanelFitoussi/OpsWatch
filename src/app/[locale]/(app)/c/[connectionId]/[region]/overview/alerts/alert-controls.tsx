'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import type { FormAction } from '@/lib/forms/action-state';
import type { AlertActionState } from './actions';

/** The one thing a reader can do to an alert, and the one thing they can do to a rule. */
export function AlertControls({
  acknowledge,
  toggle,
  alerts,
  rules,
}: {
  acknowledge: FormAction<AlertActionState>;
  toggle: FormAction<AlertActionState>;
  alerts: { id: string; name: string; canAcknowledge: boolean }[];
  rules: { id: string; name: string; enabled: boolean; cooldownMinutes: number }[];
}) {
  const t = useTranslations('Monitoring.alerts');
  const [ackState, ackAction] = useActionState(acknowledge, {});
  const [ruleState, ruleAction] = useActionState(toggle, {});

  return (
    <div className="space-y-4">
      <FormErrorAlert message={(ackState.error ?? ruleState.error) && t(`errors.${ackState.error ?? ruleState.error}`)} />
      {(ackState.saved ?? ruleState.saved) && <p className="text-sm">{t('saved')}</p>}

      {alerts.some((alert) => alert.canAcknowledge) && (
        <div>
          <p className="text-sm font-medium">{t('acknowledgeTitle')}</p>
          {/* What acknowledging actually does, said where the button is. */}
          <p className="text-xs text-muted-foreground">{t('acknowledgeHint')}</p>
          <ul className="mt-2 divide-y">
            {alerts
              .filter((alert) => alert.canAcknowledge)
              .map((alert) => (
                <li key={alert.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">{alert.name}</span>
                  <form action={ackAction}>
                    <input type="hidden" name="alertId" value={alert.id} />
                    <SubmitButton>{t('acknowledge')}</SubmitButton>
                  </form>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-sm font-medium">{t('rules')}</p>
        <p className="text-xs text-muted-foreground">{t('rulesDescription')}</p>
        <ul className="mt-2 divide-y">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
              <span>
                {t(`rule.${rule.name}`)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {rule.enabled ? t('enabled') : t('disabled')} · {t('cooldown', { minutes: rule.cooldownMinutes })}
                </span>
              </span>
              <form action={ruleAction}>
                <input type="hidden" name="ruleId" value={rule.id} />
                <SubmitButton>{rule.enabled ? t('turnOff') : t('turnOn')}</SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
