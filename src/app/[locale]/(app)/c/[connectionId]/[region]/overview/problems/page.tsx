import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { ProblemTable } from '@/components/problems/problem-table';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { countBySeverity, listProblems } from '@/lib/read/problems';
import { insightRenderer } from '@/lib/read/render';
import { lastRunOf } from '@/lib/read/status';

type Props = { params: Promise<MonitoringParams> };

export const generateMetadata = localizedTitle('Monitoring.problems.title');

/**
 * The Problems list: what OpsWatch believes is wrong right now.
 *
 * It reads the same `listProblems` that `GET /api/v1/problems` answers with, so the browser and the phone
 * cannot disagree about what a problem is. The rows come from the database the collector writes — nothing
 * here calls AWS, which is why the page is fast and costs nothing.
 */
export default async function ProblemsPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const nowMs = pageNow();
  const db = getDb();
  const t = await getTranslations('Monitoring.problems');

  const read = { nowMs, render: await insightRenderer(context.locale) };
  const query = { connectionId: context.scope.connectionId, scope: context.scope.region };
  const page = listProblems(db, { ...query, status: ['open', 'acknowledged'] }, read);
  const counts = countBySeverity(db, query);
  // "Nothing is wrong" and "nobody has looked yet" are different answers, and a first-run instance must not
  // be shown the first when it means the second.
  const firstRun = lastRunOf(db, 'detect', query);

  return (
    <SectionLayout context={context} section="overview" subsection="problems" description={t('description')}>
      <ProblemTable
        problems={page.items}
        nowMs={nowMs}
        scope={context.scope}
        hasRun={firstRun !== null}
        labels={{
          title: t('title'),
          description: t('description'),
          empty: t('empty'),
          emptyHint: t('emptyHint'),
          waiting: t('waiting'),
          waitingHint: t('waitingHint'),
          counts: t('counts', counts),
        }}
      />
    </SectionLayout>
  );
}
