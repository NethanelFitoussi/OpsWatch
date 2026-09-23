'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { ObjectiveState } from './actions';

export type ObjectiveRow = {
  id: string;
  name: string;
  kind: 'availability' | 'latency';
  subjectId: string;
  /** A fraction, as stored. The page renders it as a percentage. */
  target: number;
  current: number | null;
  status: 'healthy' | 'at_risk' | 'breached' | 'unknown';
  budgetRemaining: number | null;
  window: string;
  enabled: boolean;
};

/** Percentages, to the precision an objective is actually written at. `null` is never rendered as a number. */
const percent = (value: number | null, digits: number) => (value === null ? null : `${(value * 100).toFixed(digits)}%`);

/**
 * The objectives of one environment, and what the stored history says about them.
 *
 * The screen keeps a target and a measurement visibly apart. A definition somebody wrote down is a
 * decision; the figure beside it is only there when enough history exists to support one, and says
 * "not measured" rather than borrowing a number when it does not.
 */
export function ObjectivesForm({
  save,
  remove,
  objectives,
  subjects,
}: {
  save: FormAction<ObjectiveState>;
  remove: FormAction<ObjectiveState>;
  objectives: ObjectiveRow[];
  subjects: string[];
}) {
  const t = useTranslations('Monitoring.objectives');
  const [saveState, saveAction] = useActionState(save, {});
  const [removeState, removeAction] = useActionState(remove, {});

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('defined')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FormErrorAlert message={removeState.error && t(`errors.${removeState.error}`)} />
          {objectives.length === 0 ? (
            <>
              <p className="text-sm">{t('none')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
            </>
          ) : (
            <ul className="divide-y">
              {objectives.map((objective) => (
                <li key={objective.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="text-sm font-medium">{objective.name}</span>
                    <span className="ml-2 break-all text-xs text-muted-foreground">
                      {t(`kinds.${objective.kind}`)} · {objective.subjectId} · {objective.window}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    <span className="rounded-full bg-muted px-2 py-0.5 tracking-wide uppercase">{t(`status.${objective.status}`)}</span>
                    <span className="text-muted-foreground">
                      {t('target', { value: percent(objective.target, 3) ?? '' })}
                      {' · '}
                      {/* Four states, and "not measured" is one of them (§2.6). */}
                      {objective.current === null
                        ? t('notMeasured')
                        : t('current', { value: percent(objective.current, 3) ?? '' })}
                      {objective.budgetRemaining !== null && ` · ${t('budget', { value: percent(objective.budgetRemaining, 1) ?? '' })}`}
                    </span>
                    <form action={removeAction}>
                      <input type="hidden" name="objectiveId" value={objective.id} />
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

            <p className="text-sm text-muted-foreground">{t('sameNameHint')}</p>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="name">{t('name')}</Label>
                <Input id="name" name="name" required placeholder="Checkout availability" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="subjectId">{t('subject')}</Label>
                <Input id="subjectId" name="subjectId" required list="objective-subjects" placeholder="app/prod-web/1a2b3c" />
                <datalist id="objective-subjects">
                  {subjects.map((subject) => (
                    <option key={subject} value={subject} />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">{subjects.length === 0 ? t('subjectsEmpty') : t('subjectHint')}</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="kind">{t('kind')}</Label>
                <select
                  id="kind"
                  name="kind"
                  defaultValue="availability"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  <option value="availability">{t('kinds.availability')}</option>
                  <option value="latency">{t('kinds.latency')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="objective">{t('objective')}</Label>
                <Input id="objective" name="objective" required defaultValue="99.9" inputMode="decimal" />
                <p className="text-xs text-muted-foreground">{t('objectiveHint')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="windowDays">{t('window')}</Label>
                <Input id="windowDays" name="windowDays" required defaultValue="30" inputMode="numeric" />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="latencyThresholdMs">{t('threshold')}</Label>
              <Input id="latencyThresholdMs" name="latencyThresholdMs" placeholder="500" inputMode="numeric" />
              {/* The bucket approximation, said here rather than in a footnote — §19 asks for the sentence. */}
              <p className="text-xs text-muted-foreground">{t('thresholdHint')}</p>
            </div>

            <div className="flex items-center gap-2">
              <input id="enabled" name="enabled" type="checkbox" className="size-4" defaultChecked />
              <Label htmlFor="enabled">{t('enable')}</Label>
            </div>

            <SubmitButton>{t('save')}</SubmitButton>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
