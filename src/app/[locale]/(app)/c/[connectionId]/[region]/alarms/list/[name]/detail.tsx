import { ArrowRight } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { DocLink } from '@/components/docs/doc-link';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import { getDb } from '@/lib/db/client';
import { listAlarms } from '@/lib/monitoring/alarms';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { COMPARISONS, metricKey, reasonKind, reportedValue, resourceOf, serviceOf, titleParts, windowSeconds } from '@/lib/monitoring/shared/alarm-facts';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { resolveTarget } from '@/lib/monitoring/target';
import { pageProblems } from '@/lib/store/problems';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * One alarm, explained.
 *
 * What it watches, where it stands, why AWS says so, the condition in full, and — where one genuinely
 * exists — the OpsWatch problem that this alarm firing opened.
 *
 * Two things this page deliberately does not do. It does not present the alarm as an OpsWatch problem:
 * they are different objects with different authors, and the card that links them says which is which.
 * And it does not show a state history, because `cloudwatch:DescribeAlarmHistory` is not in the role's
 * policy — so instead of an empty timeline it says what is missing and why.
 */

const STATE_WORD = { OK: STATE_TEXT.healthy, ALARM: STATE_TEXT.critical, INSUFFICIENT_DATA: STATE_TEXT.unknown } as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // `min-w-0`: a grid item defaults to min-content width, so one unbroken metric name was widening the
    // whole grid past a 390px viewport however hard the value inside it tried to wrap.
    <div className="min-w-0 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

export async function AlarmDetail({ scope, name }: { scope: MonitoringScope; name: string }) {
  const t = await getTranslations('Monitoring.alarms');
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

  const parts = titleParts(alarm);
  const resource = resourceOf(alarm);
  const window = windowSeconds(alarm);
  const value = reportedValue(alarm.stateReason);
  const kind = reasonKind(alarm.stateReason);
  const comparison = COMPARISONS[alarm.comparison ?? ''] ?? alarm.comparison ?? '';
  // A phrase where OpsWatch has one, the AWS metric name where it has not. Asking `t()` for a key that
  // may not exist renders the key path, which is how `Monitoring.metrics.cpuutilization` reached the page.
  const metricLabel = (metric: string) => {
    const key = metricKey(metric);
    return key === null ? metric : t(`metricNames.${key}`);
  };

  // The relationship, where it is real: an alarm in ALARM state is what opens an `alarm_firing` problem,
  // and the problem's subject is this alarm's own name.
  const related = pageProblems(getDb(), { connectionId: scope.connectionId, scope: scope.region, kind: ['alarm_firing'] }, null, 50).items.find(
    (problem) => problem.subjectId === alarm.name,
  );

  return (
    <div className="space-y-6">
      <MonitoringCard title={t('detail.whatIsThis')}>
        <p className={cn('text-lg font-semibold', STATE_WORD[alarm.state])}>{t(`filters.states.${alarm.state}`)}</p>
        <p className="mt-1 text-sm break-words">
          {parts === null
            ? t('detail.compositeWhat')
            : parts.resource === null
              ? // Not "on no resource": an alarm without a recognised dimension has nothing to name, and the
                // sentence says that rather than wedging an apology into the slot where a name goes.
                t('detail.watchesOnly', { metric: metricLabel(parts.metric) })
              : t('detail.watches', { metric: metricLabel(parts.metric), resource: parts.resource })}
        </p>
        {alarm.description !== null && alarm.description.length > 0 && (
          // Whoever created the alarm wrote this. It is the best explanation on the page when it exists.
          <p className="mt-2 text-sm text-muted-foreground">{alarm.description}</p>
        )}
        <p className="mt-3 font-mono text-xs break-all text-muted-foreground">{alarm.name}</p>
      </MonitoringCard>

      <MonitoringCard title={t('detail.whyTitle')} description={t('detail.whyHint')}>
        {kind === null ? (
          // OpsWatch does not recognise the sentence, so it does not paraphrase it.
          <p className="text-sm">{t('detail.reasonUnknown')}</p>
        ) : (
          <p className="text-sm">
            {/* Whichever halves AWS actually gave. `?? 0` would print "AWS saw 0", which is a measurement
                AWS never reported — the exact fabrication this page exists to avoid. */}
            {kind !== 'crossed'
              ? t(`detail.reason.${kind}`)
              : value !== null && alarm.threshold !== null
                ? t('detail.reason.crossed', { value, threshold: alarm.threshold, comparison })
                : value === null && alarm.threshold !== null
                  ? t('detail.crossedNoValue', { threshold: alarm.threshold, comparison })
                  : value !== null
                    ? t('detail.crossedNoThreshold', { value })
                    : t('detail.reasonUnknown')}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {alarm.stateUpdatedAt === null ? t('neverChanged') : t('detail.changedAt', { when: format.relativeTime(alarm.stateUpdatedAt) })}
        </p>
        {/* AWS's own words, kept but not led with: they are written for a machine. */}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t('detail.rawReason')}</summary>
          <p className="mt-2 font-mono text-xs break-words text-muted-foreground">{alarm.stateReason || t('detail.noReason')}</p>
        </details>
      </MonitoringCard>

      <MonitoringCard title={t('detail.conditionTitle')} description={t('detail.conditionHint')}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('detail.metric')}>{alarm.metricName === null ? t('composite') : metricLabel(alarm.metricName)}</Fact>
          <Fact label={t('detail.namespace')}>{alarm.namespace ?? t('detail.notReported')}</Fact>
          <Fact label={t('detail.service')}>{t(`services.${serviceOf(alarm)}`)}</Fact>
          <Fact label={t('detail.resource')}>
            {resource === null ? t('detail.noResourceFact') : resource.value}
          </Fact>
          <Fact label={t('columns.threshold')}>
            {alarm.threshold === null
              ? t('detail.notReported')
              : `${COMPARISONS[alarm.comparison ?? ''] ?? alarm.comparison} ${alarm.threshold}`}
          </Fact>
          <Fact label={t('detail.statistic')}>{alarm.statistic ?? t('detail.notReported')}</Fact>
          <Fact label={t('detail.period')}>
            {alarm.period === null ? t('detail.notReported') : t('detail.seconds', { value: alarm.period })}
          </Fact>
          <Fact label={t('detail.evaluationPeriods')}>
            {alarm.evaluationPeriods === null
              ? t('detail.notReported')
              : t('detail.ofPeriods', { datapoints: alarm.datapointsToAlarm ?? alarm.evaluationPeriods, periods: alarm.evaluationPeriods })}
          </Fact>
          <Fact label={t('detail.window')}>{window === null ? t('detail.notReported') : t('forWindow', { minutes: Math.round(window / 60) })}</Fact>
          <Fact label={t('detail.missingData')}>{alarm.treatMissingData ?? t('detail.notReported')}</Fact>
        </dl>
      </MonitoringCard>

      <MonitoringCard title={t('detail.historyTitle')}>
        {/* Not an empty chart: the permission simply is not granted, and saying so is the honest answer. */}
        <p className="text-sm text-muted-foreground">{t('detail.historyUnavailable')}</p>
      </MonitoringCard>

      <MonitoringCard title={t('detail.relatedTitle')} description={t('detail.relatedHint')}>
        {related === undefined ? (
          <p className="text-sm text-muted-foreground">{t('detail.noProblem')}</p>
        ) : (
          <Link
            href={`${subsectionPath(scope, 'overview', 'problems')}/${related.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('detail.openProblem')} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t('vsProblems')} <DocLink slug="alarms" label={t('readGuide')} />
        </p>
      </MonitoringCard>
    </div>
  );
}
