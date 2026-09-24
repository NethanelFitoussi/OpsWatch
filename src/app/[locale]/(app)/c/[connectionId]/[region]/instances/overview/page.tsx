import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { Ec2Hosts } from './hosts';

type Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ range?: string | string[] }> };

export const generateMetadata = localizedTitle('Monitoring.ec2.title');

export default async function InstancesOverviewPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const range = parseTimeRange((await searchParams).range, context.settings.defaultRange);
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.ec2');

  return (
    <SectionLayout context={context} section="instances" subsection="overview" range={range} title={t('title')} description={t('description')}>
      <SuspenseCard key={range} title={t('mapTitle')} variant="table">
        <Ec2Hosts scope={context.scope} range={range} nowMs={nowMs} />
      </SuspenseCard>
    </SectionLayout>
  );
}
