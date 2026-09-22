import { getFormatter, getTranslations } from 'next-intl/server';
import type { ErrorSummary } from '@opswatch/contract';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import { subsectionPath, type ScopeRef } from '@/lib/monitoring/shared/paths';

/**
 * The Errors list: groups, not occurrences.
 *
 * A count is always shown with the window it was counted over, because a number without one is not a count —
 * "2,417" means nothing until you know whether it is today or for ever.
 */
export async function ErrorTable({
  errors,
  scope,
  nowMs,
}: {
  errors: readonly ErrorSummary[];
  scope: ScopeRef;
  nowMs: number;
}) {
  const t = await getTranslations('Monitoring.errors');
  const format = await getFormatter();

  return (
    <ul className="divide-y">
      {errors.map((error) => (
        <li key={error.id} className="py-3">
          <Link
            href={subsectionPath(scope, 'errors', 'groups', error.id)}
            className="group flex flex-col gap-1 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
                {t(`status.${error.status}`)}
              </span>
              {error.type && <span className="font-mono text-xs">{error.type}</span>}
              {error.trend && <span className="text-xs text-muted-foreground">{t(`trend.${error.trend}`)}</span>}
            </span>
            <span className="min-w-0 text-sm group-hover:underline">{error.message}</span>
            <span className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              <span>
                {/* Never a bare number: the window is part of the fact. */}
                {error.occurrences === null ? t('occurrencesUnknown') : t('occurrences', { count: error.occurrences })}
              </span>
              {error.affectedInstances !== null && <span>{t('instances', { count: error.affectedInstances })}</span>}
              <span>
                {error.status === 'regression' && error.statusSince !== undefined
                  ? `${t('cameBack')} ${format.relativeTime(new Date(error.statusSince), new Date(nowMs))}`
                  : `${t('firstSeen')} ${format.relativeTime(new Date(error.firstSeenAt), new Date(nowMs))}`}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The three sets of §4.4, which are what a reader scans first. */
export async function WhatsNew({
  sets,
  scope,
  nowMs,
}: {
  sets: { new: ErrorSummary[]; regressed: ErrorSummary[]; spiking: ErrorSummary[] };
  scope: ScopeRef;
  nowMs: number;
}) {
  const t = await getTranslations('Monitoring.errors');
  const groups = [
    { key: 'setNew', errors: sets.new },
    { key: 'setRegressed', errors: sets.regressed },
    { key: 'setSpiking', errors: sets.spiking },
  ] as const;

  return (
    <MonitoringCard title={t('whatsNew')}>
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((group) => (
          <section key={group.key}>
            <h3 className="text-sm font-medium">{t(group.key)}</h3>
            {group.errors.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">{t('none')}</p>
            ) : (
              <ErrorTable errors={group.errors} scope={scope} nowMs={nowMs} />
            )}
          </section>
        ))}
      </div>
    </MonitoringCard>
  );
}
