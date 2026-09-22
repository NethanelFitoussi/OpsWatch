import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { getError } from '@/lib/read/errors';

type Props = { params: Promise<MonitoringParams & { errorId: string }> };

export const generateMetadata = localizedTitle('Monitoring.errors.title');

/** One error group, and the frames its fingerprint was computed over. */
export default async function ErrorDetailPage({ params }: Props) {
  const resolved = await params;
  const context = await initMonitoringRoute(params);
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.errors');
  const format = await getFormatter();

  const detail = getError(
    getDb(),
    { connectionId: context.scope.connectionId, scope: context.scope.region, id: resolved.errorId },
    { nowMs },
  );
  if (detail === null) notFound();

  return (
    <SectionLayout context={context} section="errors" subsection="groups">
      <p>
        <Link
          href={subsectionPath(context.scope, 'errors', 'groups')}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← {t('title')}
        </Link>
      </p>

      <MonitoringCard title={detail.type ?? t('title')}>
        <p className="text-sm">{detail.message}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t('statusLabel')}</dt>
            <dd>{t(`status.${detail.status}`)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('firstSeen')}</dt>
            <dd>{format.relativeTime(new Date(detail.firstSeenAt), new Date(nowMs))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('lastSeen')}</dt>
            <dd>{format.relativeTime(new Date(detail.lastSeenAt), new Date(nowMs))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('occurrencesLabel')}</dt>
            <dd className="tabular-nums">
              {detail.occurrences === null ? t('occurrencesUnknown') : t('occurrences', { count: detail.occurrences })}
            </dd>
          </div>
        </dl>
      </MonitoringCard>

      <MonitoringCard title={t('frames')}>
        {detail.frames.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noFrames')}</p>
        ) : (
          <ol className="space-y-1 font-mono text-xs">
            {detail.frames.map((frame, index) => (
              <li key={`${frame.file}:${frame.function}:${index}`} className="break-all">
                {frame.function ? `${frame.function} — ` : ''}
                {frame.file}
              </li>
            ))}
          </ol>
        )}
      </MonitoringCard>
    </SectionLayout>
  );
}
