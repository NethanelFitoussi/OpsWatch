import { getTranslations } from 'next-intl/server';
import { DocLink } from '@/components/docs/doc-link';
import { HealthySummary } from '@/components/infra/healthy-summary';
import { MetricCell } from '@/components/infra/metric-cell';
import { ResourceMap, type MapGroup, type MapTile } from '@/components/infra/resource-map';
import { StatusBar } from '@/components/infra/status-bar';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { ECS_UTILIZATION_LEVELS } from '@/lib/monitoring/insights';
import {
  MAX_PODS,
  clusterQueries,
  listKubeClusters,
  listKubeNodes,
  listKubePods,
  nodeQueries,
  podQueries,
  type KubePod,
} from '@/lib/monitoring/kubernetes';
import { evaluateKubeCluster, evaluateKubeNode, evaluateKubePod } from '@/lib/monitoring/kubernetes-health';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { rollUp, type Evaluation } from '@/lib/monitoring/shared/evaluated-health';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * Kubernetes, as far as CloudWatch can see it: cluster, node, namespace, pod.
 *
 * The section exists only where Container Insights is on, and that is the first thing the page has to be
 * able to say. **Nothing here is on by default**, so "no clusters" is by far the most likely first
 * answer — and it is an instruction, not an empty page.
 */

type JudgedPod = { pod: KubePod; evaluation: Evaluation; cpu: number | null; restarts: number | null };

