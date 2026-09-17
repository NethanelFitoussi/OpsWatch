import { getTranslations } from 'next-intl/server';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';

type Props = { params: Promise<MonitoringParams> };

export const generateMetadata = localizedTitle('Monitoring.overview.title');

export default async function OverviewPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const t = await getTranslations('Monitoring.overview');
  return (
    <div className="space-y-6">
      <MonitoringHeader context={context} title={t('title')} description={t('description', { connection: context.connection.name, region: context.scope.region })} />
    </div>
  );
}
