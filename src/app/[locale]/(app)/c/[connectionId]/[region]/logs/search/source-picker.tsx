'use client';

import { Check, ChevronDown, Layers, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePathname, useRouter } from '@/i18n/navigation';
import { matchesGroupFilter, withGroups } from '@/lib/monitoring/shared/logs-selection';
import { cn } from '@/lib/utils';
import { useLogsSelection } from './logs-selection';

/**
 * Which log groups are searched, as one control rather than a column.
 *
 * The previous version gave a permanent left column to a checkbox per log group. In an account with a
 * hundred of them that is a page of checkboxes above the logs — and the logs are what somebody came for.
 * This says how many are chosen, opens when asked, and closes again.
 *
 * Groups are shown under the service that writes them, because `/aws/ecs/api` and `/aws/lambda/worker`
 * are two different kinds of thing and an operator thinks in those terms rather than in path prefixes.
 * What is already chosen is listed first, so a selection never scrolls away behind a filter.
 *
 * Typing filters what the server already sent. Text that reaches past those groups offers the AWS search,
 * which is a navigation — the text lives in the URL, exactly as it did before — so an account with more
 * log groups than one page can still reach the rest.
 */

export type PickerGroup = { name: string; size: string | null };

/** The heading a log group falls under. AWS's own naming convention, read rather than guessed at. */
function categoryOf(name: string): string {
  const match = /^\/aws\/([a-z0-9-]+)\//.exec(name);
  if (match !== null) return match[1];
  if (name.startsWith('/ecs/')) return 'ecs';
  return 'other';
}

export function SourcePicker({ groups, truncated, search }: { groups: PickerGroup[]; truncated: boolean; search: string }) {
  const t = useTranslations('Monitoring.client');
  const { selected, max, toggle, clear, replace } = useLogsSelection();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(search);

  const visible = useMemo(() => groups.filter((group) => matchesGroupFilter(group.name, filter)), [groups, filter]);
  const sections = useMemo(() => {
    const chosen = visible.filter((group) => selected.includes(group.name));
    const rest = visible.filter((group) => !selected.includes(group.name));
    const map = new Map<string, PickerGroup[]>();
    for (const group of rest) {
      const category = categoryOf(group.name);
      map.set(category, [...(map.get(category) ?? []), group]);
    }
    const byCategory = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return chosen.length > 0 ? [[t('logs.sources.chosen'), chosen] as const, ...byCategory] : byCategory;
  }, [visible, selected, t]);

  const text = filter.trim();
  // Everything the server sent is on screen already: asking AWS again is only worth it to reach past it.
  const searchable = text !== search && (visible.length === 0 || truncated);
  const full = selected.length >= max;

  const searchAws = () => {
    const params = new URLSearchParams(withGroups(window.location.search, selected));
    // The URL key stays `prefix` so links made before this searched anywhere in the name still work.
    if (text === '') params.delete('prefix');
    else params.set('prefix', text);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-11 w-full justify-between gap-2" aria-label={t('logs.sources.label')}>
          <span className="flex min-w-0 items-center gap-2">
            <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{t('logs.sources.label')}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
            {/* One group is named rather than counted: "1 chosen" tells a reader nothing about which. */}
            <span className="truncate font-mono text-xs">
              {selected.length === 0 ? t('logs.sources.none') : selected.length === 1 ? selected[0] : t('logs.sources.count', { count: selected.length })}
            </span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <form
          className="space-y-2 border-b p-3"
          onSubmit={(event) => {
            event.preventDefault();
            // The popover is portalled out of the DOM but not out of the React tree, so without this the
            // submit reaches the search form that owns the trigger and runs a search instead.
            event.stopPropagation();
            searchAws();
          }}
        >
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            maxLength={512}
            placeholder={t('logs.sources.filter')}
            className="h-8 font-mono text-xs"
            aria-label={t('logs.sources.filter')}
          />
          {searchable && (
            <>
              <Button type="submit" variant="outline" size="sm" className="max-w-full">
                <Search className="size-3.5" aria-hidden />
                <span className="truncate">{text === '' ? t('logs.picker.searchAll') : t('logs.picker.searchAws', { text })}</span>
              </Button>
              {text !== '' && <p className="text-xs text-muted-foreground">{t('logs.picker.caseSensitive')}</p>}
            </>
          )}
        </form>

        {/* Bounded and scrolling: the list never decides how tall the page is. */}
        <div className="max-h-72 overflow-y-auto p-1">
          {sections.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{groups.length === 0 ? t('logs.picker.empty') : t('logs.picker.noMatch')}</p>
          ) : (
            sections.map(([category, items]) => (
              <div key={category} className="py-1">
                <p className="px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{category}</p>
                {items.map((group) => {
                  const checked = selected.includes(group.name);
                  return (
                    <button
                      key={group.name}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      // At the cap a further tick would be dropped by the API, so it is refused here instead.
                      disabled={!checked && full}
                      onClick={() => toggle(group.name, !checked)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40',
                        checked && 'bg-primary/10',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                          checked && 'border-primary bg-primary text-primary-foreground',
                        )}
                      >
                        {checked && <Check className="size-3" aria-hidden />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-mono text-xs break-all">{group.name}</span>
                        {group.size !== null && <span className="block text-[11px] text-muted-foreground">{group.size}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {full ? t('logs.picker.max', { count: max }) : t('logs.sources.selected', { count: selected.length, total: groups.length })}
          </span>
          <span className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              // Only what is on screen, and only up to the cap the query API enforces.
              onClick={() => replace([...new Set([...selected, ...visible.map((group) => group.name)])].slice(0, max))}
            >
              {t('logs.sources.selectVisible')}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clear}>
              {t('logs.picker.clear')}
            </Button>
            <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>
              {t('logs.sources.done')}
            </Button>
          </span>
        </div>
        {truncated && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('logs.picker.limit', { count: groups.length })}</p>}
      </PopoverContent>
    </Popover>
  );
}
