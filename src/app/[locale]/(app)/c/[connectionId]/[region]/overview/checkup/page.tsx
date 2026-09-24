import { getTranslations } from 'next-intl/server';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readCheckup } from '@/lib/read/checkup';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.checkup.title');

/**
 * Checkup: what is wrong with how this environment is *set up* (Stage 3 §4).
 *
 * The page states its own coverage before it states its findings. "Nothing to report" from a catalogue where
 * half the checks could not run is not the same claim as "nothing to report" from one where they all did, and
 * §2.6 does not let the two look alike — so the checks that could not run are listed on the page rather than
 * dropped from it.
 */
export default async function CheckupPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const t = await getTranslations('Monitoring.checkup');
  const tSeverity = await getTranslations('Monitoring.checkup.severity');

  const checkup = readCheckup(
    getDb(),
    { connectionId: context.scope.connectionId, scope: context.scope.region },
    // The edge knows its own configuration; the read service is handed it rather than reaching for it.
    { nowMs: pageNow(), logsBudgetGbPerDay: env().OPSWATCH_LOGS_BUDGET_GB_PER_DAY },
  );

  return (
    <SectionLayout context={context} section="overview" subsection="checkup" description={t('description')}>
      <MonitoringCard title={<span className="sr-only">{t('title')}</span>}>
        <p className="text-sm">
          {t('coverage', { ran: checkup.coverage.ran, total: checkup.coverage.total, notRun: checkup.coverage.notRun })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('difference')}</p>
      </MonitoringCard>

      <MonitoringCard title={t('findings')}>
        {checkup.findings.length === 0 ? (
          <>
            <p className="text-sm">{t('noFindings')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('noFindingsHint')}</p>
          </>
        ) : (
          <ul className="divide-y">
            {checkup.findings.map((finding) => (
              <li key={`${finding.id}:${finding.subject ?? ''}`} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <SeverityBadge severity={finding.severity} label={tSeverity(finding.severity)} />
                  <span className="text-sm font-medium">{t(`check.${finding.id}`, finding.values)}</span>
                </div>
                {/* What to do about it, which is what separates a finding from a complaint. */}
                <p className="mt-1 text-sm text-muted-foreground">{t(`fix.${finding.id}`)}</p>
              </li>
            ))}
          </ul>
        )}
      </MonitoringCard>

      <MonitoringCard title={t('couldNotRun')}>
        <ul className="divide-y">
          {checkup.notRun.map((outcome) => (
            <li key={outcome.id} className="py-2">
              <p className="text-sm">{t(`check.${outcome.id}`, outcome.values)}</p>
              <p className="text-xs text-muted-foreground">{t(`reason.${outcome.reason}`)}</p>
            </li>
          ))}
        </ul>
      </MonitoringCard>
    </SectionLayout>
  );
}
