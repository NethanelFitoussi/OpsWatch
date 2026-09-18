import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { INSIGHT_FAMILIES } from '@/lib/monitoring/overview';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { InsightsCard, SummaryCard } from './cards';

type Props = { params: Promise<MonitoringParams> };

export const generateMetadata = localizedTitle('Monitoring.overview.title');

export default async function OverviewPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  // One clock for the whole page: the five loads below then share their window, and with it their cache entries.
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.overview');
  return (
    <SectionLayout context={context} section="overview" subsection="insights">
      <section aria-label={t('summary.label')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {INSIGHT_FAMILIES.map((family) => (
          <SuspenseCard key={family} title={t(`summary.${family}.title`)} variant="stat">
            <SummaryCard scope={context.scope} family={family} nowMs={nowMs} />
          </SuspenseCard>
        ))}
      </section>
      <SuspenseCard title={t('insights.title')} variant="table" rows={4}>
        <InsightsCard scope={context.scope} nowMs={nowMs} />
      </SuspenseCard>
    </SectionLayout>
  );
}
