import { getTranslations } from 'next-intl/server';
import { HealthySummary } from '@/components/infra/healthy-summary';
import { MetricCell } from '@/components/infra/metric-cell';
import { ResourceMap, type MapGroup, type MapTile } from '@/components/infra/resource-map';
import { StatusBar } from '@/components/infra/status-bar';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { MAX_INSTANCES, instanceQueries, listInstances, type Ec2Instance } from '@/lib/monitoring/ec2';
import { evaluateEc2Instance } from '@/lib/monitoring/ec2-health';
import { getMetricSeries, latestValue, seriesById, type MetricSeries } from '@/lib/monitoring/metrics';
import { evaluate, rollUp, type Evaluation } from '@/lib/monitoring/shared/evaluated-health';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { resolveTarget } from '@/lib/monitoring/target';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * EC2, as a host map.
 *
 * Instances gathered by availability zone, one tile each, coloured by the only signal AWS publishes that
 * actually means "this is broken": the status check. CPU is beside it as a number and a ranking, never as
 * a colour — a batch host at 95 % is doing its job, and a heat ramp would call it an emergency.
 *
 * A running instance publishing no status-check data is an outline, not a green square. There is something
 * there that could be broken and nothing saying it is not, which is exactly what `unknown` is for.
 */

type Judged = { instance: Ec2Instance; evaluation: Evaluation; cpu: number | null };

export async function Ec2Hosts({ scope, range, nowMs }: { scope: MonitoringScope; range: TimeRange; nowMs: number }) {
  const t = await getTranslations('Monitoring.ec2');
  const estate = await getTranslations('Monitoring.estate');

  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={t('title')}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  const listed = await listInstances(target.data);
  if (!listed.ok) {
    return (
      <MonitoringCard title={t('title')}>
        <FailureNotice failure={listed} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  const instances = listed.data.instances;
  if (instances.length === 0) {
    return (
      <MonitoringCard title={t('title')}>
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      </MonitoringCard>
    );
  }

  const queries = instances.flatMap((instance, i) => instanceQueries(instance.id, `i${i}`));
  const metrics = await getMetricSeries(target.data, queries, timeWindow(range, nowMs));
  const series: MetricSeries[] = metrics.ok ? metrics.data : [];
  const metricsUnavailable = !metrics.ok;

  const judged: Judged[] = instances.map((instance, i) => {
    const cpu = latestValue(seriesById(series, `i${i}cpu`));
    const failures = seriesById(series, `i${i}status`).values;
    // The window's worst answer, because an instance that failed its check once did fail it.
    const statusCheckFailed = failures.length === 0 ? null : Math.max(...failures);
    return { instance, cpu, evaluation: evaluateEc2Instance(instance, { statusCheckFailed, cpu, metricsUnavailable }, nowMs) };
  });

  const group = rollUp(judged.map((entry) => entry.evaluation.state));
  const running = instances.filter((instance) => instance.state === 'running').length;

  const zones = [...new Set(instances.map((instance) => instance.availabilityZone))].sort();
  const groups: MapGroup[] = zones.map((zone) => ({
    key: zone || 'unknown',
    label: zone || t('noZone'),
    tiles: judged
      .filter((entry) => entry.instance.availabilityZone === zone)
      .map(
        (entry): MapTile => ({
          id: entry.instance.id,
          label: entry.instance.name,
          state: entry.evaluation.state,
          detail: t('tileDetail', { type: entry.instance.type, state: entry.instance.state }),
          href: `${subsectionPath(scope, 'instances', 'list')}?range=${range}&q=${encodeURIComponent(entry.instance.id)}`,
        }),
      ),
  }));

  const summary = evaluate({
    checks: zones.map((zone) => {
      const zoneHealth = rollUp(judged.filter((entry) => entry.instance.availabilityZone === zone).map((entry) => entry.evaluation.state));
      return {
        id: zoneHealth.state === 'critical' ? 'ec2.zone.critical' : zoneHealth.state === 'unknown' ? 'ec2.zone.partial' : 'ec2.zone.pass',
        outcome: zoneHealth.state === 'critical' ? ('fail' as const) : zoneHealth.state === 'unknown' ? ('unknown' as const) : ('pass' as const),
        values: { zone: zone || t('noZone'), healthy: zoneHealth.counts.healthy, total: zoneHealth.total },
      };
    }),
    unread: judged.some((entry) => entry.evaluation.unread.length > 0) ? ['ec2.statusCheck'] : [],
    evaluatedAt: nowMs,
    nowMs,
  });

  const hottest = [...judged].filter((entry) => entry.cpu !== null).sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0)).slice(0, 5);

  return (
    <div className="space-y-6">
      <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4">
            <p className={cn('text-2xl font-semibold', STATE_TEXT[group.state])}>{estate(`verdict.${group.state}`)}</p>
            <StatusBar group={group} />
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('running')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{t('ofTotal', { running, total: instances.length })}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t('zones')}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{zones.length}</dd>
              </div>
            </dl>
          </div>
          <HealthySummary evaluation={summary} nowMs={nowMs} showVerdict={false} />
        </div>
      </MonitoringCard>

      {metricsUnavailable && (
        <MonitoringCard title={t('metricsUnavailable')}>
          <FailureNotice failure={metrics} connectionId={scope.connectionId} />
        </MonitoringCard>
      )}

      <MonitoringCard title={t('mapTitle')} description={t('mapDescription')}>
        <ResourceMap groups={groups} groupedByLabel={estate('groupedBy', { dimension: t('byZone') })} />
        {listed.data.truncated && <p className="mt-4 text-sm text-muted-foreground">{t('truncated', { shown: MAX_INSTANCES })}</p>}
      </MonitoringCard>

      {hottest.length > 0 && (
        <MonitoringCard title={t('hottestTitle')} description={t('hottestDescription')}>
          <ul className="space-y-2">
            {hottest.map((entry) => (
              <li key={entry.instance.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <Link
                  href={`${subsectionPath(scope, 'instances', 'list')}?range=${range}&q=${encodeURIComponent(entry.instance.id)}`}
                  className="min-w-0 truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {entry.instance.name}
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
