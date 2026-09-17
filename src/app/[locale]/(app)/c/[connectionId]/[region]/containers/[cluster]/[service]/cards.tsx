import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MetricChart, type ChartSeries } from '@/components/monitoring/metric-chart';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { TargetGroupPanel } from '@/components/monitoring/target-group-panel';
import { Link } from '@/i18n/navigation';
import type { AwsTarget, MonitoringScope } from '@/lib/monitoring/call';
import {
  describeService,
  listClusters,
  listServiceTasks,
  serviceTaskCountQueries,
  serviceUtilizationQueries,
  taskDefinitionLogs,
  type EcsService,
} from '@/lib/monitoring/ecs';
import { describeTargetGroups } from '@/lib/monitoring/elb';
import { getMetricSeries, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import type { MonitoringFailure } from '@/lib/monitoring/result';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { monitoringPath } from '@/lib/monitoring/shared/paths';
import { currentWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { RolloutBadge } from '../../cards';

type ServiceRef = { scope: MonitoringScope; cluster: string; service: string };
type Loaded = { ok: true; target: AwsTarget; service: EcsService } | { ok: false; card: ReactNode };

const chartSeries = (series: readonly MetricSeries[], id: string, label: string): ChartSeries => ({ id, label, ...seriesById(series, id) });

/**
 * Resolves credentials and the service inside the card (both cached), or returns the card to render instead:
 * a failure notice, or the not-found message when the service does not exist.
 */
async function loadService({ scope, cluster, service }: ServiceRef, title: string): Promise<Loaded> {
  const t = await getTranslations('Monitoring.containers');
  const failed = (failure: MonitoringFailure): Loaded => ({
    ok: false,
    card: (
      <MonitoringCard title={title}>
        <FailureNotice failure={failure} connectionId={scope.connectionId} />
      </MonitoringCard>
    ),
  });
  const target = await resolveTarget(scope);
  if (!target.ok) return failed(target);
  const described = await describeService(target.data, cluster, service);
  if (!described.ok) return failed(described);
  if (!described.data) {
    return {
      ok: false,
      card: (
        <MonitoringCard title={title}>
          <p className="text-sm text-muted-foreground">{t('summary.notFound')}</p>
        </MonitoringCard>
      ),
    };
  }
  return { ok: true, target: target.data, service: described.data };
}

export async function ServiceSummaryCard(ref: ServiceRef) {
  const t = await getTranslations('Monitoring.containers');
  const loaded = await loadService(ref, t('summary.title'));
  if (!loaded.ok) return loaded.card;
  const format = await getFormatter();
  const { service } = loaded;
  const deployment = service.primaryDeployment;
  const item = (label: string, value: ReactNode) => (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
  return (
    <MonitoringCard title={t('summary.title')}>
      <dl className="grid gap-3 sm:grid-cols-3">
        {item(t('summary.status'), service.status)}
        {item(t('summary.taskDefinition'), <span className="font-mono text-xs">{service.taskDefinition}</span>)}
        {item(t('summary.launchType'), service.launchType ?? NO_VALUE)}
        {item(t('summary.desired'), service.desiredCount)}
        {item(t('summary.running'), service.runningCount)}
        {item(t('summary.pending'), service.pendingCount)}
        {item(
          t('summary.deployment'),
          deployment ? (
            <span className="flex flex-col items-start gap-1">
              <RolloutBadge state={deployment.rolloutState} />
              {deployment.rolloutStateReason && <span className="font-normal">{deployment.rolloutStateReason}</span>}
              {deployment.createdAt != null && (
                <span className="font-normal text-muted-foreground">{t('summary.deploymentStarted', { time: format.relativeTime(deployment.createdAt) })}</span>
              )}
            </span>
          ) : (
            NO_VALUE
          ),
        )}
      </dl>
    </MonitoringCard>
  );
}

export async function ServiceChartsCard({ range, ...ref }: ServiceRef & { range: TimeRange }) {
  const t = await getTranslations('Monitoring.containers');
  const tMetrics = await getTranslations('Monitoring.metrics');
  const target = await resolveTarget(ref.scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={t('charts.title')}>
        <FailureNotice failure={target} connectionId={ref.scope.connectionId} />
      </MonitoringCard>
    );
  }
  // Task counts come from Container Insights; without it the queries would only return empty series.
  const clusters = await listClusters(target.data);
  const containerInsights = clusters.ok && clusters.data.some((c) => c.name === ref.cluster && c.containerInsights);
  const queries = [
    ...serviceUtilizationQueries(ref.cluster, ref.service, 'u'),
    ...(containerInsights ? serviceTaskCountQueries(ref.cluster, ref.service, 'u') : []),
  ];
  const metrics = await getMetricSeries(target.data, queries, currentWindow(range));
  if (!metrics.ok) {
    return (
      <MonitoringCard title={t('charts.title')}>
        <FailureNotice failure={metrics} connectionId={ref.scope.connectionId} />
      </MonitoringCard>
    );
  }
  return (
    <MonitoringCard title={t('charts.title')}>
      <div className="grid gap-6 md:grid-cols-2">
        <MetricChart title={tMetrics('cpu')} unit="percent" range={range} series={[chartSeries(metrics.data, 'ucpu', tMetrics('cpu'))]} />
        <MetricChart title={tMetrics('memory')} unit="percent" range={range} series={[chartSeries(metrics.data, 'umem', tMetrics('memory'))]} />
        {containerInsights && (
          <MetricChart
            title={tMetrics('tasks')}
            unit="count"
            range={range}
            series={[chartSeries(metrics.data, 'urunning', tMetrics('runningTasks')), chartSeries(metrics.data, 'udesired', tMetrics('desiredTasks'))]}
          />
        )}
      </div>
    </MonitoringCard>
  );
}

export async function TargetGroupsCard({ range, ...ref }: ServiceRef & { range: TimeRange }) {
  const t = await getTranslations('Monitoring.containers');
  const title = t('targetGroups.title');
  const loaded = await loadService(ref, title);
  if (!loaded.ok) return loaded.card;
  if (loaded.service.loadBalancers.length === 0) {
    return (
      <MonitoringCard title={title}>
        <p className="text-sm text-muted-foreground">{t('targetGroups.empty')}</p>
      </MonitoringCard>
    );
  }
  const groups = await describeTargetGroups(loaded.target, [...new Set(loaded.service.loadBalancers.map((l) => l.targetGroupArn))]);
  return (
    <MonitoringCard title={title}>
      {!groups.ok ? (
        <FailureNotice failure={groups} connectionId={ref.scope.connectionId} />
      ) : groups.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('targetGroups.empty')}</p>
      ) : (
        <div className="space-y-8">
          {groups.data.map((group) => (
            <TargetGroupPanel key={group.arn} scope={ref.scope} group={group} range={range} />
          ))}
        </div>
      )}
    </MonitoringCard>
  );
}

