import { getLocale, getTranslations } from 'next-intl/server';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Sparkline } from '@/components/monitoring/sparkline';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { listDatabases, rdsMetricQueries, type RdsInstance, type RdsMetric } from '@/lib/monitoring/rds';
import { formatMetricValue, NO_VALUE } from '@/lib/monitoring/shared/format';
import { monitoringPath } from '@/lib/monitoring/shared/paths';
import { currentWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';

const LIST_METRICS: RdsMetric[] = ['CPUUtilization', 'DatabaseConnections', 'FreeableMemory'];

/** Replica lag only exists on Aurora readers; the other instances keep the three shared metrics. */
const listMetrics = (instance: RdsInstance): RdsMetric[] =>
  instance.aurora && instance.role === 'reader' ? [...LIST_METRICS, 'AuroraReplicaLag'] : LIST_METRICS;

export async function DatabasesCard({ scope, range }: { scope: MonitoringScope; range: TimeRange }) {
  const t = await getTranslations('Monitoring.databases');
  const tMetrics = await getTranslations('Monitoring.metrics');
  const tCommon = await getTranslations('Monitoring.common');
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
  const databases = await listDatabases(target.data);
  if (!databases.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={databases} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  const { instances } = databases.data;
  if (instances.length === 0) {
    return (
      <MonitoringCard title={title}>
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </MonitoringCard>
    );
  }

  const queries = instances.flatMap((instance, index) => rdsMetricQueries(instance.id, listMetrics(instance), `d${index}`));
  const metrics = await getMetricSeries(target.data, queries, currentWindow(range));
  const series: MetricSeries[] = metrics.ok ? metrics.data : [];

  const cell = (id: string, metric: RdsMetric, index: number, unit: 'percent' | 'count' | 'bytes' | 'milliseconds', label: string, max?: number) => {
    const data = seriesById(series, `d${index}${metric}`);
    const value = formatMetricValue(latestValue(data), unit, locale);
    return (
      <div className="flex items-center gap-3" key={id}>
        <span className="w-20 tabular-nums">{value}</span>
        <Sparkline values={data.values} max={max} label={tCommon('sparkline', { metric: label, value })} />
      </div>
    );
  };

  return (
    <MonitoringCard title={title}>
      {!metrics.ok && (
        <div className="mb-3">
          <FailureNotice failure={metrics} connectionId={scope.connectionId} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.instance')}</TableHead>
            <TableHead>{t('columns.cluster')}</TableHead>
            <TableHead>{t('columns.engine')}</TableHead>
            <TableHead>{t('columns.class')}</TableHead>
            <TableHead>{t('columns.role')}</TableHead>
            <TableHead>{t('columns.cpu')}</TableHead>
            <TableHead>{t('columns.connections')}</TableHead>
            <TableHead>{t('columns.freeableMemory')}</TableHead>
            <TableHead>{t('columns.replicaLag')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((instance, index) => (
            <TableRow key={instance.arn ?? instance.id}>
              <TableCell>
                <Link
                  href={`${monitoringPath(scope, 'databases', instance.id)}?range=${range}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {instance.id}
                </Link>
              </TableCell>
              <TableCell>{instance.clusterId ?? NO_VALUE}</TableCell>
              <TableCell>
                {instance.engine}
                {instance.engineVersion && <span className="text-muted-foreground"> {instance.engineVersion}</span>}
              </TableCell>
              <TableCell className="font-mono text-xs">{instance.instanceClass}</TableCell>
              <TableCell>{t(`roles.${instance.role}`)}</TableCell>
              <TableCell>{cell('cpu', 'CPUUtilization', index, 'percent', tMetrics('cpu'), 100)}</TableCell>
              <TableCell>{cell('connections', 'DatabaseConnections', index, 'count', tMetrics('connections'))}</TableCell>
              <TableCell>{cell('memory', 'FreeableMemory', index, 'bytes', tMetrics('freeableMemory'))}</TableCell>
              <TableCell>
                {instance.aurora && instance.role === 'reader' ? (
                  cell('lag', 'AuroraReplicaLag', index, 'milliseconds', tMetrics('replicaLag'))
                ) : (
                  <span className="text-muted-foreground">{NO_VALUE}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </MonitoringCard>
  );
}
