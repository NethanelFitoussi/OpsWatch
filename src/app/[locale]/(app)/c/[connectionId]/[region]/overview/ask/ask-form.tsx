'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { AskState } from './actions';

/**
 * Asking the assistant, and reading the answer for what it is.
 *
 * The layout is the argument. An answer appears under a heading that calls it a **hypothesis**, beside the
 * evidence it was built from, with the model that produced it named. It is never styled as a measurement,
 * because the whole of OpsWatch's credibility rests on a reader being able to tell those apart at a glance.
 */
export function AskForm({ ask, enabled }: { ask: FormAction<AskState>; enabled: boolean }) {
  const t = useTranslations('Monitoring.ask');
  const [state, action] = useActionState(ask, {});

  return (
    <div className="flex flex-col gap-4">
      <form action={action}>
        <Card>
          <CardHeader>
            <CardTitle>{t('question')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />

            {!enabled && <p className="text-sm">{t('disabled')}</p>}

            <div className="space-y-1">
              <Label htmlFor="question">{t('label')}</Label>
              <textarea
                id="question"
                name="question"
                rows={3}
                maxLength={500}
                required
                disabled={!enabled}
                defaultValue={state.question ?? ''}
                placeholder={t('placeholder')}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">{t('scope')}</p>
            </div>

            {/* The button is simply absent when there is no provider: a disabled control invites a click
                that can only fail, and the card above already says what to do instead. */}
            {enabled && <SubmitButton>{t('ask')}</SubmitButton>}
          </CardContent>
        </Card>
      </form>

      {state.answer !== undefined && (
        <Card>
          <CardHeader>
            {/* Band 3. Named as a guess in the heading, not softened in a footnote. */}
            <CardTitle>{t('hypothesis')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('hypothesisHint')}</p>
            <p className="text-sm whitespace-pre-wrap">{state.answer}</p>

            {state.citations !== undefined && state.citations.length > 0 && (
              <div>
                <p className="text-sm font-medium">{t('builtFrom')}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {state.citations.map((citation) => (
                    <li key={`${citation.type}:${citation.id}`}>
                      {t(`refs.${citation.type}`)}: {citation.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {state.model !== undefined && <p className="text-xs text-muted-foreground">{t('by', { model: state.model })}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
