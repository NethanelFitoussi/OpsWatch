import 'server-only';
import { CloudWatchClient, ListMetricsCommand, type Metric } from '@aws-sdk/client-cloudwatch';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MetricQuery } from './metrics';
import type { MonitoringResult } from './result';

/**
 * Kubernetes, through CloudWatch Container Insights.
 *
 * `eks:*` is not in the role's policy and adding it would make every deployed stack out of date — and it
 * would not help much anyway: `DescribeCluster` says a cluster exists, not whether anything in it is well.
 * Container Insights publishes the hierarchy OpsWatch actually needs, under permissions the role already
 * has, so that is the path.
 *
 * The boundary, stated here and on the page rather than discovered by an operator: this reaches
 * **cluster → namespace → workload → pod** and stops. Per-container state lives in the kubelet. Events,
 * pod phases, owner references, requests and limits are not in CloudWatch, and **a workload with no
 * running pods publishes nothing, so it looks the same as one that does not exist.**
 *
 * Everything here is discovered from `ListMetrics` rather than assumed: whatever the cluster publishes is
 * what appears, and a metric that is absent produces no check instead of a zero.
 */

const CONTAINER_INSIGHTS = 'ContainerInsights';

/** How many of each kind one page will read, so a large cluster cannot turn into an unbounded query. */
export const MAX_PODS = 200;
const MAX_NODES = 100;

export type KubeCluster = { name: string };
export type KubeNode = { cluster: string; name: string };
export type KubePod = { cluster: string; namespace: string; name: string; key: string };
export type KubeWorkload = { cluster: string; namespace: string; name: string; key: string };

const dimensionsOf = (metric: Metric): Map<string, string> =>
  new Map((metric.Dimensions ?? []).map((dimension) => [dimension.Name ?? '', dimension.Value ?? '']));

/** Every metric of one name in the Container Insights namespace, following CloudWatch's paging. */
async function listInsightMetrics(target: AwsTarget, metricName: string, deps: MonitoringDeps, limit: number): Promise<Metric[]> {
  const client = new CloudWatchClient(clientConfig(target.region, target.credentials));
  const metrics: Metric[] = [];
  let token: string | undefined;
  do {
    const out = await sendWithTimeout(
      client,
      new ListMetricsCommand({ Namespace: CONTAINER_INSIGHTS, MetricName: metricName, NextToken: token }),
      describeTimeout(deps),
    );
    metrics.push(...(out.Metrics ?? []));
    token = out.NextToken;
  } while (token !== undefined && metrics.length < limit);
  return metrics;
}

/**
 * The clusters publishing Container Insights in this region.
 *
 * `cluster_node_count` is the discovery metric: it carries `ClusterName` alone, so the answer is a list of
 * clusters rather than a list of clusters inferred from their pods.
 */
