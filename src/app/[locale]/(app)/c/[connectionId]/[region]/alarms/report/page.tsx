import { REPORT_PERIODS, type ReportPeriod } from '@opswatch/contract';
import { ReportView } from '@/components/reports/report-view';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { getTranslations } from 'next-intl/server';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readReport } from '@/lib/read/reports';
import { insightRenderer } from '@/lib/read/render';

type Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ period?: string }> };

export const generateMetadata = localizedTitle('Monitoring.report.title');

/** The alarms report (§19): stored rollups only, and every figure against the period before. */
export default async function ReportPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const asked = (await searchParams).period;
  // An unknown period falls back to the default rather than 404ing: the parameter is a view, not an identity.
  const period: ReportPeriod = (REPORT_PERIODS as readonly string[]).includes(asked ?? '') ? (asked as ReportPeriod) : '7d';
  // A family reads as the words the rest of the product uses for it, not as the detector id.
  const families = await getTranslations({ locale: context.locale, namespace: 'Monitoring.health.family' });

  const report = readReport(
    getDb(),
    { connectionId: context.scope.connectionId, scope: context.scope.region, section: 'alarms', period },
    // The detector's own sentence, so a row says what happened rather than printing an AWS identifier.
    { nowMs: pageNow(), familyLabel: (family) => families(family), render: await insightRenderer(context.locale) },
  );

  return (
    <SectionLayout context={context} section="alarms" subsection="report">
      <ReportView
        report={report}
        locale={context.locale}
        basePath={subsectionPath(context.scope, 'alarms', 'report')}
        problemsPath={subsectionPath(context.scope, 'overview', 'problems')}
        exportHref={`/api/v1/reports?env=${context.scope.connectionId}:${context.scope.region}&section=alarms&period=${period}&format=markdown&locale=${context.locale}`}
      />
    </SectionLayout>
  );
}
