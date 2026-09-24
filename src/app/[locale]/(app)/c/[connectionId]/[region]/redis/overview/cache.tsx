import { getTranslations } from 'next-intl/server';
import { HealthySummary } from '@/components/infra/healthy-summary';
import { MetricCell } from '@/components/infra/metric-cell';
import { ResourceMap, type MapGroup, type MapTile } from '@/components/infra/resource-map';
import { StatusBar } from '@/components/infra/status-bar';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { REDIS_ENGINE_CPU_LEVELS } from '@/lib/monitoring/insights';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { listRedisNodes, redisQueries, type RedisNode } from '@/lib/monitoring/redis';
import { evaluateRedisNode } from '@/lib/monitoring/redis-health';
import { evaluate, rollUp, type Evaluation } from '@/lib/monitoring/shared/evaluated-health';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * Redis, grouped by cluster.
 *
 * The verdict rests on engine CPU and memory, which are AWS's own thresholds; evictions warn. Hit rate and
 * connections are shown on the nodes page and judged nowhere, because neither has a ceiling OpsWatch can
 * read and a verdict without a basis is worse than no verdict.
 */

type Judged = { node: RedisNode; evaluation: Evaluation; engineCpu: number | null };

const sum = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((total, value) => total + value, 0));

export async function RedisCache({ scope, range, nowMs }: { scope: MonitoringScope; range: TimeRange; nowMs: number }) {
  const t = await getTranslations('Monitoring.redis');
  const estate = await getTranslations('Monitoring.estate');

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={t('title')}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  const listed = await listRedisNodes(target.data);
  if (!listed.ok) {
    return (
      <MonitoringCard title={t('title')}>
        <FailureNotice failure={listed} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  if (listed.data.length === 0) {
    return (
      <MonitoringCard title={t('title')} description={t('noneDescription')}>
        <p className="text-sm">{t('none')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
      </MonitoringCard>
    );
  }

  const nodes = listed.data;
  const queries = nodes.flatMap((node, i) => redisQueries(node, `r${i}`));
  const metrics = await getMetricSeries(target.data, queries, timeWindow(range, nowMs));
  const series: MetricSeries[] = metrics.ok ? metrics.data : [];
  const metricsUnavailable = !metrics.ok;

  const judged: Judged[] = nodes.map((node, i) => {
    const engineCpu = latestValue(seriesById(series, `r${i}engine`));
    return {
      node,
      engineCpu,
      evaluation: evaluateRedisNode(
        {
          engineCpu,
          memoryPercent: latestValue(seriesById(series, `r${i}memory`)),
          evictions: sum(seriesById(series, `r${i}evict`).values),
          metricsUnavailable,
        },
        nowMs,
      ),
    };
  });

  const group = rollUp(judged.map((entry) => entry.evaluation.state));
  const clusters = [...new Set(nodes.map((node) => node.clusterId))].sort();

  const groups: MapGroup[] = clusters.map((cluster) => ({
    key: cluster,
    label: cluster,
    tiles: judged
      .filter((entry) => entry.node.clusterId === cluster)
      .map(
        (entry): MapTile => ({
          id: entry.node.key,
          label: entry.node.nodeId === null ? entry.node.clusterId : entry.node.nodeId,
          state: entry.evaluation.state,
          detail: entry.engineCpu === null ? t('noEngineCpu') : t('tileDetail', { value: Math.round(entry.engineCpu) }),
          href: `${subsectionPath(scope, 'redis', 'nodes')}?range=${range}&q=${encodeURIComponent(entry.node.clusterId)}`,
        }),
      ),
  }));

  const summary = evaluate({
    checks: clusters.map((cluster) => {
      const health = rollUp(judged.filter((entry) => entry.node.clusterId === cluster).map((entry) => entry.evaluation.state));
      return {
        id: health.state === 'critical' ? 'redis.cluster.critical' : health.state === 'warning' ? 'redis.cluster.warn' : health.state === 'unknown' ? 'redis.cluster.partial' : 'redis.cluster.pass',
        outcome:
          health.state === 'critical'
            ? ('fail' as const)
            : health.state === 'warning'
              ? ('warn' as const)
              : health.state === 'unknown'
                ? ('unknown' as const)
                : ('pass' as const),
        values: { cluster, healthy: health.counts.healthy, total: health.total },
      };
    }),
    unread: judged.some((entry) => entry.evaluation.unread.length > 0) ? ['redis.engineCpu'] : [],
    evaluatedAt: nowMs,
    nowMs,
  });

  const hottest = [...judged].filter((entry) => entry.engineCpu !== null).sort((a, b) => (b.engineCpu ?? 0) - (a.engineCpu ?? 0)).slice(0, 5);

  return (
    <div className="space-y-6">
      <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <p className={cn('text-2xl font-semibold', STATE_TEXT[group.state])}>{estate(`verdict.${group.state}`)}</p>
            <StatusBar group={group} />
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('clusters')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{clusters.length}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('nodes')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{nodes.length}</dd>
              </div>
            </dl>
          </div>
          <HealthySummary evaluation={summary} nowMs={nowMs} showVerdict={false} />
        </div>
      </MonitoringCard>

      {/* What this way of finding Redis cannot see. Said once, where it matters, rather than in a manual. */}
      <MonitoringCard title={t('limitsTitle')}>
        <p className="text-sm text-muted-foreground">{t('limits')}</p>
      </MonitoringCard>

      <MonitoringCard title={t('mapTitle')} description={t('mapDescription')}>
        <ResourceMap groups={groups} groupedByLabel={estate('groupedBy', { dimension: t('byCluster') })} />
      </MonitoringCard>

      {hottest.length > 0 && (
        <MonitoringCard title={t('hottestTitle')} description={t('hottestDescription')}>
          <ul className="space-y-2">
            {hottest.map((entry) => (
              <li key={entry.node.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <Link
                  href={`${subsectionPath(scope, 'redis', 'nodes')}?range=${range}&q=${encodeURIComponent(entry.node.clusterId)}`}
                  className="min-w-0 truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {entry.node.key}
                </Link>
                <MetricCell
                  value={entry.engineCpu === null ? null : Math.round(entry.engineCpu)}
                  max={100}
                  warnAt={REDIS_ENGINE_CPU_LEVELS.warning.threshold}
                  failAt={REDIS_ENGINE_CPU_LEVELS.critical?.threshold}
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
