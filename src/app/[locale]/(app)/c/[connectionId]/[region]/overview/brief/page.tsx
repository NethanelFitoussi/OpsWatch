import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readBrief } from '@/lib/read/brief';
import { hasBeenRead } from '@/lib/read/health';
import { healthLabels } from '@/lib/read/health-labels';
import { insightRenderer } from '@/lib/read/render';

type Props = { params: Promise<MonitoringParams> };

export const generateMetadata = localizedTitle('Monitoring.brief.title');

/**
 * The Morning brief: what happened since yesterday, and what to start on.
 *
 * It is the section's default page, because it is the one that answers "what do I need to know" in a glance.
 */
export default async function BriefPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const nowMs = pageNow();
  const db = getDb();
  const t = await getTranslations('Monitoring.brief');
  const tSeverity = await getTranslations('Insights.severity');
  const format = await getFormatter();
  const query = { connectionId: context.scope.connectionId, scope: context.scope.region };

  if (!hasBeenRead(db, query)) {
    return (
      <SectionLayout context={context} section="overview" subsection="brief" description={t('description')}>
        <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
          <p className="text-sm">{t('waiting')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('waitingHint')}</p>
        </MonitoringCard>
      </SectionLayout>
    );
  }

  const brief = readBrief(db, query, {
    nowMs,
    render: await insightRenderer(context.locale),
    labels: await healthLabels(context.locale),
  });
  const opened = brief.changes.filter((change) => change.direction === 'new').length;
  const resolved = brief.changes.filter((change) => change.direction === 'resolved').length;

  return (
    <SectionLayout context={context} section="overview" subsection="brief" description={t('description')}>
      <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
        <p className="text-lg font-medium">{t(`summary.${brief.status}`)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('period', { from: format.dateTime(new Date(brief.period.from), { dateStyle: 'medium', timeStyle: 'short' }) })}
          {' · '}
          {t('opened', { count: opened })}
          {', '}
          {t('resolved', { count: resolved })}
        </p>
      </MonitoringCard>

      <MonitoringCard title={t('mostImportant')}>
        {brief.mostImportant === null ? (
          <p className="text-sm text-muted-foreground">{t('nothingImportant')}</p>
        ) : (
          <Link
            href={subsectionPath(context.scope, 'overview', 'problems', brief.mostImportant.id)}
            className="group flex flex-wrap items-baseline gap-3 text-sm"
          >
            <SeverityBadge severity={brief.mostImportant.severity} label={tSeverity(brief.mostImportant.severity)} />
            <span className="group-hover:underline">{brief.mostImportant.title}</span>
          </Link>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('changes')}>
        {brief.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noChanges')}</p>
        ) : (
          <ul className="divide-y">
            {/* Wrapping, and a text that may shrink: the timestamp is `shrink-0`, so without both a
                long change description pushes it off the right of a 360px screen. */}
            {brief.changes.map((change) => (
              <li key={change.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span className="min-w-0 break-words">{change.text}</span>
                {change.at !== undefined && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format.relativeTime(new Date(change.at), new Date(nowMs))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>
    </SectionLayout>
  );
}
