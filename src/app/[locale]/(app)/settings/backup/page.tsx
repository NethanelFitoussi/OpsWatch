import { getFormatter, getTranslations } from 'next-intl/server';
import { DocLink } from '@/components/docs/doc-link';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { CodeBlock } from '@/components/code-block';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { BACKUP_KEEP, backupsDir, listBackups } from '@/lib/db/backup';
import { describeStorage } from '@/lib/db/storage';
import { env } from '@/lib/env';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { createBackupAction } from './actions';
import { BackupForm } from './form';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Settings.backup.title');

/**
 * Backup and restore (HIS-10, §F).
 *
 * The page answers four questions an operator actually has, in the order they have them: where is my
 * data, what has been backed up, how do I take one now, and how do I put one back.
 *
 * It says two uncomfortable things plainly rather than burying them:
 *
 *   - **a backup is the whole database**, including every encrypted credential, so the file is as
 *     sensitive as the instance itself;
 *   - **it is useless without `OPSWATCH_SECRET`**, which is deliberately not in it. An operator who
 *     backs up the database and loses the secret has backed up something they cannot restore.
 *
 * And it does not offer a restore button. A running process cannot safely write over the database it has
 * open, and a restore that half-succeeds is worse than one that never ran, so what is offered is the
 * procedure.
 */
export default async function BackupSettingsPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Settings.backup');
  const format = await getFormatter();

  const dataDir = env().OPSWATCH_DATA_DIR;
  const storage = describeStorage(dataDir);
  const backups = listBackups(backupsDir(dataDir));

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <MonitoringCard title={t('whereTitle')} description={t('whereHint')}>
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-muted-foreground">{t('dataDir')}</dt>
            <dd className="font-mono text-xs break-all">{storage.dataDir}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-muted-foreground">{t('filesystem')}</dt>
            <dd className="font-mono text-xs break-all">{storage.filesystem || t('unknownFilesystem')}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-muted-foreground">{t('persistence')}</dt>
            {/* The one fact that decides whether any of this matters, said in words rather than in a tick. */}
            <dd className={cn(storage.persistent ? STATE_TEXT.healthy : STATE_TEXT.critical)}>
              {storage.persistent ? t('persistent') : t('disposable')}
            </dd>
          </div>
        </dl>
      </MonitoringCard>

      <MonitoringCard title={t('createTitle')} description={t('createHint', { keep: BACKUP_KEEP })}>
        <BackupForm action={createBackupAction.bind(null, locale)} />
        <p className="mt-3 text-sm text-muted-foreground">{t('sensitive')}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t('secretWarning')}</p>
      </MonitoringCard>

      <MonitoringCard title={t('listTitle')}>
        {backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <ul className="divide-y">
            {backups.map((backup) => (
              <li key={backup.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span className="min-w-0 font-mono text-xs break-all">{backup.name}</span>
                <span className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{formatMetricValue(backup.bytes, 'bytes', locale)}</span>
                  <span>{format.relativeTime(new Date(backup.createdAt))}</span>
                  {/* Downloaded, never rendered: it is a database, and the browser must not try to read it. */}
                  <a href={`/api/backups/${encodeURIComponent(backup.name)}`} download className="underline underline-offset-4">
                    {t('download')}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('restoreTitle')} description={t('restoreHint')}>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>{t('restore.0')}</li>
          <li>{t('restore.1')}</li>
          <li>{t('restore.2')}</li>
          <li>{t('restore.3')}</li>
        </ol>
        <div className="mt-3">
          <CodeBlock value={`docker compose stop opswatch\ncp ${backupsDir(dataDir)}/<backup>.sqlite ${dataDir}/opswatch.sqlite\nrm -f ${dataDir}/opswatch.sqlite-wal ${dataDir}/opswatch.sqlite-shm\ndocker compose start opswatch`} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{t('restoreWal')}</p>
        <p className="mt-3">
          <DocLink slug="backup" label={t('readGuide')} />
        </p>
      </MonitoringCard>

      <MonitoringCard title={t('migrationTitle')}>
        <p className="text-sm">{t('migration', { keep: BACKUP_KEEP })}</p>
      </MonitoringCard>
    </PageBody>
  );
}
