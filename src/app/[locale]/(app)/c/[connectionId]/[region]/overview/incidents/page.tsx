import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { incidentLabels } from '@/lib/read/incident-labels';
import { listIncidentSummaries } from '@/lib/read/incidents';
import { hasBeenRead } from '@/lib/read/health';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.incidents.title');

/**
 * Incidents (§16).
 *
 * The empty state is the careful part, and it is two different sentences. Before the collector has read
 * anything, OpsWatch does not know whether there have been incidents; afterwards, none having been raised is
 * a measured statement and a good one. §2.6 does not let those look the same.
 */
export default async function IncidentsPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const db = getDb();
  const t = await getTranslations('Monitoring.incidents');
  const tSeverity = await getTranslations('Insights.severity');
  const format = await getFormatter();
  const query = { connectionId: context.scope.connectionId, scope: context.scope.region };
  const nowMs = pageNow();

  const incidents = listIncidentSummaries(db, query, await incidentLabels(context.locale));
  const read = hasBeenRead(db, query);

  return (
    <SectionLayout context={context} section="overview" subsection="incidents">
      <MonitoringCard title={t('title')} description={t('description')}>
        {incidents.length === 0 ? (
          <>
            <p className="text-sm">{read ? t('none') : t('waiting')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{read ? t('noneHint') : t('waitingHint')}</p>
          </>
        ) : (
          <ul className="divide-y">
            {incidents.map((incident) => (
              <li key={incident.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <SeverityBadge severity={incident.severity} label={tSeverity(incident.severity)} />
                  <span className="text-sm font-medium">{incident.title}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase">
                    {t(`status.${incident.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('started', { when: format.relativeTime(new Date(incident.startedAt), new Date(nowMs)) })}
                  {incident.affectedServices.length > 0 &&
                    ` · ${t('services', { services: incident.affectedServices.map((service) => service.label ?? service.id).join(', ') })}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>
    </SectionLayout>
  );
}
