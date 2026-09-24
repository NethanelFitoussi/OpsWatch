import 'server-only';
import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MetricQuery } from './metrics';
import type { MonitoringResult } from './result';

/**
 * ElastiCache, discovered through CloudWatch rather than through ElastiCache.
 *
 * `elasticache:DescribeCacheClusters` is **not** in the role's policy, and adding it would make every
 * already-deployed stack out of date. `cloudwatch:ListMetrics` is granted, and every ElastiCache node
 * publishes its own dimensions — so the nodes OpsWatch can measure are exactly the nodes it can find,
 * which is a neater coincidence than it sounds: a node publishing no metrics is a node this page could
 * say nothing about anyway.
 *
 * What that costs, stated on the page rather than hidden: no engine version, no node type, no endpoint,
 * no replication topology, and no way to tell an idle cluster from one that does not exist. Those need
 * the ElastiCache API, and the page says so instead of guessing.
 */

const MAX_NODES = 100;

/** One ElastiCache node, as CloudWatch knows it. */
export type RedisNode = {
  /** `CacheClusterId` — for a replication group, one per node. */
  clusterId: string;
  /** `CacheNodeId`, where the node publishes it. Single-node clusters often report `0001`. */
  nodeId: string | null;
  /** The id a page shows and a query keys on. */
  key: string;
};

/**
 * Every ElastiCache node publishing metrics in this region.
 *
 * `EngineCPUUtilization` is the discovery metric, because **only Redis publishes it**. That makes the
 * section genuinely Redis rather than "ElastiCache, including Memcached nodes whose Redis checks all come
 * back unknown". The cost is a very old engine version that does not publish it, which would be missed —
 * said on the page rather than left as a silent gap.
 *
 * A node that publishes nothing at all is invisible here, and the page says that plainly: OpsWatch lists
 * what it can measure, not what exists.
 */
export async function listRedisNodes(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<RedisNode[]>> {
  return describeCall(
    target,
    'cloudwatch:ListMetrics',
    { namespace: 'AWS/ElastiCache' },
    async () => {
      const client = new CloudWatchClient(clientConfig(target.region, target.credentials));
      const nodes = new Map<string, RedisNode>();
      let token: string | undefined;
      do {
        const out = await sendWithTimeout(
          client,
          new ListMetricsCommand({ Namespace: 'AWS/ElastiCache', MetricName: 'EngineCPUUtilization', NextToken: token }),
          describeTimeout(deps),
        );
        for (const metric of out.Metrics ?? []) {
          const dimensions = new Map((metric.Dimensions ?? []).map((d) => [d.Name ?? '', d.Value ?? '']));
          const clusterId = dimensions.get('CacheClusterId');
          if (clusterId === undefined || clusterId.length === 0) continue;
          const nodeId = dimensions.get('CacheNodeId') ?? null;
          const key = nodeId === null ? clusterId : `${clusterId}/${nodeId}`;
          // One entry per node: CloudWatch publishes the cluster-only dimension set as well, and counting
          // both would double every cluster.
          if (!nodes.has(key)) nodes.set(key, { clusterId, nodeId, key });
        }
        token = out.NextToken;
      } while (token !== undefined && nodes.size < MAX_NODES);

      return [...nodes.values()]
        .filter((node) => node.nodeId !== null || ![...nodes.values()].some((other) => other.clusterId === node.clusterId && other.nodeId !== null))
        .sort((a, b) => a.key.localeCompare(b.key, 'en'))
        .slice(0, MAX_NODES);
    },
    deps,
  );
}

/**
 * What OpsWatch reads about one node.
 *
 * `EngineCPUUtilization` is the one that matters on a multi-core node and the one operators miss: Redis
 * runs its commands on a single thread, so a four-core node at 25 % CPU can have a completely saturated
 * engine. Both are read, and the page explains the difference rather than showing two numbers that look
 * like a contradiction.
 */
export function redisQueries(node: RedisNode, idPrefix: string): MetricQuery[] {
  const dimensions: Record<string, string> =
    node.nodeId === null ? { CacheClusterId: node.clusterId } : { CacheClusterId: node.clusterId, CacheNodeId: node.nodeId };
  const metric = (id: string, metricName: string, stat: MetricQuery['stat']): MetricQuery => ({
    id: `${idPrefix}${id}`,
    namespace: 'AWS/ElastiCache',
    metricName,
    dimensions,
    stat,
  });
  return [
    metric('cpu', 'CPUUtilization', 'Average'),
    metric('engine', 'EngineCPUUtilization', 'Average'),
    metric('memory', 'DatabaseMemoryUsagePercentage', 'Average'),
    metric('conns', 'CurrConnections', 'Maximum'),
    metric('evict', 'Evictions', 'Sum'),
    metric('hits', 'CacheHits', 'Sum'),
    metric('misses', 'CacheMisses', 'Sum'),
  ];
}
