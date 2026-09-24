import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { AlarmSummary } from '@/lib/monitoring/alarms';
import { COMPARISONS, metricKey, reportedValue, resourceOf, serviceOf, titleParts, windowSeconds } from '@/lib/monitoring/shared/alarm-facts';
import { STATE_FILL, STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * One alarm, as a sentence rather than as a row of CloudWatch columns.
 *
 * The old row led with `TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e` and a truncated paragraph
 * AWS wrote for a machine. This leads with what is being watched and where, and keeps the AWS name
 * underneath — an operator still needs it, because it is what their runbook and their console say.
 *
 * **Nothing here is measured by OpsWatch.** The figure, where there is one, is the datapoint AWS itself
 * quoted when it last changed the state, and it is labelled as that rather than as the current value.
 */

/** OK is green because AWS evaluated it; insufficient data is grey because nobody could. */
const STATE_DOT = { OK: STATE_FILL.healthy, ALARM: STATE_FILL.critical, INSUFFICIENT_DATA: STATE_FILL.unknown } as const;
const STATE_WORD = { OK: STATE_TEXT.healthy, ALARM: STATE_TEXT.critical, INSUFFICIENT_DATA: STATE_TEXT.unknown } as const;

export async function AlarmRow({ alarm, href }: { alarm: AlarmSummary; href: string }) {
  const t = await getTranslations('Monitoring.alarms');
  const format = await getFormatter();

  const parts = titleParts(alarm);
  const resource = resourceOf(alarm);
  const service = serviceOf(alarm);
  const value = reportedValue(alarm.stateReason);
  const window = windowSeconds(alarm);

  // A metric OpsWatch has a word for reads as that word; otherwise the AWS metric name, which is still
  // a great deal better than the alarm's name. `t()` is never asked for a key that may not exist: next-intl
  // does not throw for one, it renders the key path, and `Monitoring.metrics.cpuutilization` is what an
  // operator then reads on the page.
  const metricLabel = (name: string) => {
    const key = metricKey(name);
    return key === null ? name : t(`metricNames.${key}`);
  };

  const title =
    parts === null
      ? alarm.name
      : parts.resource === null
        ? metricLabel(parts.metric)
        : t('rowTitle', { metric: metricLabel(parts.metric), resource: parts.resource });

  return (
    <li className="relative border-b last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 py-3">
        <span className={cn('mt-1.5 size-2 shrink-0 self-start rounded-full', STATE_DOT[alarm.state])} aria-hidden />
        <div className="min-w-0 flex-1 basis-64">
          {/* A custom metric name is one unbroken token; without this it is clipped at 390px. */}
          <p className="text-sm font-medium break-words">
            <Link href={href} className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none">
              {title}
            </Link>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className={STATE_WORD[alarm.state]}>{t(`filters.states.${alarm.state}`)}</span>
            {' · '}
            {t(`services.${service}`)}
            {resource !== null && ` · ${resource.value}`}
            {alarm.type === 'composite' && ` · ${t('composite')}`}
          </p>
          {/* The AWS name, kept because it is what a runbook, a ticket and the console all say. */}
          <p className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground/80">{alarm.name}</p>
        </div>

        <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-1 text-xs">
          {alarm.threshold !== null && (
            <div>
              <dt className="text-muted-foreground">{t('columns.threshold')}</dt>
              <dd className="tabular-nums">
                {COMPARISONS[alarm.comparison ?? ''] ?? alarm.comparison} {alarm.threshold}
                {window !== null && <span className="text-muted-foreground"> · {t('forWindow', { minutes: Math.round(window / 60) })}</span>}
              </dd>
            </div>
          )}
          {value !== null && (
            <div>
              {/* Not "current": AWS reported it when it last changed the state, and that may be hours ago. */}
              <dt className="text-muted-foreground">{t('reported')}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">{t('columns.updated')}</dt>
            <dd>{alarm.stateUpdatedAt === null ? t('neverChanged') : format.relativeTime(alarm.stateUpdatedAt)}</dd>
          </div>
        </dl>
      </div>
    </li>
  );
}
