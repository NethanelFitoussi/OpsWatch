import { getTranslations } from 'next-intl/server';
import { MetricCell } from '@/components/infra/metric-cell';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { REDIS_ENGINE_CPU_LEVELS, REDIS_MEMORY_LEVELS } from '@/lib/monitoring/insights';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { listRedisNodes, redisQueries } from '@/lib/monitoring/redis';
import { evaluateRedisNode, hitRate } from '@/lib/monitoring/redis-health';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { STATE_FILL } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const sum = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((total, value) => total + value, 0));

/**
 * Every Redis node, with the numbers that explain the verdict and the numbers that do not.
 *
 * Engine CPU and memory carry a bar, because both are percentages with a real ceiling. Connections,
 * evictions and hit rate carry none: a bar under a scale nobody stated is a picture of nothing, and
 * OpsWatch cannot read `maxclients` without the ElastiCache API.
 */
export async function RedisTable({ scope, range, nowMs, search }: { scope: MonitoringScope; range: TimeRange; nowMs: number; search: string }) {
  const t = await getTranslations('Monitoring.redis');
  const estate = await getTranslations('Monitoring.estate');

  const target = await resolveTarget(scope);
  if (!target.ok) return <FailureNotice failure={target} connectionId={scope.connectionId} />;
  const listed = await listRedisNodes(target.data);
  if (!listed.ok) return <FailureNotice failure={listed} connectionId={scope.connectionId} />;

  const needle = search.trim().toLowerCase();
  const nodes = needle.length === 0 ? listed.data : listed.data.filter((node) => node.key.toLowerCase().includes(needle));
  if (nodes.length === 0) return <p className="text-sm text-muted-foreground">{needle.length === 0 ? t('none') : t('noneMatching')}</p>;

  const metrics = await getMetricSeries(target.data, nodes.flatMap((node, i) => redisQueries(node, `r${i}`)), timeWindow(range, nowMs));
  const series: MetricSeries[] = metrics.ok ? metrics.data : [];

  return (
    <MonitoringCard title={t('nodesTitle')} description={t('nodesDescription')}>
      {!metrics.ok && (
        <div className="mb-3">
          <FailureNotice failure={metrics} connectionId={scope.connectionId} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.node')}</TableHead>
            <TableHead>{t('columns.health')}</TableHead>
            <TableHead>{t('columns.engineCpu')}</TableHead>
            <TableHead>{t('columns.memory')}</TableHead>
            <TableHead>{t('columns.connections')}</TableHead>
            <TableHead>{t('columns.evictions')}</TableHead>
            <TableHead>{t('columns.hitRate')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((node, i) => {
            const engineCpu = latestValue(seriesById(series, `r${i}engine`));
            const memoryPercent = latestValue(seriesById(series, `r${i}memory`));
            const evictions = sum(seriesById(series, `r${i}evict`).values);
            const rate = hitRate(sum(seriesById(series, `r${i}hits`).values), sum(seriesById(series, `r${i}misses`).values));
            const evaluation = evaluateRedisNode({ engineCpu, memoryPercent, evictions, metricsUnavailable: !metrics.ok }, nowMs);
            return (
              <TableRow key={node.key}>
                <TableCell className="font-medium">{node.key}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className={cn('size-2 shrink-0 rounded-full', STATE_FILL[evaluation.state])} aria-hidden />
                    {estate(`state.${evaluation.state}`)}
                  </span>
                </TableCell>
                <TableCell>
                  <MetricCell
                    value={engineCpu === null ? null : Math.round(engineCpu)}
                    max={100}
                    warnAt={REDIS_ENGINE_CPU_LEVELS.warning.threshold}
                    failAt={REDIS_ENGINE_CPU_LEVELS.critical?.threshold}
                    suffix="%"
                    missing={NO_VALUE}
                  />
                </TableCell>
                <TableCell>
                  <MetricCell
                    value={memoryPercent === null ? null : Math.round(memoryPercent)}
                    max={100}
                    warnAt={REDIS_MEMORY_LEVELS.warning.threshold}
                    failAt={REDIS_MEMORY_LEVELS.critical?.threshold}
                    suffix="%"
                    missing={NO_VALUE}
                  />
                </TableCell>
                {/* No ceiling OpsWatch can read, so no bar and no verdict — only the number. */}
                <TableCell>
                  <MetricCell value={latestValue(seriesById(series, `r${i}conns`))} missing={NO_VALUE} />
                </TableCell>
                <TableCell>
                  <MetricCell value={evictions === null ? null : Math.round(evictions)} missing={NO_VALUE} />
                </TableCell>
                <TableCell>
                  {/* Null, not zero: nobody asked this cache anything, which is not a 0 % hit rate. */}
                  <MetricCell value={rate === null ? null : Math.round(rate)} suffix="%" missing={NO_VALUE} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </MonitoringCard>
  );
}
