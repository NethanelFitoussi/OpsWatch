import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { targetGroupLatencyQuery, targetGroupQueries, targetHealth, type TargetGroup } from '@/lib/monitoring/elb';
import { getMetricSeries, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { currentWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { TONE_SOFT } from '@/lib/ui/tones';
import { FailureNotice } from './failure-notice';
import { MetricChart, type ChartSeries } from './metric-chart';

const STATE_BADGE_CLASS: Record<string, string> = { healthy: TONE_SOFT.success, unhealthy: TONE_SOFT.danger };
const MUTED_BADGE_CLASS = 'bg-muted text-muted-foreground';

const chartSeries = (series: readonly MetricSeries[], id: string, label: string): ChartSeries => ({ id, label, ...seriesById(series, id) });

/** Target health and the ALB metrics of one target group. Reused by the containers and load balancer pages. */
export async function TargetGroupPanel({ scope, group, range }: { scope: MonitoringScope; group: TargetGroup; range: TimeRange }) {
  const t = await getTranslations('Monitoring.targetGroup');
  const tMetrics = await getTranslations('Monitoring.metrics');
  const headingId = `target-group-${group.name}`;
  const heading = (
    <h3 id={headingId} className="text-sm font-semibold">
      {group.name}
      {group.protocol && group.port != null && <span className="ml-2 font-normal text-muted-foreground">{`${group.protocol}:${group.port}`}</span>}
    </h3>
  );

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <section aria-labelledby={headingId} className="space-y-3">
        {heading}
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </section>
    );
  }

  const latencyQuery = targetGroupLatencyQuery(group, 'g');
  const window = currentWindow(range);
  const [health, main, p95] = await Promise.all([
    targetHealth(target.data, group.arn),
    latencyQuery ? getMetricSeries(target.data, targetGroupQueries(group, 'g'), window) : null,
    // Percentile queries always go in their own request (moto fact 2).
    latencyQuery ? getMetricSeries(target.data, [latencyQuery], window) : null,
  ]);

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      {heading}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase">{t('targets')}</h4>
        {!health.ok ? (
          <FailureNotice failure={health} connectionId={scope.connectionId} />
        ) : health.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noTargets')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.target')}</TableHead>
                <TableHead>{t('columns.state')}</TableHead>
                <TableHead>{t('columns.reason')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.data.map((entry) => (
                <TableRow key={`${entry.id}:${entry.port}`}>
                  <TableCell className="font-mono text-xs">{entry.port != null ? `${entry.id}:${entry.port}` : entry.id}</TableCell>
                  <TableCell>
                    <Badge className={STATE_BADGE_CLASS[entry.state] ?? MUTED_BADGE_CLASS}>{entry.state}</Badge>
                  </TableCell>
                  <TableCell title={entry.description ?? undefined}>{entry.reason ?? NO_VALUE}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {!main || !p95 ? (
        <p className="text-sm text-muted-foreground">{t('notAttached')}</p>
      ) : !main.ok ? (
        <FailureNotice failure={main} connectionId={scope.connectionId} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <MetricChart title={tMetrics('requests')} unit="count" range={range} series={[chartSeries(main.data, 'greq', tMetrics('requests'))]} />
          <MetricChart title={tMetrics('target5xx')} unit="count" range={range} series={[chartSeries(main.data, 'gt5xx', tMetrics('target5xx'))]} />
          {p95.ok ? (
            <MetricChart title={tMetrics('responseTimeP95')} unit="seconds" range={range} series={[chartSeries(p95.data, 'gp95', tMetrics('responseTimeP95'))]} />
          ) : (
            <figure aria-labelledby={`${headingId}-p95`} className="min-w-0 space-y-2">
              <figcaption id={`${headingId}-p95`} className="text-sm font-medium">
                {tMetrics('responseTimeP95')}
              </figcaption>
              <p role="status" className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                {tMetrics('p95Unavailable')}
              </p>
            </figure>
          )}
          <MetricChart
            title={tMetrics('hosts')}
            unit="count"
            range={range}
            series={[chartSeries(main.data, 'ghealthy', tMetrics('healthyHosts')), chartSeries(main.data, 'gunhealthy', tMetrics('unhealthyHosts'))]}
          />
        </div>
      )}
    </section>
  );
}