export async function TasksCard(ref: ServiceRef) {
  const t = await getTranslations('Monitoring.containers');
  const title = t('tasks.title');
  const target = await resolveTarget(ref.scope);
  const tasks = target.ok ? await listServiceTasks(target.data, ref.cluster, ref.service) : target;
  if (!tasks.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={tasks} connectionId={ref.scope.connectionId} />
      </MonitoringCard>
    );
  }
  const format = await getFormatter();
  return (
    <MonitoringCard title={title}>
      {tasks.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('tasks.columns.task')}</TableHead>
              <TableHead>{t('tasks.columns.revision')}</TableHead>
              <TableHead>{t('tasks.columns.lastStatus')}</TableHead>
              <TableHead>{t('tasks.columns.health')}</TableHead>
              <TableHead>{t('tasks.columns.started')}</TableHead>
              <TableHead>{t('tasks.columns.zone')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.data.map((task) => (
              <TableRow key={task.arn}>
                <TableCell className="font-mono text-xs">{task.id}</TableCell>
                <TableCell className="font-mono text-xs">{task.taskDefinition}</TableCell>
                <TableCell>{task.lastStatus}</TableCell>
                <TableCell>{task.healthStatus ?? NO_VALUE}</TableCell>
                <TableCell>{task.startedAt != null ? format.relativeTime(task.startedAt) : NO_VALUE}</TableCell>
                <TableCell>{task.availabilityZone ?? NO_VALUE}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </MonitoringCard>
  );
}

export async function EventsCard(ref: ServiceRef) {
  const t = await getTranslations('Monitoring.containers');
  const title = t('events.title');
  const loaded = await loadService(ref, title);
  if (!loaded.ok) return loaded.card;
  const format = await getFormatter();
  const { events } = loaded.service;
  return (
    <MonitoringCard title={title}>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('events.empty')}</p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:gap-3">
              <span className="shrink-0 text-muted-foreground sm:w-32">{event.createdAt != null ? format.relativeTime(event.createdAt) : NO_VALUE}</span>
              <span className="break-words">{event.message}</span>
            </li>
          ))}
        </ol>
      )}
    </MonitoringCard>
  );
}

export async function LogsCard(ref: ServiceRef) {
  const t = await getTranslations('Monitoring.containers');
  const title = t('logs.title');
  const loaded = await loadService(ref, title);
  if (!loaded.ok) return loaded.card;
  const logs = await taskDefinitionLogs(loaded.target, loaded.service.taskDefinitionArn);
  return (
    <MonitoringCard title={title}>
      {!logs.ok ? (
        <FailureNotice failure={logs} connectionId={ref.scope.connectionId} />
      ) : logs.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('logs.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {logs.data.map((log) => (
            <li key={`${log.container}|${log.logGroup}`} className="font-mono text-xs break-all">
              {log.region && log.region !== ref.scope.region ? (
                t('logs.otherRegion', { group: log.logGroup, region: log.region })
              ) : (
                // Only a group of this region can be queried through this page's Logs Insights routes.
                <Link
                  href={`${monitoringPath(ref.scope, 'logs')}?group=${encodeURIComponent(log.logGroup)}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {log.logGroup}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </MonitoringCard>
  );
}
