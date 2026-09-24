import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { RedisCache } from './cache';

type Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ range?: string | string[] }> };

export const generateMetadata = localizedTitle('Monitoring.redis.title');

export default async function RedisOverviewPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const range = parseTimeRange((await searchParams).range, context.settings.defaultRange);
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.redis');

  return (
    <SectionLayout context={context} section="redis" subsection="overview" range={range} title={t('title')} description={t('description')}>
      <SuspenseCard key={range} title={t('mapTitle')} variant="table">
        <RedisCache scope={context.scope} range={range} nowMs={nowMs} />
      </SuspenseCard>
    </SectionLayout>
  );
}
