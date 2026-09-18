import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { isEcsName } from '@/lib/monitoring/shared/names';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { EventsCard, LogsCard, ServiceChartsCard, ServiceSummaryCard, TargetGroupsCard, TasksCard } from './cards';

type Props = {
  params: Promise<MonitoringParams & { cluster: string; service: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.containers.serviceMetaTitle');

export default async function ServicePage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const { cluster, service } = await params;
  if (!isEcsName(cluster) || !isEcsName(service)) notFound();
  const range = parseTimeRange((await searchParams).range);
  // One clock for the whole page: every card below shares the same window, and with it its cache entries.
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.containers');
  const { scope } = context;
  const ref = { scope, cluster, service };
  return (
    <div className="space-y-4">
      <Link
        href={`${subsectionPath(scope, 'containers', 'services')}?range=${range}`}
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <SectionLayout
        context={context}
        section="containers"
        subsection="services"
        title={service}
        description={t('serviceDescription', { cluster })}
        range={range}
      >
        <SuspenseCard title={t('summary.title')} variant="stat">
          <ServiceSummaryCard {...ref} />
        </SuspenseCard>
        <SuspenseCard key={`charts|${range}`} title={t('charts.title')} variant="chart">
          <ServiceChartsCard {...ref} range={range} nowMs={nowMs} />
        </SuspenseCard>
        <SuspenseCard key={`target-groups|${range}`} title={t('targetGroups.title')} variant="chart">
          <TargetGroupsCard {...ref} range={range} nowMs={nowMs} />
        </SuspenseCard>
        <SuspenseCard title={t('tasks.title')} variant="table">
          <TasksCard {...ref} />
        </SuspenseCard>
        <SuspenseCard title={t('events.title')} variant="table">
          <EventsCard {...ref} />
        </SuspenseCard>
        <SuspenseCard title={t('logs.title')} variant="table">
          <LogsCard {...ref} />
        </SuspenseCard>
      </SectionLayout>
    </div>
  );
}
