import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { EnvironmentMachines } from '@/components/hosts/environment-machines';
import { HealthSummary } from '@/components/problems/health-summary';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { hasBeenRead, readHealth } from '@/lib/read/health';
import { healthLabels } from '@/lib/read/health-labels';
import { insightRenderer } from '@/lib/read/render';
import { hostsInEnvironment } from '@/lib/store/hosts';

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
      <SectionLayout context={context} section="overview" subsection="health" description={t('description')}>
        <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
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
    <SectionLayout context={context} section="overview" subsection="health" description={t('description')}>
      <HealthSummary health={health} scope={context.scope} nowMs={nowMs} />
      {/* The machines inside the account, which no AWS API reports on. Read at render, never written
          as problems — the card says as much, because it must not imply an alert that is not coming. */}
      <EnvironmentMachines hosts={hostsInEnvironment(db, context.scope.connectionId, context.scope.region, nowMs)} />
    </SectionLayout>
  );
}
