import { getTranslations } from 'next-intl/server';
import { MetricCell } from '@/components/infra/metric-cell';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { instanceQueries, listInstances } from '@/lib/monitoring/ec2';
import { evaluateEc2Instance } from '@/lib/monitoring/ec2-health';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { STATE_FILL } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * Every instance, as rows.
 *
 * The map answers "how much, and how much is wrong"; this answers "which ones, and what are they doing".
 * CPU and network carry an inline bar so a column can be scanned for outliers before a figure is read —
 * and only CPU gets one, because a percentage has a ceiling to be a fraction of and a byte count does not.
 */
export async function Ec2Table({ scope, range, nowMs, search }: { scope: MonitoringScope; range: TimeRange; nowMs: number; search: string }) {
  const t = await getTranslations('Monitoring.ec2');
  const estate = await getTranslations('Monitoring.estate');

  const target = await resolveTarget(scope);
  if (!target.ok) return <FailureNotice failure={target} connectionId={scope.connectionId} />;
  const listed = await listInstances(target.data);
  if (!listed.ok) return <FailureNotice failure={listed} connectionId={scope.connectionId} />;

  const needle = search.trim().toLowerCase();
  const all = listed.data.instances;
  const instances = needle.length === 0 ? all : all.filter((i) => i.name.toLowerCase().includes(needle) || i.id.toLowerCase().includes(needle));
  if (instances.length === 0) {
    return <p className="text-sm text-muted-foreground">{needle.length === 0 ? t('none') : t('noneMatching')}</p>;
  }

  const queries = instances.flatMap((instance, i) => instanceQueries(instance.id, `i${i}`));
  const metrics = await getMetricSeries(target.data, queries, timeWindow(range, nowMs));
  const series: MetricSeries[] = metrics.ok ? metrics.data : [];

  return (
    <MonitoringCard title={t('listTitle')} description={t('listDescription')}>
      {!metrics.ok && (
        <div className="mb-3">
          <FailureNotice failure={metrics} connectionId={scope.connectionId} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.instance')}</TableHead>
            <TableHead>{t('columns.health')}</TableHead>
            <TableHead>{t('columns.state')}</TableHead>
            <TableHead>{t('columns.type')}</TableHead>
            <TableHead>{t('columns.zone')}</TableHead>
            <TableHead>{t('columns.cpu')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((instance, i) => {
            const cpu = latestValue(seriesById(series, `i${i}cpu`));
            const failures = seriesById(series, `i${i}status`).values;
            const evaluation = evaluateEc2Instance(
              instance,
              { statusCheckFailed: failures.length === 0 ? null : Math.max(...failures), cpu, metricsUnavailable: !metrics.ok },
              nowMs,
            );
            return (
              <TableRow key={instance.id}>
                <TableCell>
                  <span className="font-medium">{instance.name}</span>
                  {instance.name !== instance.id && <span className="ml-2 font-mono text-xs text-muted-foreground">{instance.id}</span>}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className={cn('size-2 shrink-0 rounded-full', STATE_FILL[evaluation.state])} aria-hidden />
                    {estate(`state.${evaluation.state}`)}
                  </span>
                </TableCell>
                <TableCell>{instance.state}</TableCell>
                <TableCell className="font-mono text-xs">{instance.type}</TableCell>
                <TableCell className="font-mono text-xs">{instance.availabilityZone || NO_VALUE}</TableCell>
                <TableCell>
                  <MetricCell value={cpu === null ? null : Math.round(cpu)} max={100} suffix="%" missing={NO_VALUE} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </MonitoringCard>
  );
}
