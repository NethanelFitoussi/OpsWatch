import { PageHeader } from '@/components/page-header';
import type { MonitoringPageContext } from '@/lib/monitoring/route';
import type { TimeRange } from '@/lib/monitoring/shared/time-range';
import { AutoRefresh } from './auto-refresh';
import { RegionSelector } from './region-selector';
import { TimeRangeSelector } from './time-range-selector';

/** The title of a monitoring page with its region, time range and auto-refresh controls. */
export async function MonitoringHeader({
  context,
  title,
  description,
  range,
  autoRefresh = true,
}: {
  context: MonitoringPageContext;
  title: string;
  description: string;
  range?: TimeRange;
  autoRefresh?: boolean;
}) {
  return (
    <PageHeader
      title={title}
      description={description}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <RegionSelector regions={context.connection.regions} current={context.scope.region} />
          {range && <TimeRangeSelector current={range} />}
          {autoRefresh && <AutoRefresh />}
        </div>
      }
    />
  );
}
