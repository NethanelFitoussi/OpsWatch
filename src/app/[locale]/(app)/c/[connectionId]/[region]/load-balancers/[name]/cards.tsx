import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MetricChart, type ChartSeries } from '@/components/monitoring/metric-chart';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { TargetGroupPanel } from '@/components/monitoring/target-group-panel';
import type { AwsTarget, MonitoringScope } from '@/lib/monitoring/call';
import { findLoadBalancer, listTargetGroups, loadBalancerLatencyQuery, loadBalancerQueries, type LoadBalancer } from '@/lib/monitoring/elb';
import { getMetricSeries, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import type { MonitoringFailure } from '@/lib/monitoring/result';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { currentWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';

type Ref = { scope: MonitoringScope; name: string };
type Loaded = { ok: true; target: AwsTarget; lb: LoadBalancer } | { ok: false; card: ReactNode };

const chartSeries = (series: readonly MetricSeries[], id: string, label: string): ChartSeries => ({ id, label, ...seriesById(series, id) });

/** Resolves credentials and the load balancer inside the card (both cached), or returns the card to render instead. */
async function loadLoadBalancer({ scope, name }: Ref, title: string): Promise<Loaded> {
  const t = await getTranslations('Monitoring.loadBalancers');
  const message = (body: ReactNode): Loaded => ({ ok: false, card: <MonitoringCard title={title}>{body}</MonitoringCard> });
  const failed = (failure: MonitoringFailure) => message(<FailureNotice failure={failure} connectionId={scope.connectionId} />);
  const target = await resolveTarget(scope);
  if (!target.ok) return failed(target);
  const found = await findLoadBalancer(target.data, name);
  if (!found.ok) return failed(found);
  if (!found.data) return message(<p className="text-sm text-muted-foreground">{t('notFound')}</p>);
  return { ok: true, target: target.data, lb: found.data };
}

export async function LoadBalancerSummaryCard(ref: Ref) {
  const t = await getTranslations('Monitoring.loadBalancers');
  const title = t('summary.title');
  const loaded = await loadLoadBalancer(ref, title);
  if (!loaded.ok) return loaded.card;
  const format = await getFormatter();
  const { lb } = loaded;
  const item = (label: string, value: ReactNode) => (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
  return (
    <MonitoringCard title={title}>
      <div className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          {item(t('summary.dnsName'), <span className="font-mono text-xs break-all">{lb.dnsName ?? NO_VALUE}</span>)}
          {item(t('summary.scheme'), lb.scheme ?? NO_VALUE)}
          {item(t('summary.state'), lb.state ?? NO_VALUE)}
          {item(t('summary.vpc'), lb.vpcId ?? NO_VALUE)}
        </dl>
        {lb.createdAt != null && <p className="text-sm text-muted-foreground">{t('summary.created', { time: format.relativeTime(lb.createdAt) })}</p>}
      </div>
    </MonitoringCard>
  );
}

export async function LoadBalancerChartsCard({ range, ...ref }: Ref & { range: TimeRange }) {
  const t = await getTranslations('Monitoring.loadBalancers');
  const tMetrics = await getTranslations('Monitoring.metrics');
  const title = t('charts.title');
  const loaded = await loadLoadBalancer(ref, title);
  if (!loaded.ok) return loaded.card;
  const { target, lb } = loaded;
  const window = currentWindow(range);
  const [main, p95] = await Promise.all([
    getMetricSeries(target, loadBalancerQueries(lb, 'l0'), window),
    // Percentile queries always go in their own request (moto fact 2).
    getMetricSeries(target, [loadBalancerLatencyQuery(lb, 'l0')], window),
  ]);
  if (!main.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={main} connectionId={ref.scope.connectionId} />
      </MonitoringCard>
    );
  }
  return (
    <MonitoringCard title={title}>
      <div className="grid gap-6 md:grid-cols-2">
        <MetricChart title={tMetrics('requests')} unit="count" range={range} series={[chartSeries(main.data, 'l0req', tMetrics('requests'))]} />
        <MetricChart
          title={tMetrics('errors5xx')}
          unit="count"
          range={range}
          series={[chartSeries(main.data, 'l0elb5xx', tMetrics('elb5xx')), chartSeries(main.data, 'l0t5xx', tMetrics('target5xx'))]}
        />
        {p95.ok ? (
          <MetricChart title={tMetrics('responseTimeP95')} unit="seconds" range={range} series={[chartSeries(p95.data, 'l0p95', tMetrics('responseTimeP95'))]} />
        ) : (
          <figure aria-labelledby="load-balancer-p95" className="min-w-0 space-y-2">
            <figcaption id="load-balancer-p95" className="text-sm font-medium">
              {tMetrics('responseTimeP95')}
            </figcaption>
            <p role="status" className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              {tMetrics('p95Unavailable')}
            </p>
          </figure>
        )}
      </div>
    </MonitoringCard>
  );
}

export async function TargetGroupsSection({ range, ...ref }: Ref & { range: TimeRange }) {
  const t = await getTranslations('Monitoring.loadBalancers');
  const title = t('targetGroups.title');
  const loaded = await loadLoadBalancer(ref, title);
  if (!loaded.ok) return loaded.card;
  const groups = await listTargetGroups(loaded.target, loaded.lb.arn);
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
