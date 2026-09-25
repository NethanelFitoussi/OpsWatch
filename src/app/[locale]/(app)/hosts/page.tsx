import { Server } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { DocLink } from '@/components/docs/doc-link';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initProtectedRoute } from '@/lib/auth/route';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { agentScriptDigest } from '@/lib/hosts/agent-script';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { hostFindings, worstFinding } from '@/lib/monitoring/shared/host-findings';
import { listHosts } from '@/lib/store/hosts';
import { STATE_FILL, STATE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { createHostAction } from './actions';
import { EnrolHostForm } from './host-forms';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('Hosts.title');

/**
 * The Linux machines OpsWatch watches (§E).
 *
 * **Not inside an AWS connection**, because a machine is not an attribute of a cloud account: it may be
 * an EC2 instance, a Droplet, a Compute Engine VM or a server under somebody's desk, and the provider
 * is provenance rather than identity.
 *
 * Three states, kept apart. A host enrolled a minute ago whose agent has not run yet is **waiting** —
 * not unhealthy, because calling it unhealthy trains an operator to ignore the colour. One that
 * reported and then stopped is **stale**, which means OpsWatch cannot tell them anything current about
 * that machine, and that must never look like "fine".
 */
const STATE_DOT = { healthy: STATE_FILL.healthy, stale: STATE_FILL.stale, waiting: STATE_FILL.unknown, unknown: STATE_FILL.unknown } as const;
const STATE_WORD = { healthy: STATE_TEXT.healthy, stale: STATE_TEXT.stale, waiting: STATE_TEXT.unknown, unknown: STATE_TEXT.unknown } as const;

export default async function HostsPage({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const t = await getTranslations('Hosts');
  const format = await getFormatter();

  const nowMs = pageNow();
  const hosts = listHosts(getDb(), nowMs).map((host) => ({ host, findings: hostFindings(host) }));
  // What needs attention, first. An operator with twenty machines reads the top of the list, and a
  // full disk on the nineteenth is the thing they opened the page for.
  const needsAttention = hosts.filter((one) => one.findings.length > 0);
  const baseUrl = env().OPSWATCH_PUBLIC_URL ?? '';
  const digest = agentScriptDigest({ baseUrl });

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <MonitoringCard title={t('listTitle')} description={t('listHint')}>
        {hosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <ul className="divide-y">
            {[...needsAttention, ...hosts.filter((one) => one.findings.length === 0)].map(({ host, findings }) => (
              <li key={host.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      // A finding outranks the reporting state: a machine that is reporting and whose
                      // disk is full is not a green dot.
                      worstFinding(findings) === 'critical'
                        ? STATE_FILL.critical
                        : worstFinding(findings) === 'warning'
                          ? STATE_FILL.warning
                          : STATE_DOT[host.state],
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      <Link href={`/hosts/${host.id}`} className="rounded-sm hover:underline">
                        {host.name}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className={STATE_WORD[host.state]}>{t(`states.${host.state}`)}</span>
                      {host.os !== null && <> · {host.os}</>}
                      {host.cloud !== 'unknown' && <> · {t(`clouds.${host.cloud}`)}</>}
                    </p>
                    {/* The finding itself, with the figure behind it: never a colour on its own. */}
                    {findings.map((finding) => (
                      <p key={`${finding.kind}:${finding.subject}`} className={cn('mt-0.5 text-xs', finding.level === 'critical' ? STATE_TEXT.critical : STATE_TEXT.warning)}>
                        {t(`findings.${finding.kind}`, { subject: finding.subject, percent: Math.round(finding.percent ?? 0) })}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  {/* "Never" is its own answer: a host that has not reported has not been measured. */}
                  <p>{host.lastSeenAt === null ? t('neverReported') : t('lastReport', { when: format.relativeTime(new Date(host.lastSeenAt)) })}</p>
                  {host.latest?.memoryTotalBytes != null && host.latest?.memoryUsedBytes != null && (
                    <p className="mt-0.5">
                      {t('memoryOf', {
                        used: formatMetricValue(host.latest.memoryUsedBytes, 'bytes', locale),
                        total: formatMetricValue(host.latest.memoryTotalBytes, 'bytes', locale),
                      })}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('enrol.title')} description={t('enrol.hint')}>
        <div className="mb-4 space-y-1 text-sm text-muted-foreground">
          {/* What the agent does and does not do, before somebody installs it as root. */}
          <p className="flex items-start gap-2">
            <Server className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('enrol.whatItReads')}
          </p>
          <p>{t('enrol.whatItCannot')}</p>
        </div>
        {/* The base URL rather than a command builder: a function cannot cross into a client component,
            and the command is a pure string the page can build where it shows it. */}
        <EnrolHostForm action={createHostAction.bind(null, locale)} baseUrl={baseUrl} digest={digest} />
        <p className="mt-4 text-sm">
          <DocLink slug="connect-linux" label={t('readGuide')} />
        </p>
      </MonitoringCard>
    </PageBody>
  );
}
