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
  summarizeTargetGroupHealth,
  targetHealth,
  MAX_TARGET_GROUPS_WITH_HEALTH,
  type LoadBalancerHostSummary,
} from '@/lib/monitoring/elb';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { formatMetricValue, NO_VALUE } from '@/lib/monitoring/shared/format';
import { monitoringPath } from '@/lib/monitoring/shared/paths';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { TONE_TEXT } from '@/lib/ui/tones';

const sum = (series: readonly MetricSeries[], id: string) => seriesById(series, id).values.reduce((a, b) => a + b, 0);

export async function LoadBalancersCard({ scope, range, nowMs }: { scope: MonitoringScope; range: TimeRange; nowMs: number }) {
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
  const lbs = lbsResult.data;
  // An empty region has nothing to show regardless of whether the target group lookup below succeeded.
  if (lbs.length === 0) {
    return (
      <MonitoringCard title={title}>
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </MonitoringCard>
    );
  }

  // A failed target group lookup must not hide name/scheme/state/requests/5xx: the table still renders,
  // with a notice above it and every host count shown as incomplete (same principle as a `main` failure below).
  const allGroups = groupsResult.ok ? groupsResult.data : [];
  const checkedGroups = allGroups.slice(0, MAX_TARGET_GROUPS_WITH_HEALTH);

  const window = timeWindow(range, nowMs);
  const [main, p95, healthResults] = await Promise.all([
    getMetricSeries(target.data, lbs.flatMap((lb, index) => loadBalancerQueries(lb, `l${index}`)), window),
    // Percentile queries always go in their own request (moto fact 2).
    getMetricSeries(target.data, lbs.map((lb, index) => loadBalancerLatencyQuery(lb, `l${index}`)), window),
    Promise.all(checkedGroups.map((group) => targetHealth(target.data, group.arn))),
  ]);

  const hostSummaries = summarizeTargetGroupHealth(allGroups, healthResults);
  const hostsFor = (arn: string): LoadBalancerHostSummary =>
    !groupsResult.ok ? { healthy: 0, unhealthy: 0, incomplete: true } : (hostSummaries.get(arn) ?? { healthy: 0, unhealthy: 0, incomplete: false });
  // Counted separately from the `groupsResult` failure notice below: this is about rows that could each be
  // individually incomplete (a denied DescribeTargetHealth call, or a target group past the checked cap)
  // even though listing target groups itself succeeded.
  const incompleteCount = groupsResult.ok ? lbs.filter((lb) => hostsFor(lb.arn).incomplete).length : 0;

  return (
    <MonitoringCard title={title}>
      {!main.ok && (
        <div className="mb-3">
          <FailureNotice failure={main} connectionId={scope.connectionId} />
        </div>
      )}
      {!groupsResult.ok && (
        <div className="mb-3">
          <FailureNotice failure={groupsResult} connectionId={scope.connectionId} />
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
            const { healthy, unhealthy, incomplete } = hostsFor(lb.arn);
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
                <TableCell>
                  {p95.ok ? formatMetricValue(latestValue(seriesById(p95.data, `l${index}p95`)), 'seconds', locale) : NO_VALUE}
                </TableCell>
                <TableCell>
                  {incomplete ? (
                    NO_VALUE
                  ) : (
                    <span className={unhealthy > 0 ? TONE_TEXT.danger : undefined}>{t('hostCounts', { healthy, unhealthy })}</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {incompleteCount > 0 && <p className="mt-3 text-sm text-muted-foreground">{t('hostsIncomplete', { count: incompleteCount })}</p>}
    </MonitoringCard>
  );
}
