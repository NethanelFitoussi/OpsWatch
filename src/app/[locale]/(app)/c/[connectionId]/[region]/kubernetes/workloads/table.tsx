import { getTranslations } from 'next-intl/server';
import { MetricCell } from '@/components/infra/metric-cell';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { ECS_UTILIZATION_LEVELS } from '@/lib/monitoring/insights';
import { listKubePods, listKubeWorkloads, podQueries, workloadQueries } from '@/lib/monitoring/kubernetes';
import { evaluateKubePod } from '@/lib/monitoring/kubernetes-health';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { STATE_FILL } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * Workloads and the pods under them.
 *
 * Two tables rather than one tree, because Container Insights does not publish which pod belongs to which
 * workload — it publishes both, separately, under the same namespace. Drawing a tree would mean guessing
 * the edges, and a guessed edge is the one thing a topology must never contain.
 */
export async function KubeWorkloadsTable({ scope, range, nowMs, search }: { scope: MonitoringScope; range: TimeRange; nowMs: number; search: string }) {
  const t = await getTranslations('Monitoring.kubernetes');
  const estate = await getTranslations('Monitoring.estate');

  const target = await resolveTarget(scope);
  if (!target.ok) return <FailureNotice failure={target} connectionId={scope.connectionId} />;
  const [workloads, pods] = await Promise.all([listKubeWorkloads(target.data), listKubePods(target.data)]);
  if (!workloads.ok) return <FailureNotice failure={workloads} connectionId={scope.connectionId} />;
  if (!pods.ok) return <FailureNotice failure={pods} connectionId={scope.connectionId} />;

  const needle = search.trim().toLowerCase();
  const matches = (namespace: string, name: string) =>
    needle.length === 0 || namespace.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
  const shownWorkloads = workloads.data.filter((workload) => matches(workload.namespace, workload.name));
  const shownPods = pods.data.pods.filter((pod) => matches(pod.namespace, pod.name));

  if (shownWorkloads.length === 0 && shownPods.length === 0) {
    return <p className="text-sm text-muted-foreground">{needle.length === 0 ? t('none') : t('noneMatching')}</p>;
  }

  const metrics = await getMetricSeries(
    target.data,
    [...shownWorkloads.flatMap((workload, i) => workloadQueries(workload, `w${i}`)), ...shownPods.flatMap((pod, i) => podQueries(pod, `p${i}`))],
    timeWindow(range, nowMs),
  );
  const series: MetricSeries[] = metrics.ok ? metrics.data : [];

  return (
    <div className="space-y-6">
      {!metrics.ok && <FailureNotice failure={metrics} connectionId={scope.connectionId} />}

      {shownWorkloads.length > 0 && (
        <MonitoringCard title={t('workloadsTitle')} description={t('workloadsDescription')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.workload')}</TableHead>
                <TableHead>{t('columns.namespace')}</TableHead>
                <TableHead>{t('columns.runningPods')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownWorkloads.map((workload, i) => {
                const running = latestValue(seriesById(series, `w${i}pods`));
                return (
                  <TableRow key={workload.key}>
                    <TableCell className="font-medium">{workload.name}</TableCell>
                    <TableCell className="font-mono text-xs">{workload.namespace}</TableCell>
                    {/* No desired count in CloudWatch, so this is "how many are running" and never a ratio. */}
                    <TableCell>
                      <MetricCell value={running === null ? null : Math.round(running)} missing={NO_VALUE} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </MonitoringCard>
      )}

      {shownPods.length > 0 && (
        <MonitoringCard title={t('podsTitle')} description={t('podsDescription')}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.pod')}</TableHead>
                <TableHead>{t('columns.namespace')}</TableHead>
                <TableHead>{t('columns.health')}</TableHead>
                <TableHead>{t('columns.cpu')}</TableHead>
                <TableHead>{t('columns.memory')}</TableHead>
                <TableHead>{t('columns.restarts')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownPods.map((pod, i) => {
                const cpu = latestValue(seriesById(series, `p${i}cpu`));
                const memory = latestValue(seriesById(series, `p${i}mem`));
                const restarts = latestValue(seriesById(series, `p${i}restarts`));
                const evaluation = evaluateKubePod({ cpu, memory, restarts, metricsUnavailable: !metrics.ok }, nowMs);
                return (
                  <TableRow key={pod.key}>
                    <TableCell className="font-medium">{pod.name}</TableCell>
                    <TableCell className="font-mono text-xs">{pod.namespace}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span className={cn('size-2 shrink-0 rounded-full', STATE_FILL[evaluation.state])} aria-hidden />
                        {estate(`state.${evaluation.state}`)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <MetricCell
                        value={cpu === null ? null : Math.round(cpu)}
                        max={100}
                        warnAt={ECS_UTILIZATION_LEVELS.warning.threshold}
                        failAt={ECS_UTILIZATION_LEVELS.critical?.threshold}
                        suffix="%"
                        missing={NO_VALUE}
                      />
                    </TableCell>
                    <TableCell>
                      <MetricCell
                        value={memory === null ? null : Math.round(memory)}
                        max={100}
                        warnAt={ECS_UTILIZATION_LEVELS.warning.threshold}
                        failAt={ECS_UTILIZATION_LEVELS.critical?.threshold}
                        suffix="%"
                        missing={NO_VALUE}
                      />
                    </TableCell>
                    <TableCell>
                      <MetricCell value={restarts === null ? null : Math.round(restarts)} missing={NO_VALUE} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </MonitoringCard>
      )}
    </div>
  );
}
