'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import { MAPPABLE_FIELDS, SOURCE_PRESETS, presetById, type FieldMapValues } from '@/lib/errors/source-presets';
import type { ConfiguredSource, SourcesView } from '@/lib/read/log-sources';
import type { SearchState, SourceState } from './actions';

const SELECT_CLASS = 'h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm';

/**
 * Choosing which log groups OpsWatch reads, and how to read them.
 *
 * Two decisions are visible in the shape. Discovery is a **search**, not a listing, because listing groups
 * is an AWS call and an operator who has already configured their sources should pay nothing to review them.
 * And the enable checkbox is **off until ticked**, because enabling one starts scanning logs, which is
 * billed per gigabyte.
 */
export function SourcesForm({
  save,
  search,
  sources,
  budget,
}: {
  save: FormAction<SourceState>;
  search: FormAction<SearchState>;
  sources: ConfiguredSource[];
  budget: SourcesView['budget'];
}) {
  const t = useTranslations('Monitoring.sources');
  const [saveState, saveAction] = useActionState(save, {});
  const [searchState, searchAction] = useActionState(search, {});

  // What the editor is currently pointed at. Picking a discovered group or a configured one fills it in.
  const [group, setGroup] = useState('');
  const [preset, setPreset] = useState('json');
  const [fields, setFields] = useState<FieldMapValues>({});
  const [enabled, setEnabled] = useState(false);
  const [serviceId, setServiceId] = useState('');

  const chosen = presetById(preset);
  const format = chosen?.format ?? 'json';
  const placeholderFor = (field: string) => chosen?.fields[field as keyof FieldMapValues] ?? '';

  const edit = (source: ConfiguredSource) => {
    setGroup(source.logGroup);
    setPreset(source.preset === 'custom' ? 'json' : source.preset);
    setFields(source.fields);
    setEnabled(source.enabled);
    setServiceId(source.serviceId ?? '');
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('cost')}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Said before the decision, not after: §9.5's budget is a hard stop, not a warning. */}
          <p className="text-sm">
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
          {budget.exhausted && <p className="mt-1 text-sm">{t('budgetExhausted')}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{t('costHint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('configured')}</CardTitle>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <>
              {/* Not "no log groups": nothing has been switched on, which is a different fact. */}
              <p className="text-sm">{t('noneConfigured')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('noneConfiguredHint')}</p>
            </>
          ) : (
            <ul className="divide-y">
              {sources.map((source) => (
                <li key={source.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="min-w-0 break-all text-sm">{source.logGroup}</span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{source.enabled ? t('on') : t('off')}</span>
                    <button type="button" onClick={() => edit(source)} className="underline underline-offset-4">
                      {t('edit')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('find')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={searchAction} className="flex flex-wrap items-end gap-2">
            <div className="grow">
              <Label htmlFor="search">{t('searchLabel')}</Label>
              <Input id="search" name="search" placeholder={t('searchPlaceholder')} />
            </div>
            <SubmitButton>{t('searchAction')}</SubmitButton>
          </form>
          <FormErrorAlert message={searchState.error && t(`errors.${searchState.error}`)} />

          {searchState.groups !== undefined &&
            (searchState.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noMatches', { search: searchState.searched ?? '' })}</p>
            ) : (
              <ul className="divide-y">
                {searchState.groups.map((found) => (
                  <li key={found.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setGroup(found.name)}
                      className="min-w-0 break-all text-left underline underline-offset-4"
                    >
                      {found.name}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {/* A searched group comes back without its size, so this says so rather than "0 B". */}
                      {found.storedBytes === null
                        ? t('sizeUnknown')
                        : t('size', { gb: (found.storedBytes / 1024 ** 3).toFixed(2) })}
                      {found.retentionDays === null ? ` · ${t('noRetention')}` : ` · ${t('retention', { days: found.retentionDays })}`}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </CardContent>
      </Card>

      <form action={saveAction}>
        <Card>
          <CardHeader>
            <CardTitle>{t('configure')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormErrorAlert message={saveState.error && t(`errors.${saveState.error}`)} />
            {saveState.saved && <p className="text-sm">{t('saved')}</p>}

            <div className="space-y-2">
              <Label htmlFor="logGroup">{t('logGroup')}</Label>
              <Input id="logGroup" name="logGroup" required value={group} onChange={(event) => setGroup(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preset">{t('preset')}</Label>
              <select id="preset" name="preset" className={SELECT_CLASS} value={preset} onChange={(event) => setPreset(event.target.value)}>
                {SOURCE_PRESETS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {t(`presets.${option.id}`)}
                  </option>
                ))}
              </select>
              <input type="hidden" name="format" value={format} />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('fields')}</legend>
              <p className="text-xs text-muted-foreground">{t('fieldsHint')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {MAPPABLE_FIELDS.map((field) => (
                  <div key={field} className="space-y-1">
                    <Label htmlFor={`field.${field}`}>{t(`field.${field}`)}</Label>
                    <Input
                      id={`field.${field}`}
                      name={`field.${field}`}
                      placeholder={placeholderFor(field)}
                      value={fields[field] ?? ''}
                      onChange={(event) => setFields((current) => ({ ...current, [field]: event.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="serviceId">{t('service')}</Label>
              <Input id="serviceId" name="serviceId" value={serviceId} onChange={(event) => setServiceId(event.target.value)} />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="enabled"
                name="enabled"
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="size-4"
              />
              {/* An action, not a state: what it will start doing, and what that costs. */}
              <Label htmlFor="enabled">{t('enable')}</Label>
            </div>

            <SubmitButton>{t('save')}</SubmitButton>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
