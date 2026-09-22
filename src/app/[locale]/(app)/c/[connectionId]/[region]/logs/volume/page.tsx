import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow, parseTimeRange } from '@/lib/monitoring/shared/time-range';
import { LogVolumeCard } from './cards';

type Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ range?: string | string[] }> };

export const generateMetadata = localizedTitle('Monitoring.volume.title');

/**
 * Logs → Volume (§18).
 *
 * Which log groups are costing money, and which are kept forever. It reads the `AWS/Logs IncomingBytes`
 * metric and `DescribeLogGroups` — neither is billed per gigabyte scanned — so this is the one page in the
 * Logs section that costs nothing against the daily Logs Insights budget, and it says so.
 */
export default async function LogVolumePage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const range = parseTimeRange((await searchParams).range, context.settings.defaultRange);
  const nowMs = pageNow();
  const t = await getTranslations('Monitoring.volume');

  return (
    <SectionLayout context={context} section="logs" subsection="volume" range={range}>
      <SuspenseCard key={range} title={t('cardTitle')} variant="table" rows={8}>
        <LogVolumeCard scope={context.scope} range={range} nowMs={nowMs} />
      </SuspenseCard>
    </SectionLayout>
  );
}
