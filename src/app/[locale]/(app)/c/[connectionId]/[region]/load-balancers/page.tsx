import { getTranslations } from 'next-intl/server';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { LoadBalancersCard } from './cards';

type Props = {
  params: Promise<MonitoringParams>;
  searchParams: Promise<{ range?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.loadBalancers.title');

export default async function LoadBalancersPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const range = parseTimeRange((await searchParams).range);
  // One clock for the whole page: every card below shares the same window, and with it its cache entries.
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.loadBalancers');
  return (
    <div className="space-y-6">
      <MonitoringHeader
        context={context}
        title={t('title')}
        description={t('description', { connection: context.connection.name, region: context.scope.region })}
        range={range}
      />
      <SuspenseCard key={range} title={t('cardTitle')} variant="table" rows={6}>
        <LoadBalancersCard scope={context.scope} range={range} nowMs={nowMs} />
      </SuspenseCard>
    </div>
  );
}
