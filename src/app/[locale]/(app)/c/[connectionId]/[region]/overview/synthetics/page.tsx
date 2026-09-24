import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { medianLatency, statusFrom } from '@/lib/detect/synthetic';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { listChecks, recentRuns, toOutcome } from '@/lib/store/synthetics';
import { deleteCheckAction, saveCheckAction } from './actions';
import { SyntheticsForm } from './synthetics-form';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.synthetics.title');

/**
 * Synthetics (§14).
 *
 * Checks run from this host on the collector's schedule. Everything about the page is shaped by that being
 * the operator's own outbound traffic: nothing runs until a check is enabled, the URL is validated before
 * it is stored as well as before it is fetched, and a check that has never run says `unknown` rather than
 * borrowing the comfort of `up`.
 */
export default async function SyntheticsPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const db = getDb();
  const t = await getTranslations('Monitoring.synthetics');
  const { connectionId, region } = { connectionId: context.scope.connectionId, region: context.scope.region };

  const checks = listChecks(db, connectionId, region).map((check) => {
    const runs = recentRuns(db, check.id, 10).map(toOutcome);
    return {
      id: check.id,
      name: check.name,
      url: check.url,
      enabled: check.enabled,
      status: statusFrom(runs),
      lastRunAt: runs[0]?.at ?? null,
      medianMs: medianLatency(runs),
      hasSecretHeaders: check.hasSecretHeaders,
    };
  });

  return (
    <SectionLayout context={context} section="overview" subsection="synthetics" description={t('description')}>
      <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
        <p className="text-sm text-muted-foreground">{t('rules')}</p>
      </MonitoringCard>

      <SyntheticsForm
        save={saveCheckAction.bind(null, context.locale, connectionId, region)}
        remove={deleteCheckAction.bind(null, context.locale, connectionId, region)}
        checks={checks}
      />
    </SectionLayout>
  );
}
