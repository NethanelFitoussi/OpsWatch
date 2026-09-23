import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { githubIsReady } from '@/lib/github/connection';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { getDeployment } from '@/lib/read/deployments';
import { insightRenderer } from '@/lib/read/render';
import { findMapping } from '@/lib/store/repositories';

type Props = { params: Promise<MonitoringParams & { deploymentId: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.deployment.title');

/**
 * One deployment, and what shipped with it (DEP-3, REPO-4, §J).
 *
 * This is where §J's chain arrives: service → repository → deployment → commit → changed files. Every link
 * existed before and none of them met, so a problem beside a deployment could never say *what changed*.
 *
 * **The problems below a deployment are a correlation.** They started after it, on the same service,
 * within half an hour. That is an observation with a stated gap, and nothing here calls it a cause.
 *
 * When a link is missing the page says which one. "No commits" and "nobody ever fetched the commits" are
 * different facts, and only one of them means nothing changed.
 */
export default async function DeploymentPage({ params }: Props) {
  const resolved = await params;
  const context = await initMonitoringRoute(Promise.resolve(resolved));
  const db = getDb();
  const t = await getTranslations('Monitoring.deployment');
  const format = await getFormatter();
  const nowMs = pageNow();

  const detail = getDeployment(
    db,
    { connectionId: context.scope.connectionId, scope: context.scope.region, id: resolved.deploymentId },
    { nowMs, render: await insightRenderer(context.locale) },
  );
  if (detail === null) notFound();

  const connected = githubIsReady(db);
  const mapped = findMapping(db, context.scope.connectionId, context.scope.region, detail.service.id) !== null;

  return (
    <SectionLayout context={context} section="containers" subsection="deployments">
      <MonitoringCard title={detail.service.label ?? detail.service.id} description={t('description')}>
        <p className="text-sm">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-wide uppercase">{t(`status.${detail.status}`)}</span>
          <span className="ml-2">{detail.version}</span>
          <span className="ml-2 text-muted-foreground">{format.relativeTime(new Date(detail.at), new Date(nowMs))}</span>
        </p>
      </MonitoringCard>

      <MonitoringCard title={t('shipped')}>
        {/* Which link is missing, said plainly. An empty list would read as "nothing changed". */}
        {!connected && <p className="text-sm">{t('noGithub')}</p>}
        {connected && !mapped && <p className="text-sm">{t('noMapping', { service: detail.service.label ?? detail.service.id })}</p>}
        {connected && mapped && detail.evidence.length === 0 && <p className="text-sm">{t('notFetched')}</p>}

        {detail.evidence.length > 0 && (
          <>
            {detail.changes !== undefined && (
              <p className="text-sm text-muted-foreground">
                {t('changes', { files: detail.changes.files, additions: detail.changes.additions, deletions: detail.changes.deletions })}
              </p>
            )}
            <ul className="mt-2 divide-y">
              {detail.evidence.map((evidence) => (
                <li key={evidence.id} className="py-2">
                  <p className="text-sm">
                    {evidence.commit.url === undefined ? (
                      <span className="font-medium">{evidence.commit.sha.slice(0, 7)}</span>
                    ) : (
                      <a href={evidence.commit.url} rel="noreferrer noopener" target="_blank" className="font-medium underline-offset-4 hover:underline">
                        {evidence.commit.sha.slice(0, 7)}
                      </a>
                    )}
                    <span className="ml-2">{evidence.commit.message}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {evidence.commit.author ?? t('unknownAuthor')}
                    {evidence.summary !== undefined && ` · ${evidence.summary.split('—').slice(1).join('—').trim()}`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('related')}>
        {/* §7: a stated gap, never a cause. The wording is the whole of the guarantee. */}
        <p className="text-sm text-muted-foreground">{t('relatedHint')}</p>
        {detail.relatedProblems.length === 0 ? (
          <p className="mt-2 text-sm">{t('noRelated')}</p>
        ) : (
          <ul className="mt-2 divide-y">
            {detail.relatedProblems.map(({ problem, minutesAfterDeployment }) => (
              <li key={problem.id} className="flex flex-wrap items-baseline gap-2 py-2">
                <SeverityBadge severity={problem.severity} label={problem.severity} />
                <Link
                  href={subsectionPath(context.scope, 'overview', 'problems', problem.id)}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  {problem.title}
                </Link>
                <span className="text-xs text-muted-foreground">{t('after', { minutes: minutesAfterDeployment })}</span>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>
    </SectionLayout>
  );
}