export function listKubeClusters(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<KubeCluster[]>> {
  return describeCall(
    target,
    'cloudwatch:ListMetrics',
    { namespace: CONTAINER_INSIGHTS, metric: 'cluster_node_count' },
    async () => {
      const names = new Set<string>();
      for (const metric of await listInsightMetrics(target, 'cluster_node_count', deps, MAX_NODES)) {
        const name = dimensionsOf(metric).get('ClusterName');
        if (name !== undefined && name.length > 0) names.add(name);
      }
      return [...names].sort((a, b) => a.localeCompare(b, 'en')).map((name) => ({ name }));
    },
    deps,
  );
}

export function listKubeNodes(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<KubeNode[]>> {
  return describeCall(
    target,
    'cloudwatch:ListMetrics',
    { namespace: CONTAINER_INSIGHTS, metric: 'node_cpu_utilization' },
    async () => {
      const nodes = new Map<string, KubeNode>();
      for (const metric of await listInsightMetrics(target, 'node_cpu_utilization', deps, MAX_NODES)) {
        const dimensions = dimensionsOf(metric);
        const cluster = dimensions.get('ClusterName');
        const name = dimensions.get('NodeName');
        // The cluster-wide aggregate of the same metric carries no NodeName; it is not a node.
        if (cluster === undefined || name === undefined || name.length === 0) continue;
        nodes.set(`${cluster}/${name}`, { cluster, name });
      }
      return [...nodes.values()].sort((a, b) => a.cluster.localeCompare(b.cluster, 'en') || a.name.localeCompare(b.name, 'en'));
    },
    deps,
  );
}

export function listKubePods(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<{ pods: KubePod[]; truncated: boolean }>> {
  return describeCall(
    target,
    'cloudwatch:ListMetrics',
    { namespace: CONTAINER_INSIGHTS, metric: 'pod_cpu_utilization' },
    async () => {
      const pods = new Map<string, KubePod>();
      for (const metric of await listInsightMetrics(target, 'pod_cpu_utilization', deps, MAX_PODS * 2)) {
        const dimensions = dimensionsOf(metric);
        const cluster = dimensions.get('ClusterName');
        const namespace = dimensions.get('Namespace');
        const name = dimensions.get('PodName');
        // Only the fully-qualified dimension set is a pod; the rollups by namespace and by cluster are not.
        if (cluster === undefined || namespace === undefined || name === undefined || name.length === 0) continue;
        const key = `${cluster}/${namespace}/${name}`;
        pods.set(key, { cluster, namespace, name, key });
      }
      const all = [...pods.values()].sort(
        (a, b) => a.cluster.localeCompare(b.cluster, 'en') || a.namespace.localeCompare(b.namespace, 'en') || a.name.localeCompare(b.name, 'en'),
      );
      return { pods: all.slice(0, MAX_PODS), truncated: all.length > MAX_PODS };
    },
    deps,
  );
}

export function listKubeWorkloads(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<KubeWorkload[]>> {
  return describeCall(
    target,
    'cloudwatch:ListMetrics',
    { namespace: CONTAINER_INSIGHTS, metric: 'service_number_of_running_pods' },
    async () => {
      const workloads = new Map<string, KubeWorkload>();
      for (const metric of await listInsightMetrics(target, 'service_number_of_running_pods', deps, MAX_PODS)) {
        const dimensions = dimensionsOf(metric);
        const cluster = dimensions.get('ClusterName');
        const namespace = dimensions.get('Namespace');
        const name = dimensions.get('Service');
        if (cluster === undefined || namespace === undefined || name === undefined || name.length === 0) continue;
        const key = `${cluster}/${namespace}/${name}`;
        workloads.set(key, { cluster, namespace, name, key });
      }
      return [...workloads.values()].sort(
        (a, b) => a.cluster.localeCompare(b.cluster, 'en') || a.namespace.localeCompare(b.namespace, 'en') || a.name.localeCompare(b.name, 'en'),
      );
    },
    deps,
  );
}

const insight = (id: string, metricName: string, dimensions: Record<string, string>, stat: MetricQuery['stat']): MetricQuery => ({
  id,
  namespace: CONTAINER_INSIGHTS,
  metricName,
  dimensions,
  stat,
});

export function clusterQueries(cluster: string, idPrefix: string): MetricQuery[] {
  const dimensions = { ClusterName: cluster };
  return [
    insight(`${idPrefix}nodes`, 'cluster_node_count', dimensions, 'Maximum'),
    // The worst moment in the window, not the average of it: a node that failed for two minutes failed.
    insight(`${idPrefix}failed`, 'cluster_failed_node_count', dimensions, 'Maximum'),
  ];
}

export function nodeQueries(node: KubeNode, idPrefix: string): MetricQuery[] {
  const dimensions = { ClusterName: node.cluster, NodeName: node.name };
  return [
    insight(`${idPrefix}cpu`, 'node_cpu_utilization', dimensions, 'Average'),
    insight(`${idPrefix}mem`, 'node_memory_utilization', dimensions, 'Average'),
    insight(`${idPrefix}pods`, 'node_number_of_running_pods', dimensions, 'Maximum'),
  ];
}

export function podQueries(pod: KubePod, idPrefix: string): MetricQuery[] {
  const dimensions = { ClusterName: pod.cluster, Namespace: pod.namespace, PodName: pod.name };
  return [
    insight(`${idPrefix}cpu`, 'pod_cpu_utilization', dimensions, 'Average'),
    insight(`${idPrefix}mem`, 'pod_memory_utilization', dimensions, 'Average'),
    insight(`${idPrefix}restarts`, 'pod_number_of_container_restarts', dimensions, 'Maximum'),
  ];
}

export function workloadQueries(workload: KubeWorkload, idPrefix: string): MetricQuery[] {
  const dimensions = { ClusterName: workload.cluster, Namespace: workload.namespace, Service: workload.name };
  return [insight(`${idPrefix}pods`, 'service_number_of_running_pods', dimensions, 'Maximum')];
}
