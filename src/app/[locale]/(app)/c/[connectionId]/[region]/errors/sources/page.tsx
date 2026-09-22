import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readSources } from '@/lib/read/log-sources';
import { saveSourceAction, searchGroupsAction } from './actions';
import { SourcesForm } from './sources-form';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.sources.title');

/**
 * Errors → Log sources (§18).
 *
 * Which log groups OpsWatch reads, and how to read each one. The page opens without an AWS call: configured
 * sources come from the database and discovery happens only when somebody searches, so reviewing what is set
 * up costs nothing. What it does cost is stated before the decision — Logs Insights is billed per gigabyte
 * scanned and the daily budget is a hard stop (§9.5).
 */
export default async function LogSourcesPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const t = await getTranslations('Monitoring.sources');
  const { connectionId, region } = { connectionId: context.scope.connectionId, region: context.scope.region };

  const view = readSources(
    getDb(),
    { connectionId, scope: region },
    { nowMs: pageNow(), budgetGbPerDay: env().OPSWATCH_LOGS_BUDGET_GB_PER_DAY },
  );

  return (
    <SectionLayout context={context} section="errors" subsection="sources">
      <MonitoringCard title={t('title')} description={t('description')}>
        {/* What is stored, said plainly, because it is the question an operator asks about a logging tool. */}
        <p className="text-sm text-muted-foreground">{t('privacy')}</p>
      </MonitoringCard>

      <SourcesForm
        save={saveSourceAction.bind(null, context.locale, connectionId, region)}
        search={searchGroupsAction.bind(null, context.locale, connectionId, region)}
        sources={view.sources}
        budget={view.budget}
      />
    </SectionLayout>
  );
}
