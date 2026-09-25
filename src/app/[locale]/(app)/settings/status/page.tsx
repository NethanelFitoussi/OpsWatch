import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { localizedTitle } from '@/i18n/metadata';
import { requireAdmin } from '@/lib/auth/current';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readSystemStatus } from '@/lib/read/system';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Settings.status.title');

/**
 * System status: what OpsWatch knows about itself (§21, Phase T).
 *
 * It reads only its own database, so it still answers when the thing it reports on is broken — which is the
 * point. The loudest thing on it is the case where the collector has never run, because then every other
 * page in the product is reporting on no knowledge at all.
 */
export default async function SystemStatusPage({ params }: Props) {
  const { locale } = await params;
  await requireAdmin(locale);
  const db = getDb();
  const t = await getTranslations('Settings.status');
  const format = await getFormatter();
  // One clock for the whole render, like every other page: `Date.now()` here is an impure call during render.
  const nowMs = pageNow();

  const status = readSystemStatus(db, {
    nowMs,
    environments: listConnections(db).flatMap((connection) =>
      connection.regions.map((scope) => ({ connectionId: connection.id, scope })),
    ),
    dataDir: env().OPSWATCH_DATA_DIR,
  });
  const when = (at: number | null) => (at === null ? '—' : format.relativeTime(new Date(at), new Date(nowMs)));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <MonitoringCard title={t('collector')}>
        {status.collector.neverRan ? (
          // The one state worth shouting about.
          <p className={cn('text-sm font-medium', TONE_TEXT.warning)}>{t('collectorNever')}</p>
        ) : (
          <p className={cn('text-sm font-medium', status.collector.alive ? TONE_TEXT.success : TONE_TEXT.warning)}>
            {status.collector.alive ? t('collectorAlive') : t('collectorStale')}
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{t('collectorHint')}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('lastHeartbeat')}</dt>
            <dd>{when(status.collector.heartbeatAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('version')}</dt>
            <dd className="tabular-nums">{status.version}</dd>
          </div>
        </dl>
      </MonitoringCard>

      <MonitoringCard title={t('jobs')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-4 font-medium">{t('job.name')}</th>
                <th scope="col" className="py-1 pr-4 font-medium">{t('job.status')}</th>
                <th scope="col" className="py-1 pr-4 font-medium">{t('job.last')}</th>
                <th scope="col" className="py-1 pr-4 font-medium">{t('job.covered')}</th>
                <th scope="col" className="py-1 font-medium">{t('job.next')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {status.jobs.map((job) => (
                <tr key={job.job}>
                  <th scope="row" className="py-1.5 pr-4 text-left font-normal">{job.job}</th>
                  <td className="py-1.5 pr-4">
                    {/* "Never run" is not a failure and not a success; it is its own answer. And the
                        word here is the **worst** of the environments, not the most recent, so a job
                        failing in one AWS account is never reported as ok because another succeeded. */}
                    {job.lastStatus === null ? t('jobStatus.never') : t(`jobStatus.${job.lastStatus}`)}
                    {job.truncated && <span className="ml-2 text-xs text-muted-foreground">{t('truncated')}</span>}
                    {job.environments !== undefined && job.environments.total > 1 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {job.environments.failing > 0
                          ? t('job.failingIn', { failing: job.environments.failing, total: job.environments.total })
                          : job.environments.neverRan > 0
                            ? t('job.notYetIn', { count: job.environments.neverRan })
                            : t('job.acrossAll', { count: job.environments.total })}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 whitespace-nowrap">{when(job.lastRunAt)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">
                    {job.covered === null || job.total === null ? '—' : t('coveredOf', { covered: job.covered, total: job.total })}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">{when(job.nextRunAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MonitoringCard>

      <MonitoringCard title={t('environments')}>
        <ul className="divide-y">
          {status.environments.map((environment) => (
            <li key={`${environment.connectionId}/${environment.scope}`} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
              <span>{environment.scope}</span>
              <span className="text-muted-foreground">
                {environment.lastReadAt === null
                  ? t('neverRead')
                  : `${t('environment.lastRead')} ${when(environment.lastReadAt)} · ${environment.familiesRead}/${environment.familiesTotal}`}
              </span>
            </li>
          ))}
        </ul>
      </MonitoringCard>

      <MonitoringCard title={t('database')}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('size')}</dt>
            <dd className="tabular-nums">
              {status.database.sizeBytes === null
                ? t('notMeasured')
                : format.number(Math.round(status.database.sizeBytes / 1024)) + ' KiB'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('schema')}</dt>
            <dd className="tabular-nums">{status.database.schemaVersion ?? t('notMeasured')}</dd>
          </div>
        </dl>
      </MonitoringCard>
    </div>
  );
}
