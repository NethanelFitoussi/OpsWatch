import { ArrowRight } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Link } from '@/i18n/navigation';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import type { Workspace } from '@/lib/read/workspace';

/**
 * The two questions the problem page could not answer (INV-5, §R).
 *
 * **Has this happened before?** Earlier resolved occurrences of the same fault, how long each stayed
 * open, and the typical time to resolve. "No, this is the first time" is only worth saying beside how far
 * back the record goes — on an instance that started yesterday it means nothing — so the two sentences
 * are never separated.
 *
 * **Where do I read the actual log lines?** A link into the Logs search with the log groups OpsWatch is
 * already reading for this service, pre-selected. Only those: offering to search a group nobody selected
 * would be offering to spend money on a guess about where this service writes.
 *
 * And the error groups seen on the same service since the problem opened — where `null` (nothing is being
 * read) and `[]` (nothing was found) are two different sentences.
 */
export async function WorkspacePanel({
  workspace,
  scope,
  locale,
  problemOpenedAt,
  nowMs,
}: {
  workspace: Workspace;
  scope: MonitoringScope;
  locale: string;
  problemOpenedAt: number;
  /** The page's clock, passed in rather than read here: a component is not where a clock belongs. */
  nowMs: number;
}) {
  const t = await getTranslations({ locale, namespace: 'Monitoring.workspace' });
  const tSeverity = await getTranslations({ locale, namespace: 'Insights.severity' });
  const format = await getFormatter({ locale });
  const when = (at: number) => format.dateTime(new Date(at), { dateStyle: 'medium', timeStyle: 'short' });
  const lasted = (ms: number) => format.relativeTime(new Date(0), new Date(ms)).replace(/^in /, '');

  // The range that covers the problem so far, from the ones the Logs search actually offers. The longest
  // available is used when the problem is older than all of them, and the label says which was chosen.
  const ranges = [
    { id: '1h', ms: 60 * 60_000 },
    { id: '3h', ms: 3 * 60 * 60_000 },
    { id: '12h', ms: 12 * 60 * 60_000 },
    { id: '24h', ms: 24 * 60 * 60_000 },
  ] as const;
  const age = nowMs - problemOpenedAt;
  const range = ranges.find((one) => one.ms >= age) ?? ranges[ranges.length - 1];

  const logsHref = `${subsectionPath(scope, 'logs', 'search')}?${new URLSearchParams([
    ['range', range.id],
    ...workspace.logGroups.map((group) => ['group', group] as [string, string]),
  ]).toString()}`;

  return (
    <>
      <MonitoringCard title={t('pastTitle')} description={t('pastHint')}>
        {workspace.past.length === 0 ? (
          <p className="text-sm">
            {t('noPast')}{' '}
            <span className="text-muted-foreground">
              {/* Never on its own: without this, "first time" implies a clean record it cannot vouch for. */}
              {workspace.recordedSince === null
                ? t('recordedNothing')
                : t('recordedSince', { when: when(workspace.recordedSince) })}
            </span>
          </p>
        ) : (
          <>
            <ul className="divide-y">
              {workspace.past.map((occurrence) => (
                <li key={occurrence.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <Link
                    href={`${subsectionPath(scope, 'overview', 'problems')}/${occurrence.id}`}
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    {when(occurrence.firstSeenAt)}
                  </Link>
                  <span className="flex items-center gap-3 text-sm text-muted-foreground">
                    <SeverityBadge severity={occurrence.severity} label={tSeverity(occurrence.severity)} />
                    <span>{t('lasted', { duration: lasted(occurrence.durationMs) })}</span>
                    {occurrence.acknowledged && <span>{t('wasAcknowledged')}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {/* Median, not mean: one occurrence left open over a weekend would make an average useless. */}
            {workspace.typicalDurationMs !== null && (
              <p className="mt-3 text-sm text-muted-foreground">{t('typical', { duration: lasted(workspace.typicalDurationMs) })}</p>
            )}
          </>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('logsTitle')} description={t('logsHint')}>
        {workspace.logGroups.length === 0 ? (
          // Not a disabled link: OpsWatch does not know where this service writes, and guessing would be
          // guessing with somebody's Logs Insights bill.
          <p className="text-sm text-muted-foreground">{t('noLogGroups')}</p>
        ) : (
          <>
            <Link href={logsHref} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t('openLogs', { count: workspace.logGroups.length, range: t(`ranges.${range.id}`) })} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            <ul className="mt-2 flex flex-wrap gap-2">
              {workspace.logGroups.map((group) => (
                <li key={group} className="rounded-md border px-2 py-0.5 font-mono text-xs break-all">
                  {group}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-4 border-t pt-4">
          <p className="text-sm font-medium">{t('errorsTitle')}</p>
          {workspace.errors === null ? (
            // Nothing is being read, which is a different answer from nothing having been found.
            <p className="mt-1 text-sm text-muted-foreground">{t('errorsNotCollected')}</p>
          ) : workspace.errors.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">{t('errorsNone')}</p>
          ) : (
            <ul className="mt-2 divide-y">
              {workspace.errors.map((error) => (
                <li key={error.id} className="py-2 first:pt-0 last:pb-0">
                  <Link
                    href={`${subsectionPath(scope, 'errors', 'groups')}/${error.id}`}
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    {error.message}
                  </Link>
                  <p className="text-xs text-muted-foreground">{t('errorSeen', { when: when(error.lastSeenAt) })}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </MonitoringCard>
    </>
  );
}
