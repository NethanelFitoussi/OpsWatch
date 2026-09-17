import { getTranslations } from 'next-intl/server';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { DatabasesCard } from './cards';

type Props = {
  params: Promise<MonitoringParams>;
  searchParams: Promise<{ range?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.databases.title');

export default async function DatabasesPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const range = parseTimeRange((await searchParams).range);
  const t = await getTranslations('Monitoring.databases');
  return (
    <div className="space-y-6">
      <MonitoringHeader
        context={context}
        title={t('title')}
        description={t('description', { connection: context.connection.name, region: context.scope.region })}
        range={range}
      />
      <SuspenseCard key={range} title={t('cardTitle')} variant="table" rows={6}>
        <DatabasesCard scope={context.scope} range={range} />
      </SuspenseCard>
    </div>
  );
}