export async function KubeClusters({ scope, range, nowMs }: { scope: MonitoringScope; range: TimeRange; nowMs: number }) {
  const t = await getTranslations('Monitoring.kubernetes');
  const estate = await getTranslations('Monitoring.estate');

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={t('title')}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  const clusters = await listKubeClusters(target.data);
  if (!clusters.ok) {
    return (
      <MonitoringCard title={t('title')}>
        <FailureNotice failure={clusters} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  if (clusters.data.length === 0) {
    // Never a reassuring blank. OpsWatch cannot see a cluster it was not given a way to see.
    return (
      <MonitoringCard title={t('noneTitle')} description={t('noneDescription')}>
        <p className="text-sm">{t('none')}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t('noneHint')}</p>
        <p className="mt-3">
          <DocLink slug="kubernetes" label={t('setUp')} />
        </p>
      </MonitoringCard>
    );
  }

  const [nodes, pods] = await Promise.all([listKubeNodes(target.data), listKubePods(target.data)]);
  const nodeList = nodes.ok ? nodes.data : [];
  const podList = pods.ok ? pods.data.pods : [];

  const window = timeWindow(range, nowMs);
  const queries = [
    ...clusters.data.flatMap((cluster, i) => clusterQueries(cluster.name, `c${i}`)),
    ...nodeList.flatMap((node, i) => nodeQueries(node, `n${i}`)),
    ...podList.flatMap((pod, i) => podQueries(pod, `p${i}`)),
  ];
  const metrics = queries.length > 0 ? await getMetricSeries(target.data, queries, window) : null;
  const series: MetricSeries[] = metrics?.ok ? metrics.data : [];
  const metricsUnavailable = metrics !== null && !metrics.ok;

  const judgedClusters = clusters.data.map((cluster, i) => ({
    cluster,
    evaluation: evaluateKubeCluster(
      {
        nodeCount: latestValue(seriesById(series, `c${i}nodes`)),
        failedNodes: latestValue(seriesById(series, `c${i}failed`)),
        metricsUnavailable,
      },
      nowMs,
    ),
  }));

  const judgedNodes = nodeList.map((node, i) => {
    const cpu = latestValue(seriesById(series, `n${i}cpu`));
    return {
      node,
      cpu,
      pods: latestValue(seriesById(series, `n${i}pods`)),
      evaluation: evaluateKubeNode(
        { cpu, memory: latestValue(seriesById(series, `n${i}mem`)), pods: latestValue(seriesById(series, `n${i}pods`)), metricsUnavailable },
        nowMs,
      ),
    };
  });

  const judgedPods: JudgedPod[] = podList.map((pod, i) => {
    const cpu = latestValue(seriesById(series, `p${i}cpu`));
    const restarts = latestValue(seriesById(series, `p${i}restarts`));
    return {
      pod,
      cpu,
      restarts,
      evaluation: evaluateKubePod(
        { cpu, memory: latestValue(seriesById(series, `p${i}mem`)), restarts, metricsUnavailable },
        nowMs,
      ),
    };
  });

  // The estate's verdict is the pods', because a pod is the thing that serves. Cluster and node health
  // appear beside it as their own evidence rather than being averaged into one number.
  const estateHealth = rollUp(judgedPods.map((entry) => entry.evaluation.state));
  const namespaces = [...new Set(podList.map((pod) => `${pod.cluster}/${pod.namespace}`))].sort();

  const groups: MapGroup[] = namespaces.map((key) => {
    const [cluster, namespace] = key.split('/');
    return {
      key,
      label: clusters.data.length > 1 ? `${cluster} · ${namespace}` : namespace,
      tiles: judgedPods
        .filter((entry) => `${entry.pod.cluster}/${entry.pod.namespace}` === key)
        .map(
          (entry): MapTile => ({
            id: entry.pod.key,
            label: entry.pod.name,
            state: entry.evaluation.state,
            detail:
              entry.restarts !== null && entry.restarts > 0
                ? t('tileRestarts', { count: Math.round(entry.restarts) })
                : entry.cpu === null
                  ? t('tileNoCpu')
                  : t('tileCpu', { value: Math.round(entry.cpu) }),
            href: `${subsectionPath(scope, 'kubernetes', 'workloads')}?range=${range}&q=${encodeURIComponent(entry.pod.namespace)}`,
          }),
        ),
    };
  });

  const busiest = [...judgedPods].filter((entry) => entry.cpu !== null).sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0)).slice(0, 5);

  return (
    <div className="space-y-6">
      <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <p className={cn('text-2xl font-semibold', STATE_TEXT[estateHealth.state])}>{estate(`verdict.${estateHealth.state}`)}</p>
            <StatusBar group={estateHealth} />
            <dl className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('clusters')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{clusters.data.length}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('nodes')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{nodeList.length}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('pods')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{judgedPods.length}</dd>
              </div>
            </dl>
          </div>
          <div className="space-y-4">
            {judgedClusters.map((entry) => (
              <div key={entry.cluster.name}>
                <p className="text-sm font-medium">{entry.cluster.name}</p>
                <HealthySummary evaluation={entry.evaluation} nowMs={nowMs} showVerdict={false} />
              </div>
            ))}
          </div>
        </div>
      </MonitoringCard>

      {/* The boundary, where an operator will notice it rather than in a manual. */}
      <MonitoringCard title={t('limitsTitle')}>
        <p className="text-sm text-muted-foreground">{t('limits')}</p>
        <p className="mt-2">
          <DocLink slug="kubernetes" label={t('readGuide')} />
        </p>
      </MonitoringCard>

      <MonitoringCard title={t('mapTitle')} description={t('mapDescription')}>
        <ResourceMap groups={groups} groupedByLabel={estate('groupedBy', { dimension: t('byNamespace') })} />
        {pods.ok && pods.data.truncated && <p className="mt-4 text-sm text-muted-foreground">{t('truncated', { shown: MAX_PODS })}</p>}
      </MonitoringCard>

      {judgedNodes.length > 0 && (
        <MonitoringCard title={t('nodesTitle')} description={t('nodesDescription')}>
          <ul className="space-y-2">
            {judgedNodes.map((entry) => (
              <li key={`${entry.node.cluster}/${entry.node.name}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <span className="min-w-0 truncate font-mono text-xs">{entry.node.name}</span>
                <span className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">
                    {entry.pods === null ? NO_VALUE : t('runningPods', { count: Math.round(entry.pods) })}
                  </span>
                  <MetricCell
                    value={entry.cpu === null ? null : Math.round(entry.cpu)}
                    max={100}
                    warnAt={ECS_UTILIZATION_LEVELS.warning.threshold}
                    failAt={ECS_UTILIZATION_LEVELS.critical?.threshold}
                    suffix="%"
                    missing={NO_VALUE}
                  />
                </span>
              </li>
            ))}
          </ul>
        </MonitoringCard>
      )}

      {busiest.length > 0 && (
        <MonitoringCard title={t('busiestTitle')} description={t('busiestDescription')}>
          <ul className="space-y-2">
            {busiest.map((entry) => (
              <li key={entry.pod.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <Link
                  href={`${subsectionPath(scope, 'kubernetes', 'workloads')}?range=${range}&q=${encodeURIComponent(entry.pod.namespace)}`}
                  className="min-w-0 truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {entry.pod.name}
                </Link>
                <MetricCell
                  value={entry.cpu === null ? null : Math.round(entry.cpu)}
                  max={100}
                  warnAt={ECS_UTILIZATION_LEVELS.warning.threshold}
                  failAt={ECS_UTILIZATION_LEVELS.critical?.threshold}
                  suffix="%"
                  missing={NO_VALUE}
                />
              </li>
            ))}
          </ul>
        </MonitoringCard>
      )}
    </div>
  );
}
