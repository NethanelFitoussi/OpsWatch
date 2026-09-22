import { getFormatter, getTranslations } from 'next-intl/server';
import type { Health, HealthStatus } from '@opswatch/contract';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Link } from '@/i18n/navigation';
import { subsectionPath, type ScopeRef } from '@/lib/monitoring/shared/paths';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<HealthStatus, string> = {
  critical: TONE_TEXT.danger,
  degraded: TONE_TEXT.warning,
  // Not green: "we could not look" must never read like "everything is fine".
  unknown: 'text-muted-foreground',
  healthy: TONE_TEXT.success,
};

/**
 * The Health page.
 *
 * Its whole job is one distinction: **"production is healthy" and "OpsWatch cannot tell you whether
 * production is healthy" are different answers.** `unknown` is therefore never styled as good news, every
 * family says whether it was actually read, and a count that was not measured shows as such rather than as 0.
 */
export async function HealthSummary({ health, scope, nowMs }: { health: Health; scope: ScopeRef; nowMs: number }) {
  const t = await getTranslations('Monitoring.health');
  const tSeverity = await getTranslations('Insights.severity');
  const format = await getFormatter();
  const number = (value: number | null) => (value === null ? t('notMeasured') : String(value));

  return (
    <>
      <MonitoringCard title={t('title')} description={t('description')}>
        <p className={cn('text-lg font-medium', STATUS_CLASS[health.status])}>{t(`status.${health.status}`)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t(`statusHint.${health.status}`)}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t('counts.critical')}</dt>
            <dd className="tabular-nums">{health.counts.critical}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('counts.warning')}</dt>
            <dd className="tabular-nums">{health.counts.warning}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('counts.services')}</dt>
            <dd className="tabular-nums">
              {health.counts.totalServices === null
                ? t('counts.notMeasured')
                : `${number(health.counts.healthyServices)} / ${health.counts.totalServices}`}
            </dd>
          </div>
        </dl>
      </MonitoringCard>

      <MonitoringCard title={t('families')}>
        <ul className="divide-y">
          {health.families.map((family) => (
            <li key={family.family} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm">
              <span className="font-medium">{family.label}</span>
              <span className="flex items-baseline gap-4">
                <span className="text-muted-foreground">
                  {family.total === null ? t('unread') : t('affected', { affected: family.affected ?? 0, total: family.total })}
                </span>
                <span className={cn(STATUS_CLASS[family.status])}>{t(`familyStatus.${family.status}`)}</span>
              </span>
              {/* Why it could not be read, in words, not a provider token. */}
              {family.unavailable && (
                <p className="w-full text-muted-foreground">{family.unavailable.message ?? family.unavailable.reason}</p>
              )}
            </li>
          ))}
        </ul>
      </MonitoringCard>

      <MonitoringCard title={t('topProblem')}>
        {health.topProblem === null ? (
          <p className="text-sm text-muted-foreground">{t('noProblems')}</p>
        ) : (
          <Link
            href={subsectionPath(scope, 'overview', 'problems', health.topProblem.id)}
            className="group flex flex-wrap items-baseline gap-3 text-sm"
          >
            <SeverityBadge severity={health.topProblem.severity} label={tSeverity(health.topProblem.severity)} />
            <span className="group-hover:underline">{health.topProblem.title}</span>
          </Link>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('changes')}>
        {health.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noChanges')}</p>
        ) : (
          <ul className="divide-y">
            {health.changes.map((change) => (
              <li key={change.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <span>{change.text}</span>
                {change.at !== undefined && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format.relativeTime(new Date(change.at), new Date(nowMs))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>
    </>
  );
}
