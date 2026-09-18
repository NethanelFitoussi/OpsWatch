import { getTranslations } from 'next-intl/server';
import { MonitoringHeader } from '@/components/monitoring/monitoring-header';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { LOGS_MAX_GROUPS, LOGS_MAX_QUERY_LENGTH } from '@/lib/monitoring/logs';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { LOGS_TIME_RANGES, type LogsTimeRange } from '@/lib/monitoring/shared/logs-queries';
import { isOneOf } from '@/lib/type-guards';
import { LogGroupPicker } from './log-group-picker';
import { LogsQueryPanel } from './logs-query-panel';
import { LogsSelectionProvider } from './logs-selection';

type Param = string | string[] | undefined;
type Props = { params: Promise<MonitoringParams>; searchParams: Promise<{ group?: Param; prefix?: Param; range?: Param }> };

const toArray = (value: Param): string[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const first = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

export const generateMetadata = localizedTitle('Monitoring.logs.title');

export default async function LogsPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const sp = await searchParams;
  // The URL is user input: the selection is deduplicated and bounded exactly like the API bounds it.
  const groups = [...new Set(toArray(sp.group))].filter((group) => group.length > 0 && group.length <= 512).slice(0, LOGS_MAX_GROUPS);
  const prefix = first(sp.prefix)?.trim().slice(0, 512) ?? '';
  const rangeParam = first(sp.range);
  const range: LogsTimeRange = isOneOf(LOGS_TIME_RANGES, rangeParam) ? rangeParam : '1h';
  const t = await getTranslations('Monitoring.logs');

  return (
    <div className="space-y-6">
      <MonitoringHeader
        context={context}
        title={t('title')}
        description={t('description', { connection: context.connection.name, region: context.scope.region })}
        autoRefresh={false}
      />
      {/* The picker and the editor share one selection, so a ticked group reaches the editor at once. */}
      <LogsSelectionProvider initial={groups} max={LOGS_MAX_GROUPS}>
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <SuspenseCard key={prefix} title={t('picker.title')} variant="table" rows={6}>
            <LogGroupPicker scope={context.scope} prefix={prefix} range={range} />
          </SuspenseCard>
          <LogsQueryPanel
            connectionId={context.scope.connectionId}
            region={context.scope.region}
            range={range}
            maxQueryLength={LOGS_MAX_QUERY_LENGTH}
          />
        </div>
      </LogsSelectionProvider>
    </div>
  );
}
