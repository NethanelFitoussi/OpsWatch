import { getTranslations } from 'next-intl/server';
import { AlarmRow } from '@/components/alarms/alarm-row';
import { DocLink } from '@/components/docs/doc-link';
import { StatusBar } from '@/components/infra/status-bar';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import { ALARM_STATE_FILTERS, filterAlarms, listAlarms, type AlarmFilter, type AlarmState, type AlarmSummary } from '@/lib/monitoring/alarms';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { ALARM_SERVICES, countStates, serviceOf, type AlarmService } from '@/lib/monitoring/shared/alarm-facts';
import type { GroupHealth } from '@/lib/monitoring/shared/evaluated-health';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { resolveTarget } from '@/lib/monitoring/target';
import { cn } from '@/lib/utils';

/**
 * Alarms, organised so the page answers its own questions.
 *
 * The old page was a six-column table sorted by state, with the AWS alarm name in the second column and
 * a truncated CloudWatch sentence in the last. It showed everything and told an operator nothing: not how
 * many alarms there were, not how many needed attention, not what they watched.
 *
 * Now: a count of every state at the top, filters that are links (so a view is shareable and the back
 * button works), grouping by the service the namespace names, and rows that say what they watch.
 *
 * **An alarm AWS could not evaluate is never folded into OK.** It is its own count, its own filter and
 * its own grey — because a dashboard that reports health it has not got is worse than one that reports
 * nothing.
 */

/** An alarm's state, mapped onto the five OpsWatch states so the bar reads like every other bar. */
function toGroup(counts: { OK: number; ALARM: number; INSUFFICIENT_DATA: number; total: number }): GroupHealth {
  return {
    // AWS evaluated these, so green is earned; the ones it could not are `unknown`, never healthy.
    state: counts.ALARM > 0 ? 'critical' : counts.INSUFFICIENT_DATA > 0 ? 'unknown' : counts.total > 0 ? 'healthy' : 'unknown',
    counts: { healthy: counts.OK, warning: 0, critical: counts.ALARM, unknown: counts.INSUFFICIENT_DATA, stale: 0 },
    total: counts.total,
  };
}

function hrefWith(scope: MonitoringScope, filter: AlarmFilter, changes: Partial<AlarmFilter>): string {
  const next = { ...filter, ...changes };
  const params = new URLSearchParams();
  if (next.state !== 'all') params.set('state', next.state);
  if (next.service !== 'all') params.set('svc', next.service);
  if (next.recent) params.set('recent', '1');
  if (next.showTargetTracking) params.set('tt', '1');
  if (next.search) params.set('q', next.search);
  const query = params.toString();
  return `${subsectionPath(scope, 'alarms', 'list')}${query ? `?${query}` : ''}`;
}

export async function AlarmsCard({ scope, filter, nowMs }: { scope: MonitoringScope; filter: AlarmFilter; nowMs: number }) {
  const t = await getTranslations('Monitoring.alarms');
  const target = await resolveTarget(scope);
  if (!target.ok) {
    return (
      <MonitoringCard title={t('cardTitle')}>
        <FailureNotice failure={target} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }
  const alarms = await listAlarms(target.data);
  if (!alarms.ok) {
    return (
      <MonitoringCard title={t('cardTitle')}>
        <FailureNotice failure={alarms} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  // Target-tracking alarms fire as part of normal autoscaling, so they stay out of the counts unless the
  // operator asks for them — otherwise every scaling estate reads as permanently alarmed.
  const considered = alarms.data.filter((alarm) => filter.showTargetTracking || !alarm.targetTracking);
  const counts = countStates(considered);
  const rows = filterAlarms(alarms.data, filter, nowMs);
  const hiddenTargetTracking = filter.showTargetTracking ? 0 : alarms.data.length - considered.length;

  if (alarms.data.length === 0) {
    return (
      <MonitoringCard title={t('cardTitle')} description={t('noneDescription')}>
        <p className="text-sm">{t('none')}</p>
        <p className="mt-2">
          <DocLink slug="alarms" label={t('readGuide')} />
        </p>
      </MonitoringCard>
    );
  }

  const stateTab = (state: (typeof ALARM_STATE_FILTERS)[number]) => {
    const count = state === 'all' ? counts.total : counts[state as AlarmState];
    const current = filter.state === state;
    return (
      <Link
        key={state}
        href={hrefWith(scope, filter, { state })}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'rounded-md border px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
          current ? 'border-primary/40 bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
        )}
      >
        {t(`filters.states.${state}`)} <span className="tabular-nums">{count}</span>
      </Link>
    );
  };

  // Only services that actually have an alarm: a filter for a service nobody uses is a dead control.
  const present = ALARM_SERVICES.filter((service) => considered.some((alarm) => serviceOf(alarm) === service));
  const grouped = new Map<AlarmService, AlarmSummary[]>();
  for (const alarm of rows) {
    const service = serviceOf(alarm);
    grouped.set(service, [...(grouped.get(service) ?? []), alarm]);
  }

  return (
    <div className="space-y-6">
      <MonitoringCard title={<span className="sr-only">{t('cardTitle')}</span>}>
        <div className="space-y-4">
          <StatusBar group={toGroup(counts)} />
          <div className="flex flex-wrap gap-2">{ALARM_STATE_FILTERS.map(stateTab)}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={hrefWith(scope, filter, { recent: !filter.recent })}
              aria-pressed={filter.recent}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                filter.recent ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-accent',
              )}
            >
              {t('filters.recent')}
            </Link>
            {present.map((service) => (
              <Link
                key={service}
                href={hrefWith(scope, filter, { service: filter.service === service ? 'all' : service })}
                aria-pressed={filter.service === service}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  filter.service === service ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-accent',
                )}
              >
                {t(`services.${service}`)}
              </Link>
            ))}
          </div>
          {/* The distinction nobody is born knowing, in one sentence with somewhere to read more. */}
          <p className="text-xs text-muted-foreground">
            {t('vsProblems')} <DocLink slug="alarms" label={t('readGuide')} />
          </p>
        </div>
      </MonitoringCard>

      {rows.length === 0 ? (
        <MonitoringCard title={t('noMatchTitle')}>
          <p className="text-sm text-muted-foreground">{t('noMatch')}</p>
          <p className="mt-2">
            <Link href={hrefWith(scope, filter, { state: 'all', service: 'all', recent: false, search: '' })} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t('clearFilters')}
            </Link>
          </p>
        </MonitoringCard>
      ) : (
        [...grouped.entries()].map(([service, serviceAlarms]) => (
          <MonitoringCard key={service} title={t(`services.${service}`)} description={t('inGroup', { count: serviceAlarms.length })}>
            <ul>
              {serviceAlarms.map((alarm) => (
                <AlarmRow
                  key={alarm.name}
                  alarm={alarm}
                  href={`${subsectionPath(scope, 'alarms', 'list')}/${encodeURIComponent(alarm.name)}`}
                />
              ))}
            </ul>
          </MonitoringCard>
        ))
      )}

      {hiddenTargetTracking > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('hiddenTargetTracking', { count: hiddenTargetTracking })}{' '}
          <Link href={hrefWith(scope, filter, { showTargetTracking: true })} className="font-medium text-primary underline-offset-4 hover:underline">
            {t('showHidden')}
          </Link>
        </p>
      )}
    </div>
  );
}
