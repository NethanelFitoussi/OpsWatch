import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MetricChart, type ChartSeries } from '@/components/monitoring/metric-chart';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import type { AwsTarget, MonitoringScope } from '@/lib/monitoring/call';
import { getMetricSeries, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { piWindow, topSql } from '@/lib/monitoring/pi';
import { RDS_METRIC_UNITS, detailMetrics, findInstance, rdsMetricQueries, type RdsInstance, type RdsMetric } from '@/lib/monitoring/rds';
import type { MonitoringFailure } from '@/lib/monitoring/result';
import { formatMetricValue, NO_VALUE } from '@/lib/monitoring/shared/format';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';

type InstanceRef = { scope: MonitoringScope; instanceId: string };
type Loaded = { ok: true; target: AwsTarget; instance: RdsInstance } | { ok: false; card: ReactNode };

/** Statements longer than this are collapsed to three lines, with the rest one click away. */
const STATEMENT_PREVIEW_CHARS = 200;
/** Hard cap on the SQL text kept in the page, whatever Performance Insights returns. */
const STATEMENT_MAX_CHARS = 4000;

const GIB = 1024 ** 3;

const chartSeries = (series: readonly MetricSeries[], metric: RdsMetric, label: string): ChartSeries => ({
  id: `m${metric}`,
  label,
  ...seriesById(series, `m${metric}`),
});

/** Resolves credentials and the instance inside the card (both cached), or returns the card to render instead. */
async function loadInstance({ scope, instanceId }: InstanceRef, title: string): Promise<Loaded> {
  const t = await getTranslations('Monitoring.databases');
  const message = (body: ReactNode): Loaded => ({ ok: false, card: <MonitoringCard title={title}>{body}</MonitoringCard> });
  const failed = (failure: MonitoringFailure) => message(<FailureNotice failure={failure} connectionId={scope.connectionId} />);
  const target = await resolveTarget(scope);
  if (!target.ok) return failed(target);
  const found = await findInstance(target.data, instanceId);
  if (!found.ok) return failed(found);
  if (!found.data) return message(<p className="text-sm text-muted-foreground">{t('notFound')}</p>);
  return { ok: true, target: target.data, instance: found.data.instance };
}

export async function InstanceSummaryCard(ref: InstanceRef) {
  const t = await getTranslations('Monitoring.databases');
  const title = t('summary.title');
  const loaded = await loadInstance(ref, title);
  if (!loaded.ok) return loaded.card;
  const locale = await getLocale();
  const { instance } = loaded;
  const item = (label: string, value: ReactNode) => (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
  return (
    <MonitoringCard title={title}>
      <dl className="grid gap-3 sm:grid-cols-3">
        {item(t('summary.status'), instance.status)}
        {item(t('summary.engine'), [instance.engine, instance.engineVersion].filter(Boolean).join(' '))}
        {item(t('summary.class'), <span className="font-mono text-xs">{instance.instanceClass}</span>)}
        {item(t('summary.memory'), instance.memoryGiB != null ? formatMetricValue(instance.memoryGiB * GIB, 'bytes', locale) : t('summary.memoryUnknown'))}
        {item(t('summary.role'), t(`roles.${instance.role}`))}
        {item(t('summary.cluster'), instance.clusterId ?? NO_VALUE)}
        {item(t('summary.zone'), instance.availabilityZone ?? NO_VALUE)}
        {item(t('summary.performanceInsights'), instance.performanceInsights ? t('summary.enabled') : t('summary.disabled'))}
      </dl>
    </MonitoringCard>
  );
}

export async function InstanceChartsCard({ range, nowMs, ...ref }: InstanceRef & { range: TimeRange; nowMs: number }) {
  const t = await getTranslations('Monitoring.databases');
  const tMetrics = await getTranslations('Monitoring.metrics');
  const title = t('charts.title');
  const loaded = await loadInstance(ref, title);
  if (!loaded.ok) return loaded.card;
  const metrics = detailMetrics(loaded.instance);
  const result = await getMetricSeries(loaded.target, rdsMetricQueries(loaded.instance.id, metrics, 'm'), timeWindow(range, nowMs));
  if (!result.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={result} connectionId={ref.scope.connectionId} />
      </MonitoringCard>
    );
  }
  const series = result.data;
  return (
    <MonitoringCard title={title}>
      <div className="grid gap-6 md:grid-cols-2">
        <MetricChart title={tMetrics('cpu')} unit={RDS_METRIC_UNITS.CPUUtilization} range={range} series={[chartSeries(series, 'CPUUtilization', tMetrics('cpu'))]} />
        <MetricChart
          title={tMetrics('connections')}
          unit={RDS_METRIC_UNITS.DatabaseConnections}
          range={range}
          series={[chartSeries(series, 'DatabaseConnections', tMetrics('connections'))]}
        />
        <MetricChart
          title={tMetrics('freeableMemory')}
          unit={RDS_METRIC_UNITS.FreeableMemory}
          range={range}
          series={[chartSeries(series, 'FreeableMemory', tMetrics('freeableMemory'))]}
        />
        <MetricChart
          title={tMetrics('iops')}
          unit={RDS_METRIC_UNITS.ReadIOPS}
          range={range}
          series={[chartSeries(series, 'ReadIOPS', tMetrics('read')), chartSeries(series, 'WriteIOPS', tMetrics('write'))]}
        />
        <MetricChart
          title={tMetrics('latency')}
          unit={RDS_METRIC_UNITS.ReadLatency}
          range={range}
          series={[chartSeries(series, 'ReadLatency', tMetrics('read')), chartSeries(series, 'WriteLatency', tMetrics('write'))]}
        />
        {metrics.includes('AuroraReplicaLag') && (
          <MetricChart
            title={tMetrics('replicaLag')}
            unit={RDS_METRIC_UNITS.AuroraReplicaLag}
            range={range}
            series={[chartSeries(series, 'AuroraReplicaLag', tMetrics('replicaLag'))]}
          />
        )}
      </div>
    </MonitoringCard>
  );
}

/**
 * SQL text comes from the database: it is rendered as text (never as HTML), capped, and shown on three
 * lines until the reader opens it. Aurora statements are often hundreds of characters long.
 */
function Statement({ statement, showFull }: { statement: string; showFull: string }) {
  if (statement === '') return <span className="text-muted-foreground">{NO_VALUE}</span>;
  const text = statement.length > STATEMENT_MAX_CHARS ? `${statement.slice(0, STATEMENT_MAX_CHARS)}…` : statement;
  const code = (className: string) => <code className={`block font-mono text-xs break-all whitespace-pre-wrap ${className}`}>{text}</code>;
  if (statement.length <= STATEMENT_PREVIEW_CHARS) return code('');
  return (
    <details className="group">
      <summary className="cursor-pointer list-none rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {code('line-clamp-3 group-open:line-clamp-none')}
        <span className="mt-1 inline-block text-xs text-primary underline-offset-4 group-open:hidden">{showFull}</span>
      </summary>
    </details>
  );
}

export async function TopSqlCard({ range, nowMs, ...ref }: InstanceRef & { range: TimeRange; nowMs: number }) {
  const t = await getTranslations('Monitoring.databases');
  const title = t('topSql.title');
  const description = t('topSql.description');
  const loaded = await loadInstance(ref, title);
  if (!loaded.ok) return loaded.card;
  const { instance } = loaded;
  if (!instance.performanceInsights || !instance.resourceId) {
    return (
      <MonitoringCard title={title} description={description}>
        <p className="text-sm text-muted-foreground">{t('topSql.disabled')}</p>
      </MonitoringCard>
    );
  }
  const locale = await getLocale();
  const statements = await topSql(loaded.target, instance.resourceId, piWindow(range, nowMs));
  return (
    <MonitoringCard title={title} description={description}>
      {!statements.ok ? (
        <FailureNotice failure={statements} connectionId={ref.scope.connectionId} />
      ) : statements.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('topSql.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">{t('topSql.columns.rank')}</TableHead>
              <TableHead>{t('topSql.columns.statement')}</TableHead>
              <TableHead className="w-40">{t('topSql.columns.load')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statements.data.map((entry, index) => (
              <TableRow key={entry.id ?? `rank-${index}`}>
                <TableCell className="tabular-nums">{index + 1}</TableCell>
                <TableCell className="max-w-xl">
                  <Statement statement={entry.statement} showFull={t('topSql.showFull')} />
                </TableCell>
                <TableCell className="tabular-nums">{formatMetricValue(entry.load, 'rate', locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </MonitoringCard>
  );
}
