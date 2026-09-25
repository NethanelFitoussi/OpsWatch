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
import { findConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import { MetricChart } from '@/components/monitoring/metric-chart';
import { hostFindings } from '@/lib/monitoring/shared/host-findings';
import { hasReadings, hostSeries } from '@/lib/monitoring/shared/host-series';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { findHost, listSamples, toHost } from '@/lib/store/hosts';
import { STATE_TEXT, TONE_BORDER } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { deleteHostAction, renameHostAction, unlinkHostAction } from '../actions';
import { RenameHostForm, UnlinkHostForm } from '../host-forms';

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
  // A day's worth at the agent's five-minute interval. The store keeps a fortnight; the page shows the
  // part an operator is actually looking at.
  const samples = listSamples(getDb(), id, 288);
  const host = toHost(row, samples[0] ?? null, nowMs);
  const findings = hostFindings(host);
  // The AWS connection this machine was found in, where one has been. Null until somebody opens the
  // instances page of the account that holds it — OpsWatch does not go looking across every account.
  const connection = row.connectionId === null ? null : findConnection(getDb(), row.connectionId);

  // Only what was actually measured: a metric this kernel never published has no chart rather than an
  // empty box implying one should be there.
  const charts = (
    [
      { id: 'cpu', field: 'cpuPercent', title: t('detail.cpu'), unit: 'percent' as const },
      { id: 'memory', field: 'memoryUsedBytes', title: t('detail.memory'), unit: 'bytes' as const },
      // 'rate' rather than 'count': a load average is fractional, and 0.2 formatted as a count is 0.
      { id: 'load', field: 'load1', title: t('detail.load1'), unit: 'rate' as const },
    ] as const
  ).flatMap((one) => {
    const series = hostSeries(samples, one.field);
    return hasReadings(series) ? [{ ...one, series: { id: one.id, label: one.title, ...series } }] : [];
  });
  const notMeasured = t('detail.notMeasured');
  const bytes = (value: number | null) => (value === null ? notMeasured : formatMetricValue(value, 'bytes', locale));
  // Counts read as counts: 184,221 rather than 184221, in whichever grouping the locale uses.
  const count = (value: number | null) => (value === null ? notMeasured : format.number(value));

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
        {/* What needs attention, above everything the page then goes on to describe. */}
        {findings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {findings.map((finding) => (
              <li
                key={`${finding.kind}:${finding.subject}`}
                className={cn('text-sm font-medium', finding.level === 'critical' ? STATE_TEXT.critical : STATE_TEXT.warning)}
              >
                {t(`findings.${finding.kind}`, { subject: finding.subject, percent: Math.round(finding.percent ?? 0) })}
              </li>
            ))}
          </ul>
        )}
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
        {/*
          * One machine, two sources.
          *
          * The link is written when the instances page of the AWS account holding this instance is
          * rendered — matched on the id AWS gave it, which the agent read from the instance metadata
          * service, never on a hostname. Until somebody looks at that account OpsWatch has the id and
          * not the account, and says only what it knows.
          */}
        {connection !== null && host.cloudInstanceId !== null && (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <Link
              // The machine's own region, not the connection's first: a connection may read several,
              // and the instance is in exactly one of them.
              href={`/c/${connection.id}/${host.region ?? connection.regions[0]}/instances/list`}
              className="min-w-0 font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('detail.alsoInAws', {
                connection: connection.name,
                instance: host.cloudInstanceId,
                region: host.region ?? connection.regions[0],
              })}
            </Link>
            {/* The placement is sticky, so there has to be a way to undo one that is wrong. */}
            <UnlinkHostForm action={unlinkHostAction.bind(null, locale, host.id)} />
          </div>
        )}
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

      {/*
        * The last day, at the agent's own interval.
        *
        * Under the latest reading rather than instead of it: "what is it doing now" and "what has it
        * been doing" are two questions, and the second is the one that says whether the first is
        * normal. The lines break wherever the agent went quiet — a straight line across a gap would be
        * a measurement nobody took.
        */}
      {charts.length > 0 && (
        <MonitoringCard title={t('detail.historyTitle')} description={t('detail.historyHint')}>
          <div className="grid gap-6 lg:grid-cols-2">
            {charts.map((chart) => (
              <MetricChart key={chart.id} title={chart.title} unit={chart.unit} range="24h" series={[chart.series]} />
            ))}
          </div>
        </MonitoringCard>
      )}

      <MonitoringCard title={t('detail.servicesTitle')} description={t('detail.servicesHint')}>
        {host.services.length === 0 ? (
          // Two different answers, and the state tells them apart: an agent that looked and found
          // nothing, or an agent that has not reported at all.
          <p className="text-sm text-muted-foreground">{host.lastSeenAt === null ? t('detail.noReadings') : t('detail.noServices')}</p>
        ) : (
          <ul className="divide-y">
            {host.services.map((service) => (
              <li key={`${service.kind}:${service.port ?? service.name}`} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium">
                  {t(`services.${service.kind}`)}
                  {service.version !== null && <span className="ml-2 font-normal text-muted-foreground">{service.version}</span>}
                </p>
                {/* How OpsWatch concluded this, in the agent's own words. Discovery is a guess made
                    from a listening port and a process name, and an operator is entitled to know it. */}
                <p className="mt-0.5 text-xs text-muted-foreground">{service.evidence}</p>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>

      {host.redis !== null && (
        <MonitoringCard title={t('redis.title')} description={t('redis.hint')}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('redis.version')} value={host.redis.version ?? notMeasured} />
            <Fact
              label={t('redis.memory')}
              value={
                host.redis.usedMemoryBytes === null
                  ? notMeasured
                  : host.redis.maxMemoryBytes === null
                    ? // No limit is a real answer, and a common one. It is not "0 of 0".
                      t('redis.noLimit', { used: bytes(host.redis.usedMemoryBytes) })
                    : t('memoryOf', { used: bytes(host.redis.usedMemoryBytes), total: bytes(host.redis.maxMemoryBytes) })
              }
            />
            <Fact label={t('redis.clients')} value={count(host.redis.connectedClients)} />
            <Fact label={t('redis.ops')} value={count(host.redis.opsPerSecond)} />
            <Fact
              label={t('redis.hitRate')}
              value={(() => {
                const hits = host.redis?.keyspaceHits ?? null;
                const misses = host.redis?.keyspaceMisses ?? null;
                if (hits === null || misses === null) return notMeasured;
                // Nothing has been looked up yet, so there is no rate — not a rate of zero.
                if (hits + misses === 0) return t('redis.noLookups');
                return `${((hits / (hits + misses)) * 100).toFixed(1)}%`;
              })()}
            />
            <Fact label={t('redis.evictions')} value={count(host.redis.evictedKeys)} />
            {/* A count of keys, never a key. Nothing here reads what is stored. */}
            <Fact label={t('redis.keys')} value={count(host.redis.keys)} />
            <Fact
              label={t('redis.role')}
              value={
                host.redis.role === null
                  ? notMeasured
                  : t('redis.roleValue', { role: host.redis.role, replicas: host.redis.connectedReplicas ?? 0 })
              }
            />
            <Fact
              label={t('redis.persistence')}
              value={
                host.redis.lastSaveOk === null && host.redis.aofEnabled === null
                  ? notMeasured
                  : t(host.redis.aofEnabled === true ? 'redis.aofOn' : host.redis.lastSaveOk === true ? 'redis.saveOk' : 'redis.saveFailed')
              }
            />
            <Fact
              label={t('redis.uptime')}
              value={host.redis.uptimeSeconds === null ? notMeasured : t('detail.days', { days: Math.floor(host.redis.uptimeSeconds / 86400) })}
            />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t('redis.howRead')}</p>
        </MonitoringCard>
      )}

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
