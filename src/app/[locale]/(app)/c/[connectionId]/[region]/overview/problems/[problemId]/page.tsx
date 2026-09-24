import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { CausesPanel, ChecksPanel, ImpactPanel, WhyPanel } from '@/components/problems/diagnosis-panel';
import { EvidenceList } from '@/components/problems/evidence-list';
import { ProblemChart, ProblemTimeline } from '@/components/problems/problem-evidence';
import { InvestigationTimeline } from '@/components/problems/investigation-timeline';
import { ScoreBreakdown } from '@/components/problems/score-breakdown';
import { WorkspacePanel } from '@/components/problems/workspace-panel';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { readInvestigation } from '@/lib/read/investigation';
import { readWorkspace } from '@/lib/read/workspace';
import { investigationLabels } from '@/lib/read/investigation-labels';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { durationSince, familyOf, headlineKey } from '@/lib/monitoring/shared/duration';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readDiagnosis } from '@/lib/read/diagnosis';
import { getProblem, problemIsStale } from '@/lib/read/problems';
import { insightRenderer } from '@/lib/read/render';

type Props = { params: Promise<MonitoringParams & { problemId: string }> };

export const generateMetadata = localizedTitle('Monitoring.problems.title');


/**
 * One problem, and the argument for it.
 *
 * Ordered by the questions an operator actually asks, in the order they ask them: **what happened**, then
 * **how bad**, then **why OpsWatch decided that**, then **what to look at**, and only then the evidence and
 * the arithmetic for anybody who wants to check the working.
 *
 * Everything comes from rows the collector wrote. Nothing is recomputed, so the page cannot disagree with
 * the engine — and nothing here says more than those rows support: the impact card's most common answer is
 * that user impact was not established, which is true far more often than it is comfortable.
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
  const diagnosis = readDiagnosis(db, row);
  const tSeverity = await getTranslations('Insights.severity');
  const tHeadline = await getTranslations('Insights.headline');
  const tFamily = await getTranslations('Insights.family');
  const tDuration = await getTranslations('Insights.duration');
  const duration = durationSince(detail.firstSeenAt, nowMs);
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

      <MonitoringCard title={tHeadline(headlineKey(detail.category))}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <SeverityBadge severity={detail.severity} label={tSeverity(detail.severity)} />
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t(`status.${detail.status}`)}</span>
          <span className="text-muted-foreground">{tDuration(duration.unit, { value: duration.value })}</span>
        </div>
        {/* The detector's own sentence, under the headline rather than as it. */}
        <p className="mt-2 text-sm">{detail.title}</p>
        {/* Where, in one line: the resource, what kind of thing it is, and which region. */}
        <p className="mt-2 text-sm text-muted-foreground">
          {[detail.resource, tFamily(familyOf(detail.category)), context.scope.region].filter(Boolean).join(' · ')}
        </p>
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
            {/* "115 times" told a reader nothing. This is the number of detector cycles that found it
                still firing — a measure of how long it has been continuously true, not of how many
                separate incidents there were. */}
            <dt className="text-muted-foreground">{t('detail.confirmations')}</dt>
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

      {/* How bad, why, and what to do — before the raw evidence, because that is the order of the questions. */}
      <ImpactPanel impact={diagnosis.impact} />
      <WhyPanel rule={diagnosis.rule} recovery={diagnosis.recovery} />
      <ChecksPanel checks={diagnosis.checks} />
      {/* Last of the four, and after the measured ones on purpose: possibilities read as possibilities
          when they follow the evidence, and as conclusions when they precede it. */}
      <CausesPanel causes={diagnosis.causes} />

      <MonitoringCard title={t('detail.overTime')} description={t('detail.overTimeDescription')}>
        {/* The shape of it: when it opened, whether it came back, whether it stopped — always available,
            because the events spine is written whether or not historical collection is on. */}
        <ProblemTimeline marks={diagnosis.timeline} />
        <div className="mt-4">
          <ProblemChart series={diagnosis.series} historyEnabled={diagnosis.historyEnabled} />
        </div>
      </MonitoringCard>

      <MonitoringCard title={t('detail.evidence')} description={t('detail.evidenceDescription')}>
        <EvidenceList evidence={detail.evidence} />
      </MonitoringCard>

      {detail.deployments.length > 0 && (
        <MonitoringCard title={t('detail.deployments')}>
          {/* §7: the measured gap and the relation. Never "because" — an unrelated deployment during an
              incident is the most ordinary thing in the world, and this card must not accuse one. */}
          <p className="text-sm text-muted-foreground">{t('detail.deploymentsDescription')}</p>
          <ul className="mt-2 divide-y">
            {detail.deployments.map((entry) => (
              <li key={entry.deployment.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 break-all">
                  {entry.deployment.service.label ?? entry.deployment.service.id} · {entry.deployment.version}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('detail.minutesBefore', { minutes: entry.minutesBeforeProblem })}
                  {entry.deployment.status === 'failed' && ` · ${t('detail.deploymentFailed')}`}
                </span>
              </li>
            ))}
          </ul>
        </MonitoringCard>
      )}

      {/* §7's three bands, kept apart: what happened, what happened near it, and what might explain it. */}
      <InvestigationTimeline {...readInvestigation(db, row, await investigationLabels(context.locale), nowMs)} locale={context.locale} />

      {/* §R: has this happened before, and where do I read the actual log lines. */}
      <WorkspacePanel
        workspace={readWorkspace(db, row)}
        scope={context.scope}
        locale={context.locale}
        problemOpenedAt={detail.firstSeenAt}
        nowMs={nowMs}
      />

      <ScoreBreakdown terms={row.scoreTerms} />
    </SectionLayout>
  );
}
