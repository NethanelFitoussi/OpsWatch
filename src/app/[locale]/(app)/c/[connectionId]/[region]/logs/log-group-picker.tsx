import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FailureNotice } from '@/components/monitoring/failure-notice';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import type { MonitoringScope } from '@/lib/monitoring/call';
import { LOG_GROUP_SEARCH_LIMIT, searchLogGroups } from '@/lib/monitoring/logs';
import { formatMetricValue } from '@/lib/monitoring/shared/format';
import type { LogsTimeRange } from '@/lib/monitoring/shared/logs-queries';
import { resolveTarget } from '@/lib/monitoring/target';

/**
 * Two GET forms, so picking log groups needs no JavaScript and every selection is a shareable URL:
 * one narrows the list by prefix, the other writes the checked groups into `?group=`.
 */
export async function LogGroupPicker({
  scope,
  prefix,
  selected,
  range,
}: {
  scope: MonitoringScope;
  prefix: string;
  selected: string[];
  range: LogsTimeRange;
}) {
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

  const locale = await getLocale();
  const shown = new Set(groups.data.map((group) => group.name));
  const carried = selected.filter((name) => !shown.has(name));
  return (
    <MonitoringCard title={title}>
      <div className="space-y-4">
        <form className="space-y-2">
          <Label htmlFor="log-group-prefix">{t('picker.prefix')}</Label>
          <Input id="log-group-prefix" name="prefix" defaultValue={prefix} maxLength={512} className="font-mono text-xs" />
          <input type="hidden" name="range" value={range} />
          {selected.map((name) => (
            <input key={name} type="hidden" name="group" value={name} />
          ))}
          <Button type="submit" variant="outline" size="sm">
            {t('picker.search')}
          </Button>
        </form>

        {groups.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('picker.empty')}</p>
        ) : (
          <form className="space-y-3">
            <ul className="space-y-2">
              {groups.data.map((group) => (
                <li key={group.name}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="group"
                      value={group.name}
                      defaultChecked={selected.includes(group.name)}
                      className="mt-1 size-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-xs break-all">{group.name}</span>
                      <span className="block text-xs text-muted-foreground">{formatMetricValue(group.storedBytes, 'bytes', locale)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {/* A group selected under another prefix is not on screen to be re-checked, so it rides along hidden. */}
            {carried.map((name) => (
              <input key={name} type="hidden" name="group" value={name} />
            ))}
            <input type="hidden" name="prefix" value={prefix} />
            <input type="hidden" name="range" value={range} />
            <Button type="submit" size="sm">
              {t('picker.use')}
            </Button>
          </form>
        )}

        {groups.data.length === LOG_GROUP_SEARCH_LIMIT && (
          <p className="text-xs text-muted-foreground">{t('picker.limit', { count: LOG_GROUP_SEARCH_LIMIT })}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('picker.billed')}</p>
      </div>
    </MonitoringCard>
  );
}
