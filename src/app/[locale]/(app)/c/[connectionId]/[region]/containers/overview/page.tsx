import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { EcsEstate } from './estate';

type Props = {
  params: Promise<MonitoringParams>;
  searchParams: Promise<{ range?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.ecsOverview.title');

export default async function ContainersOverviewPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const sp = await searchParams;
  const range = parseTimeRange(sp.range, context.settings.defaultRange);
  // One clock for the page, so every card shares a window and its cache entries.
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.ecsOverview');

  return (
    <SectionLayout context={context} section="containers" subsection="overview" range={range} title={t('title')} description={t('description')}>
      <SuspenseCard key={range} title={t('mapTitle')} variant="table">
        <EcsEstate scope={context.scope} range={range} nowMs={nowMs} />
      </SuspenseCard>
    </SectionLayout>
  );
}
