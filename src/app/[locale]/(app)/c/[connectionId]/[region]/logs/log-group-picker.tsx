import { getLocale, getTranslations } from 'next-intl/server';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { LOG_GROUP_SEARCH_LIMIT, searchLogGroups } from '@/lib/monitoring/logs';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import type { LogsTimeRange } from '@/lib/monitoring/shared/logs-queries';
import { resolveTarget } from '@/lib/monitoring/target';
import { LogGroupList } from './log-group-list';

/**
 * The log groups of one prefix, fetched on the server. The list itself is interactive: the prefix is what AWS
 * was asked for, and the browser filters and selects inside what came back.
 */
export async function LogGroupPicker({ scope, prefix, range }: { scope: MonitoringScope; prefix: string; range: LogsTimeRange }) {
  const t = await getTranslations('Monitoring.logs');
  const title = t('picker.title');
  const target = await resolveTarget(scope);
  const groups = target.ok ? await searchLogGroups(target.data, prefix) : target;
  if (!groups.ok) {
    return (
      <MonitoringCard title={title}>
        <FailureNotice failure={groups} connectionId={scope.connectionId} />
      </MonitoringCard>
    );
  }

  // Sizes are formatted here so the browser needs neither the raw bytes nor a second locale.
  const locale = await getLocale();
  return (
    <MonitoringCard title={title}>
      <div className="space-y-4">
        <LogGroupList
          groups={groups.data.map((group) => ({ name: group.name, size: formatMetricValue(group.storedBytes, 'bytes', locale) }))}
          prefix={prefix}
          range={range}
          truncated={groups.data.length === LOG_GROUP_SEARCH_LIMIT}
        />
        <p className="text-xs text-muted-foreground">{t('picker.billed')}</p>
      </div>
    </MonitoringCard>
  );
}
