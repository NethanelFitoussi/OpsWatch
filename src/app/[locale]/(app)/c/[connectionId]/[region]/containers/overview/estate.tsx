import { getTranslations } from 'next-intl/server';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { HealthySummary } from '@/components/infra/healthy-summary';
import { MetricCell } from '@/components/infra/metric-cell';
import { ResourceMap, type MapGroup, type MapTile } from '@/components/infra/resource-map';
import { StatusBar } from '@/components/infra/status-bar';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { listClusters, listServices, serviceUtilizationQueries, type EcsService } from '@/lib/monitoring/ecs';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import type { MonitoringFailure } from '@/lib/monitoring/result';
import { evaluateEcsService } from '@/lib/monitoring/ecs-health';
import { evaluate, rollUp, type Evaluation } from '@/lib/monitoring/shared/evaluated-health';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * ECS, as an estate rather than a list.
 *
 * The question this page answers is "is everything OK" — and it has to be able to answer *yes*. A healthy
 * ECS estate used to render as a table with nothing red in it, which is not an answer, it is the absence
 * of one. Here the answer is a verdict, a bar of counts, and a map where every service is a tile and the
 * mass of green is the point.
 *
 * Every colour on it is earned: each service is evaluated against the detector's own thresholds, and a
 * service whose metrics could not be read is an outline rather than a green square. The map and the
 * summary are the same evaluation rendered twice, so they cannot disagree.
 */

/** One service, with everything the page needs to colour it and to rank it. */
type Judged = { service: EcsService; cluster: string; evaluation: Evaluation; cpu: number | null; memory: number | null };

/** A cluster OpsWatch could not list is a gap, not an empty cluster: the caller says so rather than drawing nothing. */
type ClusterJudgement = { judged: Judged[]; failure: MonitoringFailure | null };

async function judgeCluster(scope: MonitoringScope, cluster: string, range: TimeRange, nowMs: number): Promise<ClusterJudgement> {
  const target = await resolveTarget(scope);
  if (!target.ok) return { judged: [], failure: target };
  const listed = await listServices(target.data, cluster, '');
  if (!listed.ok) return { judged: [], failure: listed };

  const services = listed.data.services;
  const queries = services.flatMap((service, i) => serviceUtilizationQueries(cluster, service.name, `s${i}`));
  const metrics = queries.length > 0 ? await getMetricSeries(target.data, queries, timeWindow(range, nowMs)) : null;
  const series: MetricSeries[] = metrics?.ok ? metrics.data : [];
  // A failed metrics call is a gap OpsWatch admits; it is not a reason to call anything unhealthy.
  const metricsUnavailable = metrics !== null && !metrics.ok;

  const judged = services.map((service, i) => {
    const cpu = latestValue(seriesById(series, `s${i}cpu`));
    const memory = latestValue(seriesById(series, `s${i}mem`));
    return {
      service,
      cluster,
      cpu,
      memory,
      evaluation: evaluateEcsService(
        {
          desiredCount: service.desiredCount,
          runningCount: service.runningCount,
          pendingCount: service.pendingCount,
          rolloutState: service.primaryDeployment?.rolloutState ?? null,
        },
        { cpu, memory, metricsUnavailable },
        nowMs,
      ),
    };
  });
  return { judged, failure: null };
}

