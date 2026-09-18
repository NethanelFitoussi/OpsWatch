import { getLocale, getTranslations } from 'next-intl/server';
import type React from 'react';
import { CoverageNote } from '@/components/analysis/coverage-note';
import { DenseTable, type DenseColumn, type DenseRow } from '@/components/analysis/dense-table';
import { NotCoveredList } from '@/components/analysis/not-covered-list';
import { TopNBars } from '@/components/analysis/top-n-bars';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import { fleetQueries, type FleetQueryRow, type QuerySort } from '@/lib/analysis/queries';
import type { MonitoringScope } from '@/lib/monitoring/call';
import type { PiGroup } from '@/lib/monitoring/pi';
import { formatMetricValue, NO_VALUE } from '@/lib/monitoring/shared/format';
import type { TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';

/** How much of a statement the closed row shows before the `<details>` has to be opened. */
const SUMMARY_LENGTH = 120;
const ELLIPSIS = '…';
/** The marker tying the share column to the sentence under the table; the sentence carries the meaning. */
const SHARE_FOOTNOTE = '*';

/** Performance Insights can return a key with no text at all; a row still has to name itself. */
function summarize(label: string): string {
  if (label.trim() === '') return NO_VALUE;
  return label.length > SUMMARY_LENGTH ? `${label.slice(0, SUMMARY_LENGTH)}${ELLIPSIS}` : label;
}

/**
 * Every instance's database load, merged by dimension id, with the instances each entry came from.
 *
 * The statement is rendered as text and nothing else: never as HTML, never syntax-highlighted and never
 * executed. It is attacker-controlled input as far as OpsWatch is concerned — whoever can run a query on
 * the database chooses it — so it goes through `<pre>` as a plain child, which React escapes.
 */
export async function FleetQueriesCard({
  scope,
  group,
  sort,
  range,
  nowMs,
}: {
  scope: MonitoringScope;
  group: PiGroup;
  sort: QuerySort;
  range: TimeRange;
  nowMs: number;
}): Promise<React.JSX.Element> {
  const t = await getTranslations('Monitoring.queries');
  const locale = await getLocale();
  const title = t('cardTitle');

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  const queries = await fleetQueries(target.data, { group, sort, range, nowMs });
  if (!queries.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={queries} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  const { rows, coverage, notCovered, limitPerInstance } = queries.data;
  const columns: DenseColumn[] = [
    { id: 'statement', label: t('columns.statement'), priority: 'always' },
    { id: 'load', label: t('columns.load'), priority: 'always', align: 'right' },
    { id: 'share', label: t('columns.share'), priority: 'sm', align: 'right' },
    { id: 'instances', label: t('columns.instances'), priority: 'sm', align: 'right' },
    { id: 'origins', label: t('columns.origins'), priority: 'md' },
  ];

  const statementCell = (row: FleetQueryRow) => (
    <details>
      <summary className="cursor-pointer font-mono text-xs break-words">
        {summarize(row.label)}
        <span className="sr-only"> {t('expand')}</span>
      </summary>
      <pre className="mt-2 font-mono text-xs whitespace-pre-wrap break-words">{row.label}</pre>
    </details>
  );

  const originsCell = (row: FleetQueryRow) => (
    <ul className="space-y-0.5">
      {row.origins.map((origin) => (
        <li key={origin.instance}>
          {t.rich('origin', {
            instance: origin.instance,
            load: formatMetricValue(origin.load, 'rate', locale),
            share: formatMetricValue(origin.sharePercent, 'percent', locale),
            link: (chunks) => (
              <Link href={origin.href} className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                {chunks}
              </Link>
            ),
          })}
        </li>
      ))}
    </ul>
  );

  const tableRows: DenseRow[] = rows.map((row) => ({
    id: row.key,
    cells: {
      statement: statementCell(row),
      load: formatMetricValue(row.totalLoad, 'rate', locale),
      share: (
        <>
          {formatMetricValue(row.sharePercent, 'percent', locale)}
          <sup aria-hidden className="ml-0.5 text-muted-foreground">
            {SHARE_FOOTNOTE}
          </sup>
        </>
      ),
      instances: formatMetricValue(row.instanceCount, 'count', locale),
      origins: originsCell(row),
    },
  }));

  return (
    <MonitoringCard title={title}>
      <div className="space-y-4">
        {/* Always visible, populated table or not: it is what stops the table from reading as a ranking. */}
        <p className="text-sm text-muted-foreground">{t('scopeNote', { limit: limitPerInstance })}</p>
        <CoverageNote coverage={coverage} resourceKey="instances" />
        {rows.length > 0 && (
          <TopNBars
            label={t('topLabel')}
            items={rows.slice(0, 10).map((row) => ({ id: row.key, name: summarize(row.label), value: row.totalLoad }))}
            unit="rate"
          />
        )}
        <DenseTable
          caption={t('tableCaption', { group: t(`groupBy.${group}`) })}
          columns={columns}
          rows={tableRows}
          shown={tableRows.length}
          total={tableRows.length}
          // Nothing to show has two meanings, and the reason list below decides which one it is.
          emptyKey={notCovered.length > 0 ? 'Monitoring.queries.emptyButUncovered' : 'Monitoring.queries.empty'}
        />
        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {SHARE_FOOTNOTE} {t('shareNote')}
          </p>
        )}
        <NotCoveredList rows={notCovered} titleKey="Monitoring.queries.notCoveredTitle" />
      </div>
    </MonitoringCard>
  );
}
