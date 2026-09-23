import { notFound } from 'next/navigation';
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
import { incidentLabels } from '@/lib/read/incident-labels';
import { getIncident } from '@/lib/read/incidents';
import { insightRenderer } from '@/lib/read/render';
import { updateIncidentAction } from './actions';
import { IncidentControls } from './incident-controls';

type Props = { params: Promise<MonitoringParams & { incidentId: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.incidents.title');

/**
 * One incident: what it links, what happened, and what anybody said about it (§16).
 *
 * The timeline and the notes are rendered as two lists rather than one. A note is a person's own words and
 * a timeline entry is a fact OpsWatch recorded, and running them together would let a colleague's guess
 * read as something the system observed.
 */
export default async function IncidentDetailPage({ params }: Props) {
  const resolved = await params;
  const context = await initMonitoringRoute(params);
  const db = getDb();
  const t = await getTranslations('Monitoring.incidents');
  const tSeverity = await getTranslations('Insights.severity');
  const format = await getFormatter();
  const nowMs = pageNow();

  const found = getIncident(
    db,
    { connectionId: context.scope.connectionId, scope: context.scope.region, id: resolved.incidentId },
    await incidentLabels(context.locale),
    { nowMs, render: await insightRenderer(context.locale) },
  );
  if (found === null) notFound();
  const { row, detail } = found;

  return (
    <SectionLayout context={context} section="overview" subsection="incidents">
      <p>
        <Link href={subsectionPath(context.scope, 'overview', 'incidents')} className="text-sm underline underline-offset-4">
          {t('back')}
        </Link>
      </p>

      <MonitoringCard title={detail.title}>
        <div className="flex flex-wrap items-baseline gap-2">
          <SeverityBadge severity={detail.severity} label={tSeverity(detail.severity)} />
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase">
            {t(`status.${detail.status}`)}
          </span>
          <span className="text-sm text-muted-foreground">
            {t('started', { when: format.relativeTime(new Date(detail.startedAt), new Date(nowMs)) })}
          </span>
        </div>
        {detail.affectedServices.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t('services', { services: detail.affectedServices.map((service) => service.label ?? service.id).join(', ') })}
          </p>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('problems')}>
        {detail.problems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noProblems')}</p>
        ) : (
          <ul className="divide-y">
            {detail.problems.map((problem) => (
              <li key={problem.id} className="py-2 text-sm">
                <Link
                  href={subsectionPath(context.scope, 'overview', 'problems', problem.id)}
                  className="underline underline-offset-4"
                >
                  {problem.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('timeline')} description={t('timelineDescription')}>
        {detail.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noTimeline')}</p>
        ) : (
          <ul className="divide-y">
            {detail.timeline.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span>{entry.text}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {format.dateTime(new Date(entry.at), { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>

      {/* Kept apart from the timeline: a note is somebody's words, not something OpsWatch observed. */}
      <MonitoringCard title={t('notes')} description={t('notesDescription')}>
        {detail.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noNotes')}</p>
        ) : (
          <ul className="divide-y">
            {detail.notes.map((note, index) => (
              <li key={`${note.at}-${index}`} className="py-2 text-sm">
                <p>{note.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {format.dateTime(new Date(note.at), { dateStyle: 'short', timeStyle: 'short' })}
                  {note.author !== undefined && ` · ${t('byUser', { id: note.author })}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('update')}>
        <IncidentControls
          action={updateIncidentAction.bind(null, context.locale, context.scope.connectionId, context.scope.region)}
          incidentId={row.id}
          status={row.status}
          canDismiss={detail.allowedActions.includes('dismiss')}
        />
      </MonitoringCard>
    </SectionLayout>
  );
}
