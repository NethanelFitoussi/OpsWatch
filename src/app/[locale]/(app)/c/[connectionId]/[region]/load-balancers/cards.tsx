import { getLocale, getTranslations } from 'next-intl/server';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import {
  listLoadBalancers,
  listTargetGroups,
  loadBalancerLatencyQuery,
  loadBalancerQueries,
  targetHealth,
  targetHealthCounts,
  MAX_TARGET_GROUPS_WITH_HEALTH,
  type TargetHealthEntry,
} from '@/lib/monitoring/elb';
import { getMetricSeries, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { formatMetricValue, NO_VALUE } from '@/lib/monitoring/shared/format';
import { monitoringPath } from '@/lib/monitoring/shared/paths';
import { currentWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { TONE_TEXT } from '@/lib/ui/tones';

const sum = (series: readonly MetricSeries[], id: string) => seriesById(series, id).values.reduce((a, b) => a + b, 0);

export async function LoadBalancersCard({ scope, range }: { scope: MonitoringScope; range: TimeRange }) {
  const t = await getTranslations('Monitoring.loadBalancers');
  const locale = await getLocale();
  const title = t('cardTitle');

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  const [lbsResult, groupsResult] = await Promise.all([listLoadBalancers(target.data), listTargetGroups(target.data, null)]);
  if (!lbsResult.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={lbsResult} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  if (!groupsResult.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={groupsResult} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  const lbs = lbsResult.data;
  if (lbs.length === 0) {
    return (
      <MonitoringCard title={title}>
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </MonitoringCard>
    );
  }

  const window = currentWindow(range);
  const targetGroups = groupsResult.data.slice(0, MAX_TARGET_GROUPS_WITH_HEALTH);
  const [main, p95, healthResults] = await Promise.all([
    getMetricSeries(target.data, lbs.flatMap((lb, index) => loadBalancerQueries(lb, `l${index}`)), window),
    // Percentile queries always go in their own request (moto fact 2).
    getMetricSeries(target.data, lbs.map((lb, index) => loadBalancerLatencyQuery(lb, `l${index}`)), window),
    Promise.all(targetGroups.map((group) => targetHealth(target.data, group.arn))),
  ]);

  const healthByLoadBalancer = new Map<string, TargetHealthEntry[]>();
  targetGroups.forEach((group, index) => {
    const health = healthResults[index];
    if (!health.ok) return;
    for (const loadBalancerArn of group.loadBalancerArns) {
      const entries = healthByLoadBalancer.get(loadBalancerArn) ?? [];
      entries.push(...health.data);
      healthByLoadBalancer.set(loadBalancerArn, entries);
    }
  });

  return (
    <MonitoringCard title={title}>
      {!main.ok && (
        <div className="mb-3">
          <FailureNotice failure={main} connectionId={scope.connectionId} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.name')}</TableHead>
            <TableHead>{t('columns.scheme')}</TableHead>
            <TableHead>{t('columns.state')}</TableHead>
            <TableHead>{t('columns.requests')}</TableHead>
            <TableHead>{t('columns.elb5xx')}</TableHead>
            <TableHead>{t('columns.target5xx')}</TableHead>
            <TableHead>{t('columns.p95')}</TableHead>
            <TableHead>{t('columns.hosts')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lbs.map((lb, index) => {
            const { healthy, unhealthy } = targetHealthCounts(healthByLoadBalancer.get(lb.arn) ?? []);
            const p95Series = p95.ok ? seriesById(p95.data, `l${index}p95`) : null;
            const p95Latest = p95Series && p95Series.values.length > 0 ? p95Series.values[p95Series.values.length - 1] : null;
            return (
              <TableRow key={lb.arn}>
                <TableCell>
                  <Link
                    href={`${monitoringPath(scope, 'load-balancers', lb.name)}?range=${range}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {lb.name}
                  </Link>
                </TableCell>
                <TableCell>{lb.scheme ?? NO_VALUE}</TableCell>
                <TableCell>{lb.state ?? NO_VALUE}</TableCell>
                <TableCell>{main.ok ? formatMetricValue(sum(main.data, `l${index}req`), 'count', locale) : NO_VALUE}</TableCell>
                <TableCell>{main.ok ? formatMetricValue(sum(main.data, `l${index}elb5xx`), 'count', locale) : NO_VALUE}</TableCell>
                <TableCell>{main.ok ? formatMetricValue(sum(main.data, `l${index}t5xx`), 'count', locale) : NO_VALUE}</TableCell>
                <TableCell>{p95Series ? formatMetricValue(p95Latest, 'seconds', locale) : NO_VALUE}</TableCell>
                <TableCell>
                  <span className={unhealthy > 0 ? TONE_TEXT.danger : undefined}>{t('hostCounts', { healthy, unhealthy })}</span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </MonitoringCard>
  );
}
