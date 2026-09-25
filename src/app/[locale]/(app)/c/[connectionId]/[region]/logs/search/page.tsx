import { SectionLayout } from '@/components/monitoring/section-layout';
import { localizedTitle } from '@/i18n/metadata';
import { LOG_GROUP_SEARCH_LIMIT, LOGS_MAX_GROUPS, LOGS_MAX_QUERY_LENGTH, LOGS_MAX_ROWS, searchLogGroups } from '@/lib/monitoring/logs';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import { resolveTarget } from '@/lib/monitoring/target';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { aiIsReady } from '@/lib/ai/connection';
import { requireAdmin } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { LOGS_TIME_RANGES, type LogsTimeRange } from '@/lib/monitoring/shared/logs-queries';
import { LOG_LEVELS, SEARCH_TEXT_MAX, parseRowLimit } from '@/lib/monitoring/shared/logs-search';
import { fieldsOf, listSavedSearches } from '@/lib/store/saved-searches';
import { isOneOf } from '@/lib/type-guards';
import { deleteSearchAction, duplicateSearchAction, proposeSearchAction, saveSearchAction } from './actions';
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

  // The log groups this region has, read once on the server. The picker is a popover rather than a
  // column, so it needs the whole list at render rather than a fetch per keystroke; `searchLogGroups`
  // already bounds what it returns, and the browser filters inside that.
  const target = await resolveTarget(context.scope);
  const listed = target.ok ? await searchLogGroups(target.data, search) : target;
  const locale = context.locale;
  const sources = {
    groups: listed.ok
      ? listed.data.map((group) => ({
          name: group.name,
          size: group.storedBytes === null ? null : formatMetricValue(group.storedBytes, 'bytes', locale),
        }))
      : [],
    truncated: listed.ok && listed.data.length === LOG_GROUP_SEARCH_LIMIT,
    // Said rather than hidden: a picker that silently has nothing in it looks like an empty account.
    failed: !listed.ok,
    search,
  };

  // Saved searches are this person's, read with their own id: the store filters every statement on it.
  const adminId = await requireAdmin(context.locale);
  const scope = { connectionId: context.scope.connectionId, scope: context.scope.region };
  const savedRows = listSavedSearches(getDb(), adminId, scope).map((row) => ({ id: row.id, ...fieldsOf(row) }));
  return (
    <SectionLayout context={context} section="logs" subsection="search" autoRefresh={false}>
      {/* The picker and the search share one selection, so a ticked group reaches the search at once. */}
      <LogsSelectionProvider initial={groups} max={LOGS_MAX_GROUPS}>
        <LogsExplorer
          // A saved search loads by navigating to the URL it was saved from; remounting on that navigation
          // is what makes the loaded search replace the one on screen rather than sit under it.
          key={`${first(sp.q) ?? ''}|${levelParam ?? ''}|${first(sp.limit) ?? ''}|${range}`}
          connectionId={context.scope.connectionId}
          region={context.scope.region}
          range={range}
          maxQueryLength={LOGS_MAX_QUERY_LENGTH}
          initial={{
            text: first(sp.q)?.slice(0, SEARCH_TEXT_MAX) ?? '',
            level: isOneOf(LOG_LEVELS, levelParam) ? levelParam : null,
            limit: Math.min(parseRowLimit(first(sp.limit)), LOGS_MAX_ROWS),
          }}
          // Absent unless somebody configured a provider and the test passed: a button that can only fail
          // is worse than no button.
          propose={aiIsReady(getDb()) ? proposeSearchAction.bind(null, context.locale, context.scope.connectionId, context.scope.region) : null}
          saved={{
            rows: savedRows,
            basePath: `/c/${context.scope.connectionId}/${context.scope.region}/logs/search`,
            actions: {
              save: saveSearchAction.bind(null, context.locale, context.scope.connectionId, context.scope.region),
              duplicate: duplicateSearchAction.bind(null, context.locale, context.scope.connectionId, context.scope.region),
              remove: deleteSearchAction.bind(null, context.locale, context.scope.connectionId, context.scope.region),
            },
          }}
          sources={sources}
        />
      </LogsSelectionProvider>
    </SectionLayout>
  );
}
