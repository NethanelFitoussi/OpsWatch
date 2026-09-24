import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { localizedTitle } from '@/i18n/metadata';
import { LOGS_MAX_GROUPS, LOGS_MAX_QUERY_LENGTH, LOGS_MAX_ROWS } from '@/lib/monitoring/logs';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { LOGS_TIME_RANGES, type LogsTimeRange } from '@/lib/monitoring/shared/logs-queries';
import { LOG_LEVELS, SEARCH_TEXT_MAX, parseRowLimit } from '@/lib/monitoring/shared/logs-search';
import { isOneOf } from '@/lib/type-guards';
import { LogGroupPicker } from './log-group-picker';
import { LogsExplorer } from './logs-explorer';
import { LogsSelectionProvider } from './logs-selection';

type Param = string | string[] | undefined;
type Props = {
  params: Promise<MonitoringParams>;
  searchParams: Promise<{ group?: Param; prefix?: Param; range?: Param; q?: Param; level?: Param; limit?: Param }>;
};

const toArray = (value: Param): string[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const first = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

export const generateMetadata = localizedTitle('Monitoring.logs.title');

export default async function LogsPage({ params, searchParams }: Props) {
  const context = await initMonitoringRoute(params);
  const sp = await searchParams;
  // The URL is user input: the selection is deduplicated and bounded exactly like the API bounds it.
  const groups = [...new Set(toArray(sp.group))].filter((group) => group.length > 0 && group.length <= 512).slice(0, LOGS_MAX_GROUPS);
  // `?prefix=` kept its name so older links still work; it now matches anywhere in a log group name.
  const search = first(sp.prefix)?.trim().slice(0, SEARCH_TEXT_MAX) ?? '';
  const rangeParam = first(sp.range);
  const range: LogsTimeRange = isOneOf(LOGS_TIME_RANGES, rangeParam) ? rangeParam : '1h';
  // Bounded here as well as in the browser: a link is whatever somebody pasted into the address bar.
  const levelParam = first(sp.level);
  const t = await getTranslations('Monitoring.logs');

  return (
    <SectionLayout context={context} section="logs" subsection="search" autoRefresh={false}>
      {/* The picker and the search share one selection, so a ticked group reaches the search at once. */}
      <LogsSelectionProvider initial={groups} max={LOGS_MAX_GROUPS}>
        <LogsExplorer
          connectionId={context.scope.connectionId}
          region={context.scope.region}
          range={range}
          maxQueryLength={LOGS_MAX_QUERY_LENGTH}
          initial={{
            text: first(sp.q)?.slice(0, SEARCH_TEXT_MAX) ?? '',
            level: isOneOf(LOG_LEVELS, levelParam) ? levelParam : null,
            limit: Math.min(parseRowLimit(first(sp.limit)), LOGS_MAX_ROWS),
          }}
          groupPicker={
            <SuspenseCard key={search} title={t('picker.title')} variant="table" rows={6}>
              <LogGroupPicker scope={context.scope} search={search} range={range} />
            </SuspenseCard>
          }
        />
      </LogsSelectionProvider>
    </SectionLayout>
  );
}
