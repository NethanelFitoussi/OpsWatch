import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { DatabasesCard } from './cards';

type Props = {
  params: Promise<MonitoringParams>;
  searchParams: Promise<{ range?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.databases.title');

export default async function DatabasesPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const range = parseTimeRange((await searchParams).range, context.settings.defaultRange);
  // One clock for the whole page: every card below shares the same window, and with it its cache entries.
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.databases');
  return (
    <SectionLayout context={context} section="databases" subsection="instances" range={range}>
      <SuspenseCard key={range} title={t('cardTitle')} variant="table" rows={6}>
        <DatabasesCard scope={context.scope} range={range} nowMs={nowMs} />
      </SuspenseCard>
    </SectionLayout>
  );
}
