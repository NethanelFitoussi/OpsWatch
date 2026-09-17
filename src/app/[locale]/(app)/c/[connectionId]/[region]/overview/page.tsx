import { getTranslations } from 'next-intl/server';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { INSIGHT_FAMILIES } from '@/lib/monitoring/overview';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { InsightsCard, SummaryCard } from './cards';

type Props = { params: Promise<MonitoringParams> };

export const generateMetadata = localizedTitle('Monitoring.overview.title');

export default async function OverviewPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const t = await getTranslations('Monitoring.overview');
  return (
    <div className="space-y-6">
      <MonitoringHeader context={context} title={t('title')} description={t('description', { connection: context.connection.name, region: context.scope.region })} />
      <section aria-label={t('summary.label')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {INSIGHT_FAMILIES.map((family) => (
          <SuspenseCard key={family} title={t(`summary.${family}.title`)} variant="stat">
            <SummaryCard scope={context.scope} family={family} />
          </SuspenseCard>
        ))}
      </section>
      <SuspenseCard title={t('insights.title')} variant="table" rows={4}>
        <InsightsCard scope={context.scope} />
      </SuspenseCard>
    </div>
  );
}