export async function EcsEstate({ scope, range, nowMs }: { scope: MonitoringScope; range: TimeRange; nowMs: number }) {
  const t = await getTranslations('Monitoring.ecsOverview');
  const health = await getTranslations('Monitoring.estate');

  const target = await resolveTarget(scope);
  const clusters = target.ok ? await listClusters(target.data) : target;
  if (!clusters.ok) {
    return (
      <MonitoringCard title={t('title')}>
        <FailureNotice failure={clusters} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  if (clusters.data.length === 0) {
    return (
      <MonitoringCard title={t('title')}>
        <p className="text-sm text-muted-foreground">{t('noClusters')}</p>
      </MonitoringCard>
    );
  }

  const perCluster = await Promise.all(clusters.data.map((cluster) => judgeCluster(scope, cluster.name, range, nowMs)));
  const judged = perCluster.flatMap((entry) => entry.judged);
  // A cluster that could not be listed is named, once, rather than quietly contributing nothing to a
  // verdict that would then read as if it had covered the whole estate.
  const unreadable = perCluster.flatMap((entry, index) => (entry.failure === null ? [] : [{ cluster: clusters.data[index].name, failure: entry.failure }]));
  const estate = rollUp(judged.map((entry) => entry.evaluation.state));

  const desired = judged.reduce((sum, entry) => sum + entry.service.desiredCount, 0);
  const running = judged.reduce((sum, entry) => sum + entry.service.runningCount, 0);

  const groups: MapGroup[] = clusters.data.map((cluster, index) => ({
    key: cluster.arn || cluster.name,
    label: cluster.name,
    tiles: perCluster[index].judged.map(
      (entry): MapTile => ({
        id: entry.service.arn || `${cluster.name}/${entry.service.name}`,
        label: entry.service.name,
        state: entry.evaluation.state,
        detail: t('tileDetail', { running: entry.service.runningCount, desired: entry.service.desiredCount }),
        href: `${subsectionPath(scope, 'containers', 'services', cluster.name, entry.service.name)}?range=${range}`,
      }),
    ),
  }));

  // The estate's own evaluation: one line per cluster, so a green headline can be answered for.
  const estateEvaluation = evaluate({
    checks: perCluster.flatMap((entry, index) => {
      const group = rollUp(entry.judged.map((judgedEntry) => judgedEntry.evaluation.state));
      if (group.total === 0) return [];
      return [
        {
          id: group.state === 'healthy' ? 'ecs.cluster.pass' : group.state === 'unknown' ? 'ecs.cluster.partial' : `ecs.cluster.${group.state}`,
          outcome: group.state === 'critical' ? ('fail' as const) : group.state === 'warning' ? ('warn' as const) : ('pass' as const),
          values: { cluster: clusters.data[index].name, healthy: group.counts.healthy, total: group.total },
        },
      ];
    }),
    unread: judged.some((entry) => entry.evaluation.unread.length > 0) ? ['ecs.cpu'] : [],
    evaluatedAt: nowMs,
    nowMs,
  });

  // Who is hottest, beside the shape of it: the answer to "who" is a click away from "look at that one".
  const hottest = [...judged]
    .filter((entry) => entry.cpu !== null)
    .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* No title on this card: the page header above already names the page, and the verdict is the
          heading that matters. Saying "ECS overview" three times was three times too many. */}
      <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <p className={cn('text-2xl font-semibold', STATE_TEXT[estate.state])}>{health(`verdict.${estate.state}`)}</p>
            <StatusBar group={estate} />
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('tasksRunning')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{t('ofDesired', { running, desired })}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('services')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{estate.total}</dd>
              </div>
            </dl>
          </div>
          {/* The verdict is already the headline beside it; repeating it here was the page agreeing
              with itself out loud. */}
          <HealthySummary evaluation={estateEvaluation} nowMs={nowMs} showVerdict={false} />
        </div>
      </MonitoringCard>

      {unreadable.length > 0 && (
        <MonitoringCard title={t('unreadableTitle')}>
          <div className="space-y-3">
            {unreadable.map((entry) => (
              <div key={entry.cluster}>
                <p className="text-sm font-medium">{entry.cluster}</p>
                <FailureNotice failure={entry.failure} connectionId={scope.connectionId} />
              </div>
            ))}
          </div>
        </MonitoringCard>
      )}

      <MonitoringCard title={t('mapTitle')} description={t('mapDescription')}>
        <ResourceMap groups={groups} groupedByLabel={health('groupedBy', { dimension: t('byCluster') })} />
      </MonitoringCard>

      {hottest.length > 0 && (
        <MonitoringCard title={t('hottestTitle')} description={t('hottestDescription')}>
          <ul className="space-y-2">
            {hottest.map((entry) => (
              <li key={entry.service.arn || entry.service.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <Link
                  href={`${subsectionPath(scope, 'containers', 'services', entry.cluster, entry.service.name)}?range=${range}`}
                  className="min-w-0 truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {entry.service.name}
                </Link>
                <MetricCell value={entry.cpu === null ? null : Math.round(entry.cpu)} max={100} suffix="%" missing={NO_VALUE} />
              </li>
            ))}
          </ul>
        </MonitoringCard>
      )}
    </div>
  );
}
