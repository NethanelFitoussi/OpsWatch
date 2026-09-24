'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePathname, useRouter } from '@/i18n/navigation';
import { matchesGroupFilter, withGroups } from '@/lib/monitoring/shared/logs-selection';
import type { LogsTimeRange } from '@/lib/monitoring/shared/logs-queries';
import { useLogsSelection } from './logs-selection';

/**
 * One log group as the picker shows it: its name, and its stored size when AWS sent one (a name search
 * answers without sizes), already formatted on the server.
 */
export type PickedLogGroup = { name: string; size: string | null };

/**
 * The list of log groups. Typing filters what the server already sent, in the browser: no round trip and no
 * AWS call. Only text that reaches past the loaded groups offers the server search, which is a navigation
 * (the search text lives in the URL) and stays a plain GET form for a browser without JavaScript.
 *
 * The list is bounded and scrolls inside itself. An account with three hundred log groups used to push the
 * search box, the timeline and every log line below the fold, so the page opened on a wall of checkboxes
 * with the actual logs nowhere in sight. Ticked groups are lifted to the top of the list, so the selection
 * stays on screen instead of scrolling away behind the filter that no longer matches it.
 */
export function LogGroupList({
  groups,
  search,
  range,
  truncated,
}: {
  groups: PickedLogGroup[];
  search: string;
  range: LogsTimeRange;
  truncated: boolean;
}) {
  const t = useTranslations('Monitoring.client');
  const router = useRouter();
  const pathname = usePathname();
  const { selected, max, toggle, clear } = useLogsSelection();
  const [filter, setFilter] = useState(search);

  const matches = useMemo(() => {
    const filtered = groups.filter((group) => matchesGroupFilter(group.name, filter));
    const isSelected = (group: PickedLogGroup) => selected.includes(group.name);
    // Stable within each half: ticked first, otherwise the order AWS gave.
    return [...filtered.filter(isSelected), ...filtered.filter((group) => !isSelected(group))];
  }, [groups, filter, selected]);

  const text = filter.trim();
  // Everything the server sent is on screen already: asking AWS again is only worth it to reach past it.
  const searchable = text !== search && (matches.length === 0 || truncated);
  const full = selected.length >= max;

  const searchAws = () => {
    const params = new URLSearchParams(withGroups(window.location.search, selected));
    // The URL key stays `prefix` so links made before this searched anywhere in the name still work.
    if (text === '') params.delete('prefix');
    else params.set('prefix', text);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          searchAws();
        }}
      >
        <Label htmlFor="log-group-filter" className="text-xs">
          {t('logs.picker.filter')}
        </Label>
        <Input
          id="log-group-filter"
          name="prefix"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          maxLength={512}
          className="h-8 font-mono text-xs"
        />
        {/* Without JavaScript this is still the GET search it has always been. */}
        <input type="hidden" name="range" value={range} />
        {selected.map((name) => (
          <input key={name} type="hidden" name="group" value={name} />
        ))}
        {searchable && (
          <>
            <Button type="submit" variant="outline" size="sm" className="max-w-full">
              <span className="truncate">{text === '' ? t('logs.picker.searchAll') : t('logs.picker.searchAws', { text })}</span>
            </Button>
            {/* The list on screen is filtered whatever the case; AWS matches the pattern case-sensitively. */}
            {text !== '' && <p className="text-xs text-muted-foreground">{t('logs.picker.caseSensitive')}</p>}
          </>
        )}
      </form>

      {/* How many are ticked, always, beside the way to untick them all. */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t('logs.picker.selected', { count: selected.length, total: groups.length })}
        </p>
        {selected.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clear}>
            {t('logs.picker.clear')}
          </Button>
        )}
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{groups.length === 0 ? t('logs.picker.empty') : t('logs.picker.noMatch')}</p>
      ) : (
        // Bounded: the logs are what this page is for, and they stay above the fold whatever the account holds.
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {matches.map((group) => {
            const checked = selected.includes(group.name);
            return (
              <li key={group.name}>
                <label className="flex items-start gap-2 rounded-sm px-1 py-1 text-sm hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={checked}
                    // At the cap a further tick would be dropped by the API, so it is refused here instead.
                    disabled={!checked && full}
                    onChange={(event) => toggle(group.name, event.target.checked)}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-xs break-all">{group.name}</span>
                    {group.size !== null && <span className="block text-[11px] text-muted-foreground">{group.size}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {full && <p className="text-xs text-muted-foreground">{t('logs.picker.max', { count: max })}</p>}
      {truncated && <p className="text-xs text-muted-foreground">{t('logs.picker.limit', { count: groups.length })}</p>}
    </div>
  );
}
