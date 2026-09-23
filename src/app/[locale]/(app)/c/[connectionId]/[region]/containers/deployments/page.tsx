import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { recentDeployments } from '@/lib/read/deployments';
import { hasBeenRead } from '@/lib/read/health';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.deployments.title');

/** One screenful. A deployment history is a way into the product, not an export. */
const PAGE_LIMIT = 50;

/**
 * What shipped, and when (DEP-3).
 *
 * Read from rows the deployments job already wrote, so it costs nothing to open and goes back exactly as
 * far as collection does — and no further. That last part is the one the empty state has to carry: before
 * the collector has read this environment, "nothing shipped" is not something OpsWatch knows.
 */
export default async function DeploymentsPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const db = getDb();
  const t = await getTranslations('Monitoring.deployments');
  const format = await getFormatter();
  const query = { connectionId: context.scope.connectionId, scope: context.scope.region };
  const nowMs = pageNow();

  // The page orders by when each deployment started, which is what a history means to a reader.
  const items = recentDeployments(db, query, PAGE_LIMIT);
  const read = hasBeenRead(db, query);

  return (
    <SectionLayout context={context} section="containers" subsection="deployments">
      <MonitoringCard title={t('title')} description={t('description')}>
        <p className="text-sm text-muted-foreground">{t('since')}</p>
      </MonitoringCard>

      <MonitoringCard title={t('list')}>
        {items.length === 0 ? (
          <>
            {/* Two different sentences, because "we have not looked" is not "nothing shipped" (§2.6). */}
            <p className="text-sm">{read ? t('none') : t('waiting')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{read ? t('noneHint') : t('waitingHint')}</p>
          </>
        ) : (
          <ul className="divide-y">
            {items.map((deployment) => (
              <li key={deployment.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <span className="min-w-0">
                  <Link
                    href={subsectionPath(context.scope, 'containers', 'deployments', deployment.id)}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {deployment.service.label ?? deployment.service.id}
                  </Link>
                  <span className="ml-2 break-all text-xs text-muted-foreground">{deployment.version}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs">
                  <span className="rounded-full bg-muted px-2 py-0.5 tracking-wide uppercase">{t(`status.${deployment.status}`)}</span>
                  <span className="text-muted-foreground">
                    {format.relativeTime(new Date(deployment.at), new Date(nowMs))}
                    {deployment.environment !== undefined && ` · ${deployment.environment}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>
    </SectionLayout>
  );
}
