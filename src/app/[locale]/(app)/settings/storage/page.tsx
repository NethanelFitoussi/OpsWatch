import { getFormatter, getTranslations } from 'next-intl/server';
import path from 'node:path';
import { DocLink } from '@/components/docs/doc-link';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { readHistorySettings } from '@/lib/history/settings';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import { readStorageState } from '@/lib/read/storage-state';
import { STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Settings.storage.title');

/**
 * Where OpsWatch keeps what it has collected, and whether that is safe (§F).
 *
 * One page for a question an operator had to answer from three: the data directory was on the backup
 * page, the schema version on System status, the history switch on its own page, and nothing joined
 * them up.
 *
 * **There is no "Run migrations" button, and that is the honest answer rather than a missing feature.**
 * OpsWatch applies its own packaged migrations when it starts, after copying the database, so a schema
 * change is something an operator observes rather than triggers. A button would either do nothing —
 * because the migrations already ran — or invite somebody to run a schema change against a database the
 * process has open, from a browser. The page says when a restart will apply something, and what was
 * copied before the last one.
 *
 * And it offers one storage backend, because there is one. A page listing "External PostgreSQL" or
 * "AWS" as choices would be claiming support nobody has written.
 */
export default async function StorageSettingsPage({ params }: Props) {
  await initProtectedRoute(params);
  const t = await getTranslations('Settings.storage');
  const format = await getFormatter();

  const dataDir = env().OPSWATCH_DATA_DIR;
  const state = readStorageState(getDb(), { dataDir, migrationsFolder: path.join(process.cwd(), 'drizzle') });
  const history = readHistorySettings(getDb());
  const size = state.bytes === null ? null : formatMetricValue(state.bytes, 'bytes', 'en');

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <MonitoringCard title={t('whereTitle')} description={t('whereHint')}>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{t('kind')}</dt>
            {/* Named, because "the database" is not an answer to "which database". */}
            <dd className="mt-0.5 text-sm font-medium">{t('sqlite')}</dd>
          </div>
          <div className="min-w-0 rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{t('size')}</dt>
            {/* Null, not zero: a file that could not be measured is not an empty database. */}
            <dd className="mt-0.5 text-sm font-medium">{size ?? t('notMeasured')}</dd>
          </div>
          <div className="min-w-0 rounded-lg border p-3 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t('dataDir')}</dt>
            <dd className="mt-0.5 font-mono text-xs break-all">{state.where.dataDir}</dd>
          </div>
          <div className="min-w-0 rounded-lg border p-3 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t('persistence')}</dt>
            {/* The hint belongs *inside* the description: a <p> beside <dt> and <dd> is not a
                definition list, and a screen reader is told the term has no description. */}
            <dd className={cn('mt-0.5 text-sm font-medium', state.where.persistent ? STATE_TEXT.healthy : STATE_TEXT.critical)}>
              {state.where.persistent ? t('persistent') : t('disposable')}
              {!state.where.persistent && <span className="mt-1 block text-sm font-normal text-muted-foreground">{t('disposableHint')}</span>}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">{t('onlyPlace')}</p>
      </MonitoringCard>

      <MonitoringCard title={t('schemaTitle')} description={t('schemaHint')}>
        {state.schema.pending === null ? (
          // Cannot tell is its own answer, and it is not "up to date".
          <p className="text-sm">{t('schemaUnknown')}</p>
        ) : state.schema.pending === 0 ? (
          <p className={cn('text-sm font-medium', STATE_TEXT.healthy)}>{t('schemaCurrent', { applied: state.schema.applied ?? 0 })}</p>
        ) : (
          <p className="text-sm font-medium">{t('schemaPending', { count: state.schema.pending })}</p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">{t('schemaWhen')}</p>
        {state.lastMigrationBackup !== null && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t('lastMigrationBackup', {
              name: state.lastMigrationBackup.name,
              when: format.relativeTime(new Date(state.lastMigrationBackup.createdAt)),
            })}
          </p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">{t('noSql')}</p>
      </MonitoringCard>

      <MonitoringCard title={t('historyTitle')} description={t('historyHint')}>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{t('collecting')}</dt>
            <dd className={cn('mt-0.5 text-sm font-medium', history.enabled ? STATE_TEXT.healthy : 'text-muted-foreground')}>
              {history.enabled ? t('collectingOn') : t('collectingOff')}
            </dd>
          </div>
          <div className="min-w-0 rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{t('retention')}</dt>
            {/* Meaningless while nothing is being kept, and saying "30 days" would imply otherwise. */}
            <dd className="mt-0.5 text-sm font-medium">
              {history.enabled ? t('retentionDays', { days: history.retentionDays }) : t('retentionOff')}
            </dd>
          </div>
        </dl>
        <p className="mt-3">
          <Link href="/settings/history" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t('changeHistory')}
          </Link>
        </p>
      </MonitoringCard>

      <MonitoringCard title={t('backupsTitle')} description={t('backupsHint')}>
        <p className="text-sm">
          {state.backups.length === 0
            ? t('noBackups')
            : t('backupCount', { count: state.backups.length, when: format.relativeTime(new Date(state.backups[0].createdAt)) })}
        </p>
        <p className="mt-3">
          <Link href="/settings/backup" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t('goBackup')}
          </Link>
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          <DocLink slug="history" label={t('readGuide')} />
        </p>
      </MonitoringCard>
    </PageBody>
  );
}
