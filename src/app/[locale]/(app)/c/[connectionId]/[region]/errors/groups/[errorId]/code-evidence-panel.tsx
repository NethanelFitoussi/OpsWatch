'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormErrorAlert } from '@/components/form-error-alert';
import { SubmitButton } from '@/components/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import type { CodeEvidence } from '@/lib/read/code-evidence';
import type { MappingState } from './actions';

const SELECT_CLASS = 'h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm';

/**
 * Where this error's code lives, and the mapping control beside it (§K, §I).
 *
 * The mapping is offered *here* rather than only in Settings because this is where the question arises. An
 * operator looking at a stack trace that links to the wrong repository wants to fix it in that moment, not
 * to remember to go and find a settings page later.
 */
export function CodeEvidencePanel({
  evidence,
  serviceId,
  repositories,
  action,
}: {
  evidence: CodeEvidence;
  serviceId: string | null;
  repositories: { id: string; owner: string; name: string }[];
  action: FormAction<MappingState>;
}) {
  const t = useTranslations('Monitoring.code');
  const [state, formAction] = useActionState(action, {});

  const chooser = (current: string) =>
    serviceId === null ? null : (
      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="serviceId" value={serviceId} />
        <div className="space-y-1">
          <Label htmlFor="repositoryId">{t('choose')}</Label>
          <select id="repositoryId" name="repositoryId" className={SELECT_CLASS} defaultValue={current}>
            <option value="">{t('none')}</option>
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.owner}/{repository.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pathPrefix">{t('prefix')}</Label>
          <Input id="pathPrefix" name="pathPrefix" placeholder="services/payments" />
          <p className="text-xs text-muted-foreground">{t('prefixHint')}</p>
        </div>
        <SubmitButton>{t('save')}</SubmitButton>
      </form>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <FormErrorAlert message={state.error && t(`errors.${state.error}`)} />
        {state.saved && <p className="text-sm">{t('saved')}</p>}

        {evidence.state === 'unmapped' && (
          <>
            {/* Two different remedies, so the two cases are two sentences rather than one vague one. */}
            <p className="text-sm">{evidence.hasRepositories ? t('noMatch') : t('noRepositories')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {evidence.hasRepositories ? t('noMatchHint') : t('noRepositoriesHint')}
            </p>
            {evidence.hasRepositories && chooser('')}
          </>
        )}

        {evidence.state === 'suggested' && (
          <>
            {/* Offered, never applied: the sentence says OpsWatch is guessing and asks for a decision. */}
            <p className="text-sm">
              {t('suggested', { repository: `${evidence.repository.owner}/${evidence.repository.name}` })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t('suggestedHint', { because: t(`because.${evidence.suggestion.because}`) })}</p>
            {chooser(evidence.repository.id)}
          </>
        )}

        {evidence.state === 'mapped' && (
          <>
            <p className="text-sm">
              {t('mapped', { repository: `${evidence.repository.owner}/${evidence.repository.name}` })}
            </p>
            {/* How much of the stack could be placed, so a short list does not read as the whole trace. */}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('placed', { placed: evidence.placed, total: evidence.frames.length })}
            </p>

            <ul className="mt-2 divide-y">
              {evidence.frames.map((frame) => (
                <li key={frame.raw} className="py-2 text-sm">
                  {frame.url === null ? (
                    <span className="break-all text-muted-foreground">
                      {frame.file}
                      {frame.functionName !== null && ` · ${frame.functionName}`}
                      <span className="ml-2 text-xs">{t('notPlaced')}</span>
                    </span>
                  ) : (
                    <a href={frame.url} target="_blank" rel="noreferrer noopener" className="break-all underline underline-offset-4">
                      {frame.path}
                      {frame.functionName !== null && ` · ${frame.functionName}`}
                    </a>
                  )}
                </li>
              ))}
            </ul>

            {evidence.frames.some((frame) => frame.refIsMoving) && (
              // §13: a frame without a commit is a guess about line numbers, and the page has to say so.
              <p className="mt-2 text-xs text-muted-foreground">
                {t('movingRef', { ref: evidence.frames.find((frame) => frame.ref !== null)?.ref ?? '' })}
              </p>
            )}

            {chooser(evidence.repository.id)}
          </>
        )}
      </CardContent>
    </Card>
  );
}
