import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { ErrorTable, WhatsNew } from '@/components/errors/error-table';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { errorCollectionState, listErrors, whatsNew, ERROR_COUNT_WINDOW_MS } from '@/lib/read/errors';
import { budgetState } from '@/lib/store/logs-budget';

type Props = { params: Promise<MonitoringParams> };

export const generateMetadata = localizedTitle('Monitoring.errors.title');

/**
 * The Errors list.
 *
 * Its empty states are three different facts and are kept apart: no log source exists, one exists but none is
 * switched on, or collection is running and has found nothing. Telling an operator "no errors" when OpsWatch
 * was never allowed to look would be the same lie the Health page refuses to tell.
 */
export default async function ErrorsPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const nowMs = pageNow();
  const db = getDb();
  const t = await getTranslations('Monitoring.errors');
  const query = { connectionId: context.scope.connectionId, scope: context.scope.region };

  const state = errorCollectionState(db, query);
  const budget = budgetState(db, nowMs, env().OPSWATCH_LOGS_BUDGET_GB_PER_DAY, context.scope.connectionId);

  if (state !== 'enabled') {
    return (
      <SectionLayout context={context} section="errors" subsection="groups">
        <MonitoringCard title={t('title')} description={t('description')}>
          <p className="text-sm">{state === 'no_sources' ? t('noSources') : t('noneEnabled')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {state === 'no_sources' ? t('noSourcesHint') : t('noneEnabledHint')}
          </p>
        </MonitoringCard>
      </SectionLayout>
    );
  }

  const page = listErrors(db, query, { nowMs });
  const sets = whatsNew(db, { ...query, since: nowMs - ERROR_COUNT_WINDOW_MS }, { nowMs });

  return (
    <SectionLayout context={context} section="errors" subsection="groups">
      {/* The budget stopping is a fact worth stating: otherwise the list simply looks quiet. */}
      {budget.exhausted && (
        <MonitoringCard title={t('title')}>
          {/* Which of the two stops it was: this account's own share, or the installation's cap
              spent by another account. The operator's remedy differs. */}
          <p className="text-sm">{t(budget.stoppedByInstance ? 'budgetStoppedInstance' : 'budgetStopped')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t(budget.stoppedByInstance ? 'budgetHintInstance' : 'budgetHint')}</p>
        </MonitoringCard>
      )}
      <WhatsNew sets={sets} scope={context.scope} nowMs={nowMs} />
      <MonitoringCard title={t('title')} description={t('description')}>
        {page.items.length === 0 ? (
          <>
            <p className="text-sm">{t('empty')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
          </>
        ) : (
          <ErrorTable errors={page.items} scope={context.scope} nowMs={nowMs} />
        )}
      </MonitoringCard>
    </SectionLayout>
  );
}
