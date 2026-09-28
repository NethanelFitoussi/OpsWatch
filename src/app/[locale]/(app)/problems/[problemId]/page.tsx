import { ArrowLeft, ExternalLink } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { EvidenceList } from '@/components/problems/evidence-list';
import { ScoreBreakdown } from '@/components/problems/score-breakdown';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import type { Provider } from '@/lib/connections/types';
import { getDb } from '@/lib/db/client';
import { scopeKindOf } from '@/lib/monitoring/shared/scopes';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readProblemAcross } from '@/lib/read/across';
import { insightRenderer } from '@/lib/read/render';

type Props = { params: Promise<{ locale: string; problemId: string }> };

export const generateMetadata = localizedTitle('Problems.detailTitle');

/**
 * One problem, from any cloud (§G).
 *
 * **A subset of the AWS section page, on purpose.** That page has the diagnosis, the investigation and
 * the workspace, and all three read AWS-shaped rows; cloning them under generic names for the sake of
 * symmetry is precisely the failure this whole piece of work exists to avoid. What is here is what a
 * problem row and its evidence actually carry whichever cloud produced them — which is enough to
 * answer the four questions an operator asks first: what happened, how bad, since when, and on what
 * grounds.
 *
 * An AWS problem is offered the fuller page rather than having it duplicated here.
 */
export default async function CrossProblemPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const { problemId } = await params;
  const db = getDb();
  const nowMs = pageNow();

  const problem = readProblemAcross(db, problemId, { nowMs, render: await insightRenderer(locale) });
  if (problem === null) notFound();

  const t = await getTranslations('Problems');
  const common = await getTranslations('Accounts');
  const format = await getFormatter();

  return (
    <PageBody>
      <Link href="/problems" className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('backToList')}
      </Link>
      <PageHeader
        title={problem.title}
        description={t('detailWhere', {
          provider: common(`provider.${problem.provider}`),
          connection: problem.connectionName === '' ? t('connectionGone') : problem.connectionName,
          scope: t(`scopeKind.${scopeKindOf(problem.provider as Provider)}`, { scope: problem.scope }),
        })}
      />

      <SectionCard title={t('whatHappened')}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <SeverityBadge severity={problem.severity} label={t(`severity.${problem.severity}`)} />
          <span className="text-sm text-muted-foreground">{t('since', { when: format.relativeTime(new Date(problem.firstSeenAt)) })}</span>
          <span className="text-sm text-muted-foreground">{t('lastSeen', { when: format.relativeTime(new Date(problem.lastSeenAt)) })}</span>
          <span className="text-sm text-muted-foreground">{t('occurrences', { count: problem.occurrences })}</span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{t('subject', { subject: problem.subject })}</p>
        {/* The detector id, verbatim and untranslated: it is what an operator searches for. */}
        <p className="mt-1 font-mono text-xs text-muted-foreground">{problem.kind}</p>

        <div className="mt-4 flex flex-wrap gap-4">
          {problem.href !== null && (
            <Link href={problem.href} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t('openProvider', { provider: common(`provider.${problem.provider}`) })} <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          )}
          {/* Offered, not duplicated: the section page has the diagnosis and the investigation, and
              both read AWS-shaped rows that no other cloud has. */}
          {problem.sectionHref !== null && (
            <Link href={problem.sectionHref} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t('openSection')}
            </Link>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t('evidence')} description={t('evidenceHint')}>
        {problem.evidence.length === 0 ? (
          // Nothing recorded is said, not left blank: a problem with no evidence is a problem whose
          // detector did not write any, which an operator should be able to see rather than infer.
          <p className="text-sm text-muted-foreground">{t('noEvidence')}</p>
        ) : (
          <EvidenceList evidence={problem.evidence} />
        )}
      </SectionCard>

      {/* The card is titled for what it is about; the breakdown inside carries its own "Why this
          score" disclosure, and repeating that wording here read as the same heading twice. */}
      <SectionCard title={t('ranking')} description={t('rankingHint')}>
        <ScoreBreakdown terms={problem.scoreTerms} />
      </SectionCard>
    </PageBody>
  );
}
