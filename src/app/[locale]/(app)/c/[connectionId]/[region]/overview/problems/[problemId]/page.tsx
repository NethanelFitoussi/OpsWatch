import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { EvidenceList } from '@/components/problems/evidence-list';
import { ScoreBreakdown } from '@/components/problems/score-breakdown';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { getProblem, problemIsStale } from '@/lib/read/problems';
import { insightRenderer } from '@/lib/read/render';

type Props = { params: Promise<MonitoringParams & { problemId: string }> };

export const generateMetadata = localizedTitle('Monitoring.problems.title');

/**
 * One problem, and the argument for it.
 *
 * Everything here comes from the row the detector wrote: the evidence it read, and the arithmetic behind the
 * score. Nothing is recomputed, so the page cannot disagree with the engine.
 */
export default async function ProblemDetailPage({ params }: Props) {
  const resolved = await params;
  const context = await initMonitoringRoute(params);
  const nowMs = pageNow();
  const db = getDb();
  const t = await getTranslations('Monitoring.problems');
  const format = await getFormatter();

  const found = getProblem(
    db,
    { connectionId: context.scope.connectionId, scope: context.scope.region, id: resolved.problemId },
    { nowMs, render: await insightRenderer(context.locale) },
  );
  // A problem from another environment reads as absent, not as somebody else's.
  if (found === null) notFound();

  const { detail, row } = found;
  const tSeverity = await getTranslations('Insights.severity');
  const stale = problemIsStale(row, nowMs);
  const when = (at: number) => format.relativeTime(new Date(at), new Date(nowMs));

  return (
    <SectionLayout context={context} section="overview" subsection="problems">
      <p>
        <Link
          href={subsectionPath(context.scope, 'overview', 'problems')}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← {t('detail.back')}
        </Link>
      </p>

      <MonitoringCard title={detail.title}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <SeverityBadge severity={detail.severity} label={tSeverity(detail.severity)} />
          <span>{t(`status.${detail.status}`)}</span>
          <span className="text-muted-foreground">{detail.category}</span>
          {detail.resource && <span className="text-muted-foreground">{detail.resource}</span>}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t('detail.firstSeen')}</dt>
            <dd>{when(detail.firstSeenAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('detail.lastSeen')}</dt>
            <dd>{when(detail.lastSeenAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('detail.occurrences')}</dt>
            <dd className="tabular-nums">{detail.occurrences ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('detail.flaps')}</dt>
            <dd className="tabular-nums">{row.flapCount}</dd>
          </div>
        </dl>
        {/* A subject nobody has been able to evaluate is neither confirmed nor cleared, and says so. */}
        {stale && (
          <p className="mt-4 rounded-md border px-3 py-2 text-sm">
            <strong className="font-medium">{t('stale')}</strong> <span className="text-muted-foreground">{t('staleHint')}</span>
          </p>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('detail.evidence')} description={t('detail.evidenceDescription')}>
        <EvidenceList evidence={detail.evidence} />
      </MonitoringCard>

      <ScoreBreakdown terms={row.scoreTerms} />
    </SectionLayout>
  );
}
