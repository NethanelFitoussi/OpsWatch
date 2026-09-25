import { ArrowRight } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { DocLink } from '@/components/docs/doc-link';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { RESOURCE_DIMENSION_FALLBACK, conditionText } from '@/components/alarms/condition';
import { alarmTitle } from '@/components/alarms/title';
import { Link } from '@/i18n/navigation';
import { getDb } from '@/lib/db/client';
import { listAlarms } from '@/lib/monitoring/alarms';
import type { MonitoringScope } from '@/lib/monitoring/call';
import {
  COMPARISONS,
  breachedDatapoints,
  metricKey,
  reasonKind,
  reportedValues,
  windowSeconds,
} from '@/lib/monitoring/shared/alarm-facts';
import { familyOf, subjectOf } from '@/lib/monitoring/shared/metric-catalogue';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { resolveTarget } from '@/lib/monitoring/target';
import { listForwardedGroups } from '@/lib/store/collection';
import { pageProblems } from '@/lib/store/problems';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * One alarm, explained well enough to act on.
 *
 * The order is the order of the questions: **what** is happening, **where**, what **AWS observed**, what
 * **condition** produced it, what the metric **means**, what to **check**, and where OpsWatch can
 * actually take you. An operator should get through it without decoding an AWS identifier, and the
 * identifier is still there, at the end, for the runbook that needs it.
 *
 * Three rules it does not bend:
 *
 *   - **Nothing is invented.** The evidence is AWS's own count and AWS's own datapoints; where the
 *     state reason does not carry them, the page says what it knows and stops.
 *   - **The explanation is deterministic.** Each metric family's words are written once and are the same
 *     every time. A model paraphrasing `CPUReservation` differently on each render would be worse than
 *     the identifier it replaced.
 *   - **Only proven links.** A button appears when OpsWatch actually has the relationship — a problem it
 *     opened, a service it knows, a log group it is reading. Never as an invitation to a page that will
 *     shrug.
 */

const STATE_WORD = { OK: STATE_TEXT.healthy, ALARM: STATE_TEXT.critical, INSUFFICIENT_DATA: STATE_TEXT.unknown } as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

