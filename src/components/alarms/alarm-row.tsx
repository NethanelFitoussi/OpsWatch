import { ArrowRight } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { AlarmSummary } from '@/lib/monitoring/alarms';
import { COMPARISONS, breachedDatapoints, metricKey, reportedValues, windowSeconds } from '@/lib/monitoring/shared/alarm-facts';
import { familyOf, subjectOf } from '@/lib/monitoring/shared/metric-catalogue';
import { STATE_FILL, STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { conditionText, RESOURCE_DIMENSION_FALLBACK } from './condition';
import { alarmTitle } from './title';

/**
 * One alarm, as an operational sentence.
 *
 * **The AWS identifier is not the title.** A real estate produces alarm names like
 * `ApplicationInsights/ApplicationInsights-ContainerInsights-ECS_CLUSTER-ecs-gigs-prod/AWS/ECS/CPUReservation/…`,
 * and a row led by one asks an operator to decode AWS's naming before they can find out what is wrong.
 * The metric and its dimensions say it properly — "CPU reservation is above its threshold, ECS cluster
 * ecs-gigs-prod" — and the identifier lives under a disclosure for whoever needs it for a runbook or the
 * AWS console.
 *
 * Where OpsWatch has no explanation for a metric, the row says the AWS metric name and the condition and
 * stops. That is still true, and still better than the alarm's own name.
 */

const STATE_DOT = { OK: STATE_FILL.healthy, ALARM: STATE_FILL.critical, INSUFFICIENT_DATA: STATE_FILL.unknown } as const;
const STATE_WORD = { OK: STATE_TEXT.healthy, ALARM: STATE_TEXT.critical, INSUFFICIENT_DATA: STATE_TEXT.unknown } as const;

export async function AlarmRow({ alarm, href }: { alarm: AlarmSummary; href: string }) {
  const t = await getTranslations('Monitoring.alarms');
  const tFamilies = await getTranslations('Monitoring.metrics.families');
  const tMetrics = await getTranslations('Monitoring.alarms.metricNames');
  const tKinds = await getTranslations('Monitoring.alarms.kinds');
  const format = await getFormatter();

  const family = familyOf(alarm);
  const subject = subjectOf(alarm, RESOURCE_DIMENSION_FALLBACK);
  const evidence = breachedDatapoints(alarm.stateReason);
  // What AWS actually quoted. Never a current value — OpsWatch did not read the metric.
  const values = reportedValues(alarm.stateReason);
  const window = windowSeconds(alarm);

  // The sentence a reader leads with. A family gives it; otherwise the AWS metric name, which is still an
  // enormous improvement on the alarm's own identifier. Phrased for the state the alarm is actually in.
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

  return (
    <li className="group border-b last:border-b-0 hover:bg-muted/40">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3">
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', STATE_DOT[alarm.state])} aria-hidden />

        <div className="min-w-0 flex-1 basis-72 space-y-1">
          <p className="text-sm font-medium break-words">
            <Link href={href} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:underline">
              {title}
            </Link>
          </p>

          {/* Where, in the words the product uses elsewhere: "ECS cluster", not "ClusterName". */}
          <p className="text-xs text-muted-foreground">
            <span className={STATE_WORD[alarm.state]}>{t(`filters.states.${alarm.state}`)}</span>
            {subject !== null && (
              <>
                {' · '}
                {subject.kind === 'unknown' ? t('resource') : tKinds(subject.kind)}{' '}
                <span className="font-mono text-foreground">{subject.name}</span>
              </>
            )}
          </p>

          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
            {alarm.threshold !== null && (
              <span className="max-w-full rounded-md bg-muted px-1.5 py-0.5 font-mono break-all">
                {conditionText({ metric: metricPhrase, comparison: COMPARISONS[alarm.comparison ?? ''] ?? alarm.comparison, threshold: alarm.threshold, shape: family?.shape ?? 'plain' })}
              </span>
            )}
            {/* What AWS counted, not what the alarm was configured to require. */}
            {evidence !== null && (
              <span className="text-muted-foreground">{t('evidenceShort', { breached: evidence.breached, evaluated: evidence.evaluated })}</span>
            )}
            {/* And the figures it quoted, where its sentence carried any. */}
            {values.length > 0 && <span className="break-all text-muted-foreground">{t('reportedShort', { values: values.join(', ') })}</span>}
            {evidence === null && values.length === 0 && window !== null && (
              <span className="text-muted-foreground">{t('forWindow', { minutes: Math.round(window / 60) })}</span>
            )}
          </p>

          {/* The identifier, available and secondary. Not the thing a reader has to start from. */}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{t('technical')}</summary>
            <p className="mt-1 font-mono break-all text-muted-foreground">{alarm.name}</p>
            {alarm.namespace !== null && alarm.metricName !== null && (
              <p className="font-mono break-all text-muted-foreground">
                {alarm.namespace} · {alarm.metricName}
              </p>
            )}
          </details>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <span className="text-muted-foreground">
            {alarm.stateUpdatedAt === null ? t('neverChanged') : t('changedAgo', { when: format.relativeTime(alarm.stateUpdatedAt) })}
          </span>
          <Link
            href={href}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition-colors hover:bg-accent"
          >
            {alarm.state === 'ALARM' ? t('investigate') : t('open')} <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      </div>
    </li>
  );
}
