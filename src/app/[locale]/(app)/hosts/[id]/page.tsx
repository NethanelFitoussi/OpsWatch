import { Trash2 } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { SectionCard } from '@/components/section-card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { findHost, listSamples, toHost } from '@/lib/store/hosts';
import { STATE_TEXT, TONE_BORDER } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { deleteHostAction, renameHostAction } from '../actions';
import { RenameHostForm } from '../host-forms';

type Props = { params: Promise<{ locale: string; id: string }> };

export const generateMetadata = localizedTitle('Hosts.detail.title');

const STATE_WORD = { healthy: STATE_TEXT.healthy, stale: STATE_TEXT.stale, waiting: STATE_TEXT.unknown, unknown: STATE_TEXT.unknown } as const;

/** One figure, with "not measured" where the agent could not read it — never a zero standing in. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

/**
 * One Linux host: what it is, what it last measured, and how to stop watching it.
 *
 * Every figure the agent could not read is absent rather than zero. A kernel that does not publish a
 * value, a container that hides one, a first run with no previous reading to difference a CPU rate
 * against — all of them are "not measured", and a page that printed 0% CPU for the third would be
 * showing a number nobody took.
 */
export default async function HostDetailPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const { id } = await params;
  const t = await getTranslations('Hosts');
  const format = await getFormatter();

  const row = findHost(getDb(), id);
  if (row === null) notFound();

  const nowMs = pageNow();
  const samples = listSamples(getDb(), id, 2);
  const host = toHost(row, samples[0] ?? null, nowMs);
  const notMeasured = t('detail.notMeasured');
  const bytes = (value: number | null) => (value === null ? notMeasured : formatMetricValue(value, 'bytes', locale));

  return (
    <PageBody>
      <PageHeader title={host.name} description={t('detail.description')} />
      <p>
        <Link href="/hosts" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {t('detail.back')}
        </Link>
      </p>

      <MonitoringCard title={t('detail.stateTitle')}>
        <p className={cn('text-sm font-medium', STATE_WORD[host.state])}>{t(`states.${host.state}`)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {host.lastSeenAt === null ? t('detail.neverReportedHint') : t('lastReport', { when: format.relativeTime(new Date(host.lastSeenAt)) })}
        </p>
        {host.state === 'stale' && <p className="mt-2 text-sm">{t('detail.staleHint')}</p>}
        {host.state === 'waiting' && <p className="mt-2 text-sm">{t('detail.waitingHint')}</p>}
      </MonitoringCard>

      <MonitoringCard title={t('detail.machineTitle')} description={t('detail.machineHint')}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('detail.hostname')} value={host.hostname ?? notMeasured} />
          <Fact label={t('detail.os')} value={host.os ?? notMeasured} />
          <Fact label={t('detail.kernel')} value={host.kernel ?? notMeasured} />
          <Fact label={t('detail.arch')} value={host.arch ?? notMeasured} />
          <Fact label={t('detail.cloud')} value={host.cloud === 'unknown' ? t('clouds.unknown') : t(`clouds.${host.cloud}`)} />
          {/* The provider's own id, which is what a host is matched to an EC2 instance on — never a hostname. */}
          <Fact label={t('detail.cloudInstanceId')} value={host.cloudInstanceId ?? notMeasured} />
          <Fact label={t('detail.agentVersion')} value={host.agentVersion ?? notMeasured} />
        </dl>
      </MonitoringCard>

      <MonitoringCard title={t('detail.latestTitle')} description={t('detail.latestHint')}>
        {host.latest === null ? (
          <p className="text-sm text-muted-foreground">{t('detail.noReadings')}</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Fact
                label={t('detail.cpu')}
                value={host.latest.cpuPercent === null ? notMeasured : `${host.latest.cpuPercent.toFixed(1)}%`}
              />
              <Fact
                label={t('detail.memory')}
                value={
                  host.latest.memoryUsedBytes === null || host.latest.memoryTotalBytes === null
                    ? notMeasured
                    : t('memoryOf', { used: bytes(host.latest.memoryUsedBytes), total: bytes(host.latest.memoryTotalBytes) })
                }
              />
              <Fact
                label={t('detail.load')}
                value={
                  host.latest.load1 === null
                    ? notMeasured
                    : `${host.latest.load1.toFixed(2)} · ${(host.latest.load5 ?? 0).toFixed(2)} · ${(host.latest.load15 ?? 0).toFixed(2)}`
                }
              />
              <Fact
                label={t('detail.uptime')}
                value={host.latest.uptimeSeconds === null ? notMeasured : t('detail.days', { days: Math.floor(host.latest.uptimeSeconds / 86400) })}
              />
            </dl>

            {host.latest.disks.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">{t('detail.disks')}</p>
                <ul className="divide-y rounded-lg border">
                  {host.latest.disks.map((disk) => (
                    <li key={disk.mount} className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-2 text-sm">
                      <span className="font-mono text-xs break-all">{disk.mount}</span>
                      <span className="text-muted-foreground">
                        {disk.usedBytes === null || disk.totalBytes === null
                          ? notMeasured
                          : t('memoryOf', { used: bytes(disk.usedBytes), total: bytes(disk.totalBytes) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {t('detail.measuredAt', { when: format.relativeTime(new Date(host.latest.at)) })}
            </p>
          </>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('detail.renameTitle')}>
        <RenameHostForm action={renameHostAction.bind(null, locale, host.id)} name={host.name} />
      </MonitoringCard>

      <SectionCard
        title={t('detail.removeTitle')}
        description={t('detail.removeHint')}
        className={cn('ring-0 border', TONE_BORDER.danger)}
        action={
          <form action={deleteHostAction.bind(null, locale, host.id)}>
            <Button type="submit" variant="destructive">
              <Trash2 className="size-4" aria-hidden /> {t('detail.remove')}
            </Button>
          </form>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('detail.removeReadings')}</li>
          {/* The agent on the machine keeps running until somebody removes it, and OpsWatch says so. */}
          <li>{t('detail.removeAgent')}</li>
        </ul>
      </SectionCard>
    </PageBody>
  );
}
