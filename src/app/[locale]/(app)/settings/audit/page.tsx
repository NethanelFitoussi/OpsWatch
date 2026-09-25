import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { localizedTitle } from '@/i18n/metadata';
import { requireAdmin } from '@/lib/auth/current';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { listAudit, type AuditAction } from '@/lib/store/audit';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ action?: string; connection?: string }> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Settings.audit.title');

/** How many rows one page shows. An audit log is read from the recent end, not paged to the beginning. */
const LIMIT = 200;

/**
 * Settings → Audit log (§21).
 *
 * Admin-only and append-only. The page states the second, because a log a reader cannot trust is not worth
 * reading — and "nothing here can be edited, including by OpsWatch" is the claim that makes it evidence.
 */
export default async function AuditPage({ params, searchParams }: Props) {
  const { locale } = await params;
  await requireAdmin(locale);
  const t = await getTranslations('Settings.audit');
  const format = await getFormatter();

  const query = await searchParams;
  const db = getDb();
  const accounts = listConnections(db);
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  // Three questions, not two: every account, one account, or the things that belong to no account at
  // all — signing in, a setting, a host. The last is the one a single filter box would hide.
  const chosen = query.connection === undefined || query.connection === '' ? undefined : query.connection === 'instance' ? null : query.connection;
  const rows = listAudit(
    db,
    {
      ...(query.action === undefined ? {} : { action: query.action as AuditAction }),
      ...(chosen === undefined ? {} : { connectionId: chosen }),
    },
    LIMIT,
  );

  const filters = [
    { key: '', label: t('filterAll'), current: query.connection === undefined || query.connection === '' },
    { key: 'instance', label: t('filterInstance'), current: query.connection === 'instance' },
    ...accounts.map((account) => ({ key: account.id, label: account.name, current: query.connection === account.id })),
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <MonitoringCard title={t('appendOnly')}>
        {/* The claim that makes the log evidence, stated where it is read. */}
        <p className="text-sm">{t('appendOnlyHint')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('privacy')}</p>
      </MonitoringCard>

      {/* Only worth a filter when there is something to choose between: one account and the
          installation's own actions is not a choice anybody needs help making. */}
      {accounts.length > 1 && (
        <MonitoringCard title={t('filterAccount')}>
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <Link
                key={filter.key}
                href={{ pathname: '/settings/audit', query: { ...(query.action === undefined ? {} : { action: query.action }), ...(filter.key === '' ? {} : { connection: filter.key }) } }}
                aria-current={filter.current ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 text-sm ${filter.current ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
              >
                {filter.label}
              </Link>
            ))}
          </div>
        </MonitoringCard>
      )}

      <MonitoringCard title={t('entries', { count: rows.length })}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('when')}</TableHead>
                  <TableHead>{t('actionColumn')}</TableHead>
                  <TableHead>{t('account')}</TableHead>
                  <TableHead>{t('actor')}</TableHead>
                  <TableHead>{t('result')}</TableHead>
                  <TableHead>{t('from')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      {format.dateTime(new Date(row.at), { dateStyle: 'short', timeStyle: 'medium' })}
                    </TableCell>
                    <TableCell>{t(`action.${row.action}`)}</TableCell>
                    {/* An account that has since been removed still has rows: the log outlives it, which
                        is the point of a log. Its name is gone, so the row says that rather than an id. */}
                    <TableCell className="text-muted-foreground">
                      {row.connectionId === null ? t('accountNone') : (names.get(row.connectionId) ?? t('accountGone'))}
                    </TableCell>
                    <TableCell>
                      {row.actorKind === 'system' ? t('system') : t('user', { id: row.actorUserId ?? 0 })}
                    </TableCell>
                    <TableCell>{t(`results.${row.result}`)}</TableCell>
                    {/* The IP, and a hash standing in for the device — never the user agent itself. */}
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {row.ip ?? t('notRecorded')}
                      {row.userAgentHash !== null && ` · ${row.userAgentHash.slice(0, 8)}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {rows.length === LIMIT && <p className="mt-2 text-xs text-muted-foreground">{t('truncated', { limit: LIMIT })}</p>}
          </div>
        )}
      </MonitoringCard>
    </div>
  );
}
