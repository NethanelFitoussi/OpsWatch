import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { HealthSummary } from '@/components/problems/health-summary';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { hasBeenRead, readHealth } from '@/lib/read/health';
import { healthLabels } from '@/lib/read/health-labels';
import { insightRenderer } from '@/lib/read/render';

type Props = { params: Promise<MonitoringParams> };

export const generateMetadata = localizedTitle('Monitoring.health.title');

/**
 * Health: is this environment healthy, and what could OpsWatch not check?
 *
 * It reads the snapshots the detect job writes, so it is instant and costs nothing. An environment nobody has
 * read yet is told so rather than shown a confident verdict.
 */
export default async function HealthPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const nowMs = pageNow();
  const db = getDb();
  const t = await getTranslations('Monitoring.health');
  const query = { connectionId: context.scope.connectionId, scope: context.scope.region };

  if (!hasBeenRead(db, query)) {
    return (
      <SectionLayout context={context} section="overview" subsection="health">
        <MonitoringCard title={t('title')} description={t('description')}>
          <p className="text-sm">{t('waiting')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('waitingHint')}</p>
        </MonitoringCard>
      </SectionLayout>
    );
  }

  const health = readHealth(db, query, {
    nowMs,
    render: await insightRenderer(context.locale),
    labels: await healthLabels(context.locale),
  });

  return (
    <SectionLayout context={context} section="overview" subsection="health">
      <HealthSummary health={health} scope={context.scope} nowMs={nowMs} />
    </SectionLayout>
  );
}
