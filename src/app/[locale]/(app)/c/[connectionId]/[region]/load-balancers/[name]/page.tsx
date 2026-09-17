import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { isLoadBalancerName } from '@/lib/monitoring/shared/names';
import { monitoringPath } from '@/lib/monitoring/shared/paths';
import { parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { LoadBalancerChartsCard, LoadBalancerSummaryCard, TargetGroupsSection } from './cards';

type Props = {
  params: Promise<MonitoringParams & { name: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.loadBalancers.metaTitle');

export default async function LoadBalancerPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const { name } = await params;
  if (!isLoadBalancerName(name)) notFound();
  const range = parseTimeRange((await searchParams).range);
  const t = await getTranslations('Monitoring.loadBalancers');
  const { scope } = context;
  const ref = { scope, name };
  return (
    <div className="space-y-6">
      <Link
        href={`${monitoringPath(scope, 'load-balancers')}?range=${range}`}
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <MonitoringHeader context={context} title={name} description={t('detailDescription')} range={range} />
      <SuspenseCard title={t('summary.title')} variant="stat">
        <LoadBalancerSummaryCard {...ref} />
      </SuspenseCard>
      <SuspenseCard key={`charts|${range}`} title={t('charts.title')} variant="chart">
        <LoadBalancerChartsCard {...ref} range={range} />
      </SuspenseCard>
      <SuspenseCard key={`target-groups|${range}`} title={t('targetGroups.title')} variant="table">
        <TargetGroupsSection {...ref} range={range} />
      </SuspenseCard>
    </div>
  );
}
