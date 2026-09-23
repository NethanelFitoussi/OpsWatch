'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { CheckState } from './actions';

export type CheckRow = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  status: 'up' | 'down' | 'unknown';
  lastRunAt: number | null;
  medianMs: number | null;
  hasSecretHeaders: boolean;
};

/**
 * The synthetic checks of one environment.
 *
 * A check is **off until enabled**, because enabling it sends requests from the operator's own host to a
 * third party on a schedule. That is not free and not always welcome, so it is a decision somebody makes
 * rather than a default they discover.
 */
export function SyntheticsForm({
  save,
  remove,
  checks,
}: {
  save: FormAction<CheckState>;
  remove: FormAction<CheckState>;
  checks: CheckRow[];
}) {
  const t = useTranslations('Monitoring.synthetics');
  const [saveState, saveAction] = useActionState(save, {});
  const [removeState, removeAction] = useActionState(remove, {});

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('checks')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FormErrorAlert message={removeState.error && t(`errors.${removeState.error}`)} />
          {checks.length === 0 ? (
            <>
              <p className="text-sm">{t('none')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
            </>
          ) : (
            <ul className="divide-y">
              {checks.map((check) => (
                <li key={check.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="text-sm font-medium">{check.name}</span>
                    <span className="ml-2 break-all text-xs text-muted-foreground">{check.url}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    {/* Three states, never two: a check that has never run is not up. */}
                    <span className="rounded-full bg-muted px-2 py-0.5 tracking-wide uppercase">{t(`status.${check.status}`)}</span>
                    <span className="text-muted-foreground">
                      {check.enabled ? t('on') : t('off')}
                      {check.medianMs !== null && ` · ${t('median', { ms: Math.round(check.medianMs) })}`}
                    </span>
                    <form action={removeAction}>
                      <input type="hidden" name="checkId" value={check.id} />
                      <SubmitButton>{t('remove')}</SubmitButton>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <form action={saveAction}>
        <Card>
          <CardHeader>
            <CardTitle>{t('add')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormErrorAlert message={saveState.error && t(`errors.${saveState.error}`)} />
            {saveState.saved && <p className="text-sm">{t('saved')}</p>}

            <p className="text-sm text-muted-foreground">{t('safety')}</p>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="name">{t('name')}</Label>
                <Input id="name" name="name" required placeholder="Checkout health" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="url">{t('url')}</Label>
                <Input id="url" name="url" required placeholder="https://example.com/healthz" />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="expectStatus">{t('expectStatus')}</Label>
                <Input id="expectStatus" name="expectStatus" placeholder="200, 204" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bodyContains">{t('bodyContains')}</Label>
                <Input id="bodyContains" name="bodyContains" placeholder="ok" />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="latencyThresholdMs">{t('latency')}</Label>
              <Input id="latencyThresholdMs" name="latencyThresholdMs" placeholder="1000" />
              <p className="text-xs text-muted-foreground">{t('latencyHint')}</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="headers">{t('headers')}</Label>
              <Input id="headers" name="headers" placeholder="Authorization: Bearer ..." />
              {/* Stored encrypted and never shown again, because a health endpoint's key ends up here. */}
              <p className="text-xs text-muted-foreground">{t('headersHint')}</p>
            </div>

            <div className="flex items-center gap-2">
              <input id="enabled" name="enabled" type="checkbox" className="size-4" />
              <Label htmlFor="enabled">{t('enable')}</Label>
            </div>

            <SubmitButton>{t('save')}</SubmitButton>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
