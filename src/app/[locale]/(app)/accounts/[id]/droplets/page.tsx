import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { findConnection } from '@/lib/connections/repository';
import { doTargetFrom } from '@/lib/do/target';
import { getDb } from '@/lib/db/client';
import { listDroplets } from '@/lib/do/droplets';
import { BANDWIDTH_DROPLET_CAP, DO_AGENT_METRICS, dropletBandwidth, latestBandwidth } from '@/lib/do/metrics';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/** Fifteen minutes, the same window the Google page uses, so the two read as one product. */
const BANDWIDTH_WINDOW_MS = 15 * 60_000;

type Props = { params: Promise<{ locale: string; id: string }> };

export const generateMetadata = localizedTitle('DoDroplets.title');

/**
 * The droplets of a DigitalOcean account.
 *
 * On the connection, for the same reason Google's instances are: the monitoring rail's ten sections
 * are ten AWS services, and carrying another provider through it would offer pages that can never hold
 * anything. Read live, with no collector behind it, and the page says so rather than letting a figure
 * look older or newer than it is.
 */
export default async function DropletsPage({ params }: Props) {
  await initProtectedRoute(params);
  const { id } = await params;
  const db = getDb();
  const row = findConnection(db, id);
  if (row === null || row.provider !== 'do') notFound();

  const t = await getTranslations('DoDroplets');
  const format = await getFormatter();
  // Resolved rather than decrypted inline: a connection with no token and one whose token will not
  // decrypt are different problems with different fixes, and `readDoToken` answers null for both.
  const target = doTargetFrom(row);
  const result = target.ok ? await listDroplets({ token: target.data.token }) : null;
  const failure = target.ok ? (result !== null && !result.ok ? result.reason : null) : target.code === 'SecretChanged' ? 'secret_changed' : 'not_ready';

  /*
   * Public bandwidth for the droplets that were found.
   *
   * Its failure is kept apart from the list's: a token can be allowed to read droplets and not
   * metrics, and a list that was read is worth showing whatever the metric call said.
   */
  const nowMs = pageNow();
  const droplets = result !== null && result.ok ? result.data : [];
  const bandwidth =
    target.ok && droplets.length > 0
      ? await dropletBandwidth({
          target: target.data,
          dropletIds: droplets.map((droplet) => droplet.id),
          startMs: nowMs - BANDWIDTH_WINDOW_MS,
          endMs: nowMs,
        })
      : null;
  const series = new Map((bandwidth !== null && bandwidth.ok ? bandwidth.data : []).map((entry) => [entry.dropletId, entry]));

  return (
    <PageBody>
      <Link href={`/accounts/${row.id}`} className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <PageHeader title={t('title', { name: row.name })} description={t('description')} />

      <SectionCard title={t('listTitle')} description={t('listHint')}>
        {failure !== null || result === null || !result.ok ? (
          // Why there is nothing, never an empty table.
          <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`failures.${failure ?? 'error'}`)}</p>
        ) : result.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.bandwidth')}</TableHead>
                <TableHead>{t('columns.region')}</TableHead>
                <TableHead>{t('columns.size')}</TableHead>
                <TableHead>{t('columns.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((droplet) => (
                <TableRow key={droplet.id}>
                  <TableCell className="font-medium">
                    <span className="block">{droplet.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{droplet.id}</span>
                  </TableCell>
                  {/* DigitalOcean's own word, which is what their console shows too. */}
                  <TableCell className={cn(droplet.status === 'active' ? TONE_TEXT.success : 'text-muted-foreground')}>{droplet.status}</TableCell>
                  <TableCell>
                    {(() => {
                      const entry = series.get(droplet.id);
                      const inbound = latestBandwidth(entry, 'inbound');
                      const outbound = latestBandwidth(entry, 'outbound');
                      /*
                       * Nothing measured is nothing shown. A droplet past the read cap, or one
                       * DigitalOcean reported no samples for, must not be drawn at 0 Mbps — that is a
                       * silent machine and a machine nobody looked at, made to look identical.
                       */
                      if (inbound === null && outbound === null) {
                        return (
                          <span className="text-muted-foreground">
                            {bandwidth !== null && !bandwidth.ok ? t(`bandwidthFailures.${bandwidth.reason}`) : t('notReported')}
                          </span>
                        );
                      }
                      const mbps = (value: number | null) => (value === null ? t('notReported') : format.number(value, { maximumFractionDigits: 2 }));
                      return (
                        <span className="block text-sm tabular-nums">
                          {t('bandwidthValue', { inbound: mbps(inbound), outbound: mbps(outbound) })}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{droplet.region ?? t('notReported')}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {droplet.size ?? t('notReported')}
                    {droplet.memoryMb !== null && droplet.vcpus !== null && (
                      <span className="block text-xs">{t('sizeDetail', { memory: droplet.memoryMb, vcpus: droplet.vcpus })}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {droplet.createdAt === null ? t('notReported') : format.relativeTime(new Date(droplet.createdAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t('readNow')}</p>
        {/* Which figures DigitalOcean measures from outside the droplet and which it does not. Said,
            rather than left as an absent column — and deliberately not the same list as Google's,
            because CPU is agentless there and is not here. */}
        <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <p>{t('agentless')}</p>
          <p>{t('needsAgent', { metrics: format.list(DO_AGENT_METRICS.map((metric) => t(`agentMetrics.${metric}`)), { type: 'conjunction' }) })}</p>
          {bandwidth !== null && bandwidth.ok && bandwidth.truncated && <p>{t('bandwidthCapped', { count: BANDWIDTH_DROPLET_CAP })}</p>}
        </div>
      </SectionCard>
    </PageBody>
  );
}
