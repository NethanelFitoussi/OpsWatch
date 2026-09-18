import { getLocale, getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Sparkline } from '@/components/monitoring/sparkline';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { MAX_SERVICES, listClusters, listServices, serviceUtilizationQueries, type EcsCluster } from '@/lib/monitoring/ecs';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import type { MonitoringFailure } from '@/lib/monitoring/result';
import { formatMetricValue, NO_VALUE } from '@/lib/monitoring/shared/format';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { TONE_SOFT } from '@/lib/ui/tones';

const ROLLOUT_BADGE_CLASS = {
  COMPLETED: TONE_SOFT.success,
  IN_PROGRESS: TONE_SOFT.info,
  FAILED: TONE_SOFT.danger,
} as const;

const isKnownRollout = (state: string | null): state is keyof typeof ROLLOUT_BADGE_CLASS => state != null && Object.hasOwn(ROLLOUT_BADGE_CLASS, state);

/** The rollout state of a deployment; `—` when ECS reports none (services without the rolling deployment controller). */
export async function RolloutBadge({ state }: { state: string | null }) {
  const t = await getTranslations('Monitoring.containers');
  if (!isKnownRollout(state)) return <span className="text-muted-foreground">{NO_VALUE}</span>;
  return <Badge className={ROLLOUT_BADGE_CLASS[state]}>{t(`rollout.${state}`)}</Badge>;
}

export async function ClusterSections({ scope, range, nowMs, search }: { scope: MonitoringScope; range: TimeRange; nowMs: number; search: string }) {
  const t = await getTranslations('Monitoring.containers');
  const target = await resolveTarget(scope);
  const clusters = target.ok ? await listClusters(target.data) : target;
  if (!clusters.ok) {
    return (
      <MonitoringCard title={t('clustersTitle')}>
        <FailureNotice failure={clusters} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  if (clusters.data.length === 0) {
    return (
      <MonitoringCard title={t('clustersTitle')}>
        <p className="text-sm text-muted-foreground">{t('noClusters')}</p>
      </MonitoringCard>
    );
  }
  return (
    <div className="space-y-6">
      {clusters.data.map((cluster) => (
        <SuspenseCard key={cluster.arn} title={cluster.name} variant="table">
          <ServicesCard scope={scope} cluster={cluster} range={range} nowMs={nowMs} search={search} />
        </SuspenseCard>
      ))}
    </div>
  );
}

async function ServicesCard({ scope, cluster, range, nowMs, search }: { scope: MonitoringScope; cluster: EcsCluster; range: TimeRange; nowMs: number; search: string }) {
  const t = await getTranslations('Monitoring.containers');
  const tMetrics = await getTranslations('Monitoring.metrics');
  const tCommon = await getTranslations('Monitoring.common');
  const locale = await getLocale();
  const actions = cluster.containerInsights ? <Badge variant="outline">{t('containerInsights')}</Badge> : undefined;

  const failureCard = (failure: MonitoringFailure) => (
    <MonitoringCard title={cluster.name} actions={actions}>
      <FailureNotice failure={failure} connectionId={scope.connectionId} />
    </MonitoringCard>
  );
  const target = await resolveTarget(scope);
  if (!target.ok) return failureCard(target);
  const listed = await listServices(target.data, cluster.name, search);
  if (!listed.ok) return failureCard(listed);

  const { services, matched, truncated } = listed.data;
  const queries = services.flatMap((s, i) => serviceUtilizationQueries(cluster.name, s.name, `s${i}`));
  const metrics = queries.length > 0 ? await getMetricSeries(target.data, queries, timeWindow(range, nowMs)) : null;
  const series: MetricSeries[] = metrics?.ok ? metrics.data : [];

  const utilization = (id: string, metric: string) => {
    const data = seriesById(series, id);
    const value = formatMetricValue(latestValue(data), 'percent', locale);
    return (
      <div className="flex items-center gap-3">
        <span className="w-14 tabular-nums">{value}</span>
        <Sparkline values={data.values} max={100} label={tCommon('sparkline', { metric, value })} />
      </div>
    );
  };

  return (
    <MonitoringCard title={cluster.name} actions={actions}>
      {metrics && !metrics.ok && (
        <div className="mb-3">
          <FailureNotice failure={metrics} connectionId={scope.connectionId} />
        </div>
      )}
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noServices')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.service')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.tasks')}</TableHead>
              <TableHead>{t('columns.cpu')}</TableHead>
              <TableHead>{t('columns.memory')}</TableHead>
              <TableHead>{t('columns.deployment')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((s, i) => (
              <TableRow key={s.arn || s.name}>
                <TableCell>
                  <Link
                    href={`${subsectionPath(scope, 'containers', 'services', cluster.name, s.name)}?range=${range}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {s.name}
                  </Link>
                </TableCell>
                <TableCell>{s.status}</TableCell>
                <TableCell>{t('taskCounts', { running: s.runningCount, desired: s.desiredCount, pending: s.pendingCount })}</TableCell>
                <TableCell>{utilization(`s${i}cpu`, tMetrics('cpu'))}</TableCell>
                <TableCell>{utilization(`s${i}mem`, tMetrics('memory'))}</TableCell>
                <TableCell>
                  <RolloutBadge state={s.primaryDeployment?.rolloutState ?? null} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {truncated && <p className="mt-3 text-sm text-muted-foreground">{t('truncated', { shown: MAX_SERVICES, matched })}</p>}
    </MonitoringCard>
  );
}
