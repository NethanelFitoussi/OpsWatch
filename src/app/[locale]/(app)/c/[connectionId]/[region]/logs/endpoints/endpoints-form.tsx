'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SourcesView } from '@/lib/read/log-sources';
import type { FormAction } from '@/lib/forms/action-state';
import type { EndpointsState } from './actions';
import { WINDOW_CHOICES } from './window-choices';

const SELECT_CLASS = 'h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm';

/** The two presets §3b names, plus whatever the operator already mapped for error collection. */
const FIELD_PRESETS = [
  { id: 'json', routeField: 'path', durationField: 'duration_ms' },
  { id: 'api', routeField: 'route', durationField: 'duration' },
];

const ms = (value: number | null, notMeasured: string) =>
  value === null ? notMeasured : `${value >= 100 ? Math.round(value) : value.toFixed(1)} ms`;

/**
 * Slowest endpoints.
 *
 * It runs on a button rather than on page load, and that is the whole design. This is the one surface whose
 * rendering would otherwise scan gigabytes of logs, so the cost is stated first and an operator asks for it.
 */
export function EndpointsForm({
  action,
  enabledSources,
  budget,
  suggested,
}: {
  action: FormAction<EndpointsState>;
  enabledSources: string[];
  budget: SourcesView['budget'];
  /** The mapping the operator already configured for error collection, if it names a route field. */
  suggested: { routeField: string; durationField: string } | null;
}) {
  const t = useTranslations('Monitoring.endpoints');
  const [state, formAction] = useActionState(action, {});
  const [routeField, setRouteField] = useState(suggested?.routeField ?? 'route');
  const [durationField, setDurationField] = useState(suggested?.durationField ?? 'duration');
  const notMeasured = t('notMeasured');

  const applyPreset = (id: string) => {
    const preset = FIELD_PRESETS.find((one) => one.id === id);
    if (preset === undefined) return;
    setRouteField(preset.routeField);
    setDurationField(preset.durationField);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('cost')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{t('why')}</p>
          <p className="mt-2 text-sm">
            {t('budget', {
              scanned: budget.scannedGb.toFixed(2),
              // Two decimals like the figures either side of it: a share is rarely a whole number,
              // and "0.00 GB of 0.5 GB. 0.50 GB left" reads like three different units.
              limit: budget.limitGb.toFixed(2),
              remaining: Math.max(0, budget.remainingGb).toFixed(2),
            })}
          </p>
          {/* Only when there is a share to explain: on a one-account installation the cap is the cap. */}
          {budget.shares > 1 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('budgetShare', { shares: budget.shares, instanceLimit: budget.instanceLimitGb })}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{t('costHint')}</p>
        </CardContent>
      </Card>

      {enabledSources.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Not "no endpoints": nothing is switched on to read, which is a different fact. */}
            <p className="text-sm">{t('noSources')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('noSourcesHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <form action={formAction}>
          <Card>
            <CardHeader>
              <CardTitle>{t('configure')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />

              <p className="text-sm text-muted-foreground">
                {t('sources', { count: enabledSources.length, groups: enabledSources.join(', ') })}
              </p>

              <div className="space-y-2">
                <Label htmlFor="preset">{t('preset')}</Label>
                <select id="preset" className={SELECT_CLASS} defaultValue="" onChange={(event) => applyPreset(event.target.value)}>
                  <option value="">{t('presetCustom')}</option>
                  {FIELD_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {t(`presets.${preset.id}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="routeField">{t('routeField')}</Label>
                  <Input id="routeField" name="routeField" required value={routeField} onChange={(event) => setRouteField(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="durationField">{t('durationField')}</Label>
                  <Input id="durationField" name="durationField" required value={durationField} onChange={(event) => setDurationField(event.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hours">{t('window')}</Label>
                <select id="hours" name="hours" className={SELECT_CLASS} defaultValue="3">
                  {WINDOW_CHOICES.map((hours) => (
                    <option key={hours} value={hours}>
                      {t('hours', { hours })}
                    </option>
                  ))}
                </select>
                {/* §3b: nothing longer than a day, like the rest of the Logs section. */}
                <p className="text-xs text-muted-foreground">{t('windowHint')}</p>
              </div>

              <SubmitButton>{t('run')}</SubmitButton>
            </CardContent>
          </Card>
        </form>
      )}

      {state.bytesScanned !== undefined && (
        <Card>
          <CardHeader>
            <CardTitle>{t('results')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('scanned', { mb: (state.bytesScanned / 1024 ** 2).toFixed(1) })}
            </p>

            {state.matchedNothing ? (
              <div className="mt-3">
                {/* The mapping is wrong, not the application. Show the lines so it can be corrected. */}
                <p className="text-sm">{t('noMatch', { route: routeField, duration: durationField })}</p>
                {(state.samples ?? []).length > 0 && (
                  <>
                    <p className="mt-2 text-sm font-medium">{t('samplesTitle')}</p>
                    <ul className="mt-1 space-y-1">
                      {(state.samples ?? []).map((line, index) => (
                        // A sample log line is usually wider than a phone, and nothing in it is focusable.
                        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                        <li key={index} tabIndex={0} className="overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs whitespace-pre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('route')}</TableHead>
                      <TableHead className="text-right">{t('hits')}</TableHead>
                      <TableHead className="text-right">{t('p95')}</TableHead>
                      <TableHead className="text-right">{t('average')}</TableHead>
                      <TableHead className="text-right">{t('max')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(state.rows ?? []).map((row) => (
                      <TableRow key={row.route}>
                        <TableCell className="max-w-xs break-all">{row.route}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                        <TableCell className="text-right tabular-nums">{ms(row.p95Ms, notMeasured)}</TableCell>
                        <TableCell className="text-right tabular-nums">{ms(row.averageMs, notMeasured)}</TableCell>
                        <TableCell className="text-right tabular-nums">{ms(row.maxMs, notMeasured)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">{t('p95Hint')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
