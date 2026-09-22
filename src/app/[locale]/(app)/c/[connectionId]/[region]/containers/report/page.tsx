import { REPORT_PERIODS, type ReportPeriod } from '@opswatch/contract';
import { ReportView } from '@/components/reports/report-view';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { readReport } from '@/lib/read/reports';

type Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ period?: string }> };

export const generateMetadata = localizedTitle('Monitoring.report.title');

/** The containers report (§19): stored rollups only, and every figure against the period before. */
export default async function ReportPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const asked = (await searchParams).period;
  // An unknown period falls back to the default rather than 404ing: the parameter is a view, not an identity.
  const period: ReportPeriod = (REPORT_PERIODS as readonly string[]).includes(asked ?? '') ? (asked as ReportPeriod) : '7d';

  const report = readReport(
    getDb(),
    { connectionId: context.scope.connectionId, scope: context.scope.region, section: 'containers', period },
    { nowMs: pageNow() },
  );

  return (
    <SectionLayout context={context} section="containers" subsection="report">
      <ReportView
        report={report}
        locale={context.locale}
        basePath={subsectionPath(context.scope, 'containers', 'report')}
        exportHref={`/api/v1/reports?env=${context.scope.connectionId}:${context.scope.region}&section=containers&period=${period}&format=markdown&locale=${context.locale}`}
      />
    </SectionLayout>
  );
}
