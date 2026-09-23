import { getFormatter, getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { localizedTitle } from '@/i18n/metadata';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { listAudit, type AuditAction } from '@/lib/store/audit';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ action?: string }> };

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

  const asked = (await searchParams).action;
  const rows = listAudit(getDb(), asked === undefined ? {} : { action: asked as AuditAction }, LIMIT);

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

      <MonitoringCard title={t('entries', { count: rows.length })}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('when')}</TableHead>
                  <TableHead>{t('action')}</TableHead>
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
