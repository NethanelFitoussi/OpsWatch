'use client';

import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { FormAction } from '@/lib/forms/action-state';
import { MAX_REQUEST_LENGTH_CLIENT } from '@/lib/monitoring/shared/ai-query';
import { buildSearchQuery } from '@/lib/monitoring/shared/logs-search';
import type { ProposeState } from './actions';

/**
 * Asking the optional assistant to fill in the search box.
 *
 * Three things this panel is arranged to make obvious, because they are the whole reason it is safe:
 *
 *   1. **It proposes; it does not run.** What comes back is five field values and the query they build.
 *      The operator reads them and presses "Use this search", which fills the form — and then presses
 *      Search, exactly as they would have without ever asking.
 *   2. **What OpsWatch understood is shown as facts, not as prose.** Text, level, range, lines, log
 *      groups, and the query itself. A summary written by the model would be the model marking its own
 *      homework.
 *   3. **It can only narrow.** The log groups it may choose from are the ones already ticked, and a name
 *      outside that set is refused on the way back rather than honoured.
 */
export function AiAssist({
  groups,
  propose,
  onUse,
}: {
  groups: string[];
  propose: FormAction<ProposeState>;
  onUse: (proposal: NonNullable<ProposeState['proposal']>) => void;
}) {
  const t = useTranslations('Monitoring.client');
  const [state, ask, pending] = useActionState(propose, {});
  const proposal = state.proposal;

  return (
    <details className="rounded-lg border p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden />
        {t('logs.ai.title')}
      </summary>

      <form action={ask} className="mt-3 space-y-2">
        <Label htmlFor="ai-request" className="text-xs">
          {t('logs.ai.label')}
        </Label>
        <textarea
          id="ai-request"
          name="request"
          rows={2}
          maxLength={MAX_REQUEST_LENGTH_CLIENT}
          defaultValue={state.request}
          placeholder={t('logs.ai.placeholder')}
          className="w-full rounded-md border bg-transparent p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {/* The only log groups the assistant may choose from are the ones already ticked. */}
        {groups.map((group) => (
          <input key={group} type="hidden" name="group" value={group} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={pending || groups.length === 0}>
            {t('logs.ai.ask')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('logs.ai.neverRuns')}</p>
        </div>
        {state.error !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {t(`logs.ai.errors.${state.error}`)}
          </p>
        )}
      </form>

      {proposal !== undefined && (
        <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">{t('logs.ai.understood')}</p>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">{t('logs.search.label')}</dt>
            <dd className="font-mono break-all">{proposal.text === '' ? t('logs.ai.noText') : proposal.text}</dd>
            <dt className="text-muted-foreground">{t('logs.facets.level')}</dt>
            <dd>{proposal.level === null ? t('logs.search.anyLevel') : t(`logs.levels.${proposal.level}`)}</dd>
            <dt className="text-muted-foreground">{t('logs.range')}</dt>
            <dd>{t(`range.options.${proposal.range}`)}</dd>
            <dt className="text-muted-foreground">{t('logs.search.limit')}</dt>
            <dd className="tabular-nums">{proposal.limit}</dd>
            <dt className="text-muted-foreground">{t('logs.groups')}</dt>
            <dd className="font-mono break-all">{proposal.groups.join(', ')}</dd>
          </dl>
          <div>
            <p className="text-xs text-muted-foreground">{t('logs.ai.theQuery')}</p>
            {/* Built by OpsWatch out of the fields above — never text the model wrote. */}
            <p className="mt-1 font-mono text-xs break-all">{buildSearchQuery({ text: proposal.text, level: proposal.level, limit: proposal.limit })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => onUse(proposal)}>
              {t('logs.ai.use')}
            </Button>
            {state.model !== undefined && <p className="text-xs text-muted-foreground">{t('logs.ai.by', { model: state.model })}</p>}
          </div>
        </div>
      )}
    </details>
  );
}