export async function AlarmDetail({ scope, name }: { scope: MonitoringScope; name: string }) {
  const t = await getTranslations('Monitoring.alarms');
  const tFamilies = await getTranslations('Monitoring.metrics.families');
  const tMetrics = await getTranslations('Monitoring.alarms.metricNames');
  const tKinds = await getTranslations('Monitoring.alarms.kinds');
  const format = await getFormatter();

  const target = await resolveTarget(scope);
  if (!target.ok) return <FailureNotice failure={target} connectionId={scope.connectionId} />;
  const alarms = await listAlarms(target.data);
  if (!alarms.ok) return <FailureNotice failure={alarms} connectionId={scope.connectionId} />;

  const alarm = alarms.data.find((candidate) => candidate.name === name);
  if (alarm === undefined) {
    return (
      <MonitoringCard title={t('detail.goneTitle')}>
        <p className="text-sm">{t('detail.gone', { name })}</p>
        <p className="mt-2">
          <Link href={subsectionPath(scope, 'alarms', 'list')} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t('detail.backToList')}
          </Link>
        </p>
      </MonitoringCard>
    );
  }

  const family = familyOf(alarm);
  const subject = subjectOf(alarm, RESOURCE_DIMENSION_FALLBACK);
  const evidence = breachedDatapoints(alarm.stateReason);
  const values = reportedValues(alarm.stateReason);
  const kind = reasonKind(alarm.stateReason);
  const window = windowSeconds(alarm);
  const comparison = COMPARISONS[alarm.comparison ?? ''] ?? alarm.comparison ?? '';
  const metricPhrase = (() => {
    const key = alarm.metricName === null ? null : metricKey(alarm.metricName);
    return key === null ? alarm.metricName : tMetrics(key);
  })();

  const title = alarmTitle(alarm, family, metricPhrase, {
    family: (id) => tFamilies(`${id}.title`),
    firing: (metric) => t('rowFallbackTitle', { metric }),
    within: (metric) => t('withinTitle', { metric }),
    unevaluated: (metric) => t('unevaluatedTitle', { metric }),
    composite: () => t('composite'),
    noMetric: (state) => (state === 'OK' ? t('noMetricOK') : t('noMetricUnknown')),
  });

  // Only relationships OpsWatch can prove. Each is a row it actually has.
  const db = getDb();
  const problem = pageProblems(db, { connectionId: scope.connectionId, scope: scope.region, kind: ['alarm_firing'] }, null, 50).items.find(
    (one) => one.subjectId === alarm.name,
  );
  const forwarded = listForwardedGroups(db, scope.connectionId, scope.region).filter((group) => group.state === 'active');

  const destinations: { href: string; label: string }[] = [];
  if (problem !== undefined) {
    destinations.push({ href: `${subsectionPath(scope, 'overview', 'problems')}/${problem.id}`, label: t('detail.openProblem') });
  }
  if (family?.resource === 'ecs-cluster' || family?.resource === 'ecs-service') {
    destinations.push({ href: subsectionPath(scope, 'containers', 'services'), label: t('detail.goServices') });
    destinations.push({ href: subsectionPath(scope, 'containers', 'deployments'), label: t('detail.goDeployments') });
  }
  if (family?.resource === 'load-balancer' || family?.resource === 'target-group') {
    destinations.push({ href: subsectionPath(scope, 'load-balancers', 'list'), label: t('detail.goBalancers') });
  }
  if (family?.resource === 'instance') destinations.push({ href: subsectionPath(scope, 'instances', 'list'), label: t('detail.goInstances') });
  if (family?.resource === 'database') destinations.push({ href: subsectionPath(scope, 'databases', 'instances'), label: t('detail.goDatabases') });
  if (family?.resource === 'cache') destinations.push({ href: subsectionPath(scope, 'redis', 'nodes'), label: t('detail.goRedis') });
  if (forwarded.length > 0 || subject !== null) {
    // The logs search takes a range and log groups in its URL, so this is a real destination rather than
    // a link to a page the reader then has to configure.
    const params = new URLSearchParams([['range', '3h'], ...forwarded.slice(0, 5).map((group) => ['group', group.logGroup] as [string, string])]);
    destinations.push({ href: `${subsectionPath(scope, 'logs', 'search')}?${params.toString()}`, label: t('detail.goLogs') });
  }

  return (
    <div className="space-y-6">
      {/* WHAT, WHERE and STATUS, in the first thing on the page. */}
      <MonitoringCard title={<span className="sr-only">{t('detail.whatIsThis')}</span>}>
        <p className={cn('text-xs font-medium tracking-wide uppercase break-words', STATE_WORD[alarm.state])}>
          {t(`stateHeadline.${alarm.state}`)}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight break-words">{title}</h2>
        {subject !== null && (
          <p className="mt-2 text-sm">
            {subject.kind === 'unknown' ? t('resource') : tKinds(subject.kind)}{' '}
            <span className="font-mono">{subject.name}</span>
            <span className="text-muted-foreground"> · {scope.region}</span>
          </p>
        )}
        {alarm.description !== null && alarm.description.length > 0 && (
          // Whoever created the alarm wrote this. It is the best explanation on the page when it exists.
          <p className="mt-3 text-sm text-muted-foreground">{alarm.description}</p>
        )}
      </MonitoringCard>

      {/* WHAT AWS OBSERVED — its own count and its own datapoints, or nothing. */}
      <MonitoringCard title={t('detail.observedTitle')} description={t('detail.observedHint')}>
        {evidence !== null ? (
          <p className="text-sm">{t('detail.observedCount', { breached: evidence.breached, evaluated: evidence.evaluated })}</p>
        ) : kind === 'no_data' ? (
          <p className="text-sm">{t('detail.reason.no_data')}</p>
        ) : kind === 'within' ? (
          <p className="text-sm">{t('detail.reason.within')}</p>
        ) : (
          <p className="text-sm">{t('detail.reasonUnknown')}</p>
        )}
        {values.length > 0 && alarm.threshold !== null && (
          // The one sentence that answers "how bad is it": the figure AWS saw, beside the line it crossed.
          <p className="mt-2 text-sm font-medium break-words">
            {t('detail.observedAgainst', { value: values[0], comparison, threshold: alarm.threshold })}
          </p>
        )}
        {values.length > 0 && (
          <p className="mt-2 text-sm break-words">
            {t('detail.observedValues', { values: values.join(', ') })}
            {/* Not "current": AWS reported these when it last changed the state. */}
            <span className="block text-xs text-muted-foreground">{t('detail.observedWhen')}</span>
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {alarm.stateUpdatedAt === null ? t('neverChanged') : t('detail.changedAt', { when: format.relativeTime(alarm.stateUpdatedAt) })}
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t('detail.rawReason')}</summary>
          <p className="mt-2 font-mono text-xs break-words text-muted-foreground">{alarm.stateReason || t('detail.noReason')}</p>
        </details>
      </MonitoringCard>

      {/* WHAT THIS MEANS — deterministic, per family, or honestly absent. */}
      {family !== null && (
        <MonitoringCard title={t('detail.meansTitle')}>
          <p className="text-sm">{tFamilies(`${family.id}.means`)}</p>
          <p className="mt-3 text-sm">
            <span className="font-medium">{t('detail.whyItMatters')}</span> {tFamilies(`${family.id}.matters`)}
          </p>
        </MonitoringCard>
      )}

      {/* WHAT TO CHECK — the section an alarm in ALARM state exists for. */}
      {family !== null && alarm.state === 'ALARM' && (
        <MonitoringCard title={t('detail.checkTitle')} description={t('detail.checkHint')}>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {Array.from({ length: family.checks }, (_, index) => (
              <li key={index}>{tFamilies(`${family.id}.checks.${index}`)}</li>
            ))}
          </ol>
        </MonitoringCard>
      )}

      {destinations.length > 0 && (
        <MonitoringCard title={t('detail.whereNext')} description={t('detail.whereNextHint')}>
          <ul className="flex flex-wrap gap-2">
            {destinations.map((destination) => (
              <li key={destination.href}>
                <Link
                  href={destination.href}
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  {destination.label} <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {problem === undefined && (
            // Said rather than manufactured: an alarm without a problem is the ordinary case.
            <p className="mt-3 text-sm text-muted-foreground">{t('detail.noProblem')}</p>
          )}
        </MonitoringCard>
      )}

      {/* THE CONDITION — everything AWS was configured with. */}
      <MonitoringCard title={t('detail.conditionTitle')} description={t('detail.conditionHint')}>
        {alarm.threshold !== null && (
          <p className="mb-3 rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
            {conditionText({ metric: metricPhrase, comparison, threshold: alarm.threshold, shape: family?.shape ?? 'plain' })}
            {alarm.evaluationPeriods !== null && (
              <span className="text-muted-foreground">
                {' '}
                · {t('detail.forPeriods', { count: alarm.datapointsToAlarm ?? alarm.evaluationPeriods, periods: alarm.evaluationPeriods })}
              </span>
            )}
          </p>
        )}
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('detail.metric')}>{alarm.metricName === null ? t('composite') : (metricPhrase ?? alarm.metricName)}</Fact>
          <Fact label={t('detail.namespace')}>{alarm.namespace ?? t('detail.notReported')}</Fact>
          <Fact label={t('detail.resource')}>{subject === null ? t('detail.noResourceFact') : subject.name}</Fact>
          <Fact label={t('detail.statistic')}>{alarm.statistic ?? t('detail.notReported')}</Fact>
          <Fact label={t('detail.period')}>{alarm.period === null ? t('detail.notReported') : t('detail.seconds', { value: alarm.period })}</Fact>
          <Fact label={t('detail.window')}>{window === null ? t('detail.notReported') : t('forWindow', { minutes: Math.round(window / 60) })}</Fact>
          <Fact label={t('detail.missingData')}>{alarm.treatMissingData ?? t('detail.notReported')}</Fact>
        </dl>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t('technical')}</summary>
          <p className="mt-2 font-mono text-xs break-all text-muted-foreground">{alarm.name}</p>
        </details>
      </MonitoringCard>

      <MonitoringCard title={t('detail.historyTitle')}>
        {/* Not an empty chart: the permission simply is not granted, and saying so is the honest answer. */}
        <p className="text-sm text-muted-foreground">{t('detail.historyUnavailable')}</p>
      </MonitoringCard>

      <p className="text-sm text-muted-foreground">
        {t('vsProblems')} <DocLink slug="alarms" label={t('readGuide')} />
      </p>
    </div>
  );
}
