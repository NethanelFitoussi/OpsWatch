import { getTranslations } from 'next-intl/server';
import type { Host } from '@opswatch/contract';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import { hostFindings, worstFinding, type HostFinding, type HostFindingLevel } from '@/lib/monitoring/shared/host-findings';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * The machines placed in this AWS account and region, on the environment's own Health page.
 *
 * An operator asking "what is wrong in production" was shown everything AWS reports about the account
 * and nothing about the machines inside it — the owner's own case is Redis running directly on an
 * Ubuntu EC2 instance, where a full disk is invisible to every AWS API there is. The agent already
 * measures it; the figure simply lived on another page.
 *
 * **Read at render, and not a Problem.** These are computed from each machine's last reading every time
 * the page is drawn. Nothing is written to `problems`, which is keyed to an AWS environment by a column
 * that cannot be null, and nothing here is acknowledged, grouped into an incident, or matched by an
 * alert rule. The card says so, because one that looked like the Problems list would promise a
 * notification that is not coming.
 *
 * It never claims to cover every machine either. Only a host OpsWatch has *placed* — an agent reporting
 * a cloud instance id that some account's instance list has since matched — is in an environment at all.
 */
export async function EnvironmentMachines({ hosts }: { hosts: readonly Host[] }) {
  const t = await getTranslations('Monitoring.machines');
  const tFinding = await getTranslations('Hosts.findings');

  // Nothing placed here: no card. An empty box on the Health page would be a statement about machines,
  // and it would be the wrong one — there may well be machines, just none this account has matched.
  if (hosts.length === 0) return null;

  const rank = (level: HostFindingLevel | null) => (level === 'critical' ? 0 : level === 'warning' ? 1 : 2);
  const rows = hosts
    .map((host) => ({ host, findings: hostFindings(host) }))
    // Worst first: an operator scanning the page reads the top of it.
    .sort((a, b) => rank(worstFinding(a.findings)) - rank(worstFinding(b.findings)) || a.host.name.localeCompare(b.host.name));

  const line = (finding: HostFinding) =>
    tFinding(finding.kind, {
      subject: finding.subject,
      percent: finding.percent === null ? '' : finding.percent.toFixed(0),
    });

  return (
    <MonitoringCard title={t('title')} description={t('description', { count: hosts.length })}>
      <ul className="divide-y">
        {rows.map(({ host, findings }) => {
          const worst = worstFinding(findings);
          return (
            <li key={host.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm">
              <div className="min-w-0">
                <Link href={`/hosts/${host.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {host.name}
                </Link>
                {/* Each finding with the figure behind it: never a verdict without its evidence. */}
                {findings.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {findings.map((finding) => (
                      <li
                        key={`${finding.kind}-${finding.subject}`}
                        className={finding.level === 'critical' ? TONE_TEXT.danger : TONE_TEXT.warning}
                      >
                        {line(finding)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* The label carries the same weight as the finding under it. A critical disk with an
                  amber "needs attention" beside it reads as milder than the line it summarises. */}
              <span
                className={cn(
                  'shrink-0 text-xs',
                  worst === null ? 'text-muted-foreground' : worst === 'critical' ? TONE_TEXT.danger : TONE_TEXT.warning,
                )}
              >
                {/* "Waiting for its first report" and "nothing found" are different answers (§2.6). */}
                {host.state === 'waiting' ? t('waiting') : worst === null ? t('nothingFound') : t('needsAttention')}
              </span>
            </li>
          );
        })}
      </ul>
      {/* What this card is, said where it is read rather than in a roadmap. */}
      <p className="mt-3 text-xs text-muted-foreground">{t('notAlerts')}</p>
    </MonitoringCard>
  );
}
