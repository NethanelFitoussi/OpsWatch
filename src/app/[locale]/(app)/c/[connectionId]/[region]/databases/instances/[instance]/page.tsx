import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { isDbInstanceId } from '@/lib/monitoring/shared/names';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { InstanceChartsCard, InstanceSummaryCard, TopSqlCard } from './cards';

type Props = {
  params: Promise<MonitoringParams & { instance: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
};

export const generateMetadata = localizedTitle('Monitoring.databases.metaTitle');

export default async function DatabaseInstancePage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const { instance } = await params;
  if (!isDbInstanceId(instance)) notFound();
  const range = parseTimeRange((await searchParams).range, context.settings.defaultRange);
  // One clock for the whole page: every card below shares the same window, and with it its cache entries.
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.databases');
  const { scope } = context;
  const ref = { scope, instanceId: instance };
  return (
    <div className="space-y-4">
      <Link
        href={`${subsectionPath(scope, 'databases', 'instances')}?range=${range}`}
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <SectionLayout
        context={context}
        section="databases"
        subsection="instances"
        title={instance}
        description={t('instanceDescription')}
        range={range}
      >
        <SuspenseCard title={t('summary.title')} variant="stat">
          <InstanceSummaryCard {...ref} />
        </SuspenseCard>
        <SuspenseCard key={`charts|${range}`} title={t('charts.title')} variant="chart">
          <InstanceChartsCard {...ref} range={range} nowMs={nowMs} />
        </SuspenseCard>
        <SuspenseCard key={`top-sql|${range}`} title={t('topSql.title')} variant="table">
          <TopSqlCard {...ref} range={range} nowMs={nowMs} />
        </SuspenseCard>
      </SectionLayout>
    </div>
  );
}
