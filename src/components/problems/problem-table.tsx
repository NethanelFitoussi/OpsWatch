import { getFormatter, getTranslations } from 'next-intl/server';
import type { ProblemSummary, Severity } from '@opswatch/contract';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Link } from '@/i18n/navigation';
import type { ScopeRef } from '@/lib/monitoring/shared/paths';
import { subsectionPath } from '@/lib/monitoring/shared/paths';

export type ProblemTableLabels = {
  title: string;
  description: string;
  empty: string;
  emptyHint: string;
  waiting: string;
  waitingHint: string;
  counts: string;
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * The Problems list.
 *
 * Ordered worst first, which is a *sort inside the page* and never the cursor axis — §33.6 keeps paging on
 * the immutable `(seq, id)` pair, because score and recency move while a reader is paging.
 *
 * The empty state is two different states, deliberately kept apart: an instance whose first detect cycle has
 * not run yet knows nothing, and telling it "nothing is wrong" would be the most damaging thing a monitoring
 * tool can say.
 */
export async function ProblemTable({
  problems,
  nowMs,
  scope,
  hasRun,
  labels,
}: {
  problems: readonly ProblemSummary[];
  nowMs: number;
  scope: ScopeRef;
  hasRun: boolean;
  labels: ProblemTableLabels;
}) {
  const t = await getTranslations('Monitoring.problems');
  const tSeverity = await getTranslations('Insights.severity');
  const format = await getFormatter();
  const ranked = [...problems].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.score ?? 0) - (a.score ?? 0) || b.lastSeenAt - a.lastSeenAt,
  );

  if (ranked.length === 0) {
    return (
      <MonitoringCard title={labels.title} description={labels.description}>
        <p className="text-sm">{hasRun ? labels.empty : labels.waiting}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hasRun ? labels.emptyHint : labels.waitingHint}</p>
      </MonitoringCard>
    );
  }

  return (
    <MonitoringCard title={labels.title} description={labels.description}>
      <p className="mb-3 text-sm text-muted-foreground">{labels.counts}</p>
      {/* A table at every width: the header is hidden below `sm` and each row reads as a block instead. */}
      <ul aria-label={labels.title} className="divide-y">
        {ranked.map((problem) => (
          <li key={problem.id} className="py-3">
            <Link
              href={subsectionPath(scope, 'overview', 'problems', problem.id)}
              className="group flex flex-col gap-1 focus-visible:outline-2 focus-visible:outline-ring sm:flex-row sm:items-baseline sm:gap-4"
            >
              <span className="sm:w-28 sm:shrink-0">
                <SeverityBadge severity={problem.severity} label={tSeverity(problem.severity)} />
              </span>
              <span className="min-w-0 flex-1 text-sm group-hover:underline">{problem.title}</span>
              <span className="flex shrink-0 items-baseline gap-3 text-xs text-muted-foreground">
                <span>{t(`status.${problem.status}`)}</span>
                <span>
                  {t('columns.lastSeen')} {format.relativeTime(new Date(problem.lastSeenAt), new Date(nowMs))}
                </span>
                {problem.occurrences !== null && <span>{t('occurrencesValue', { count: problem.occurrences })}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </MonitoringCard>
  );
}
