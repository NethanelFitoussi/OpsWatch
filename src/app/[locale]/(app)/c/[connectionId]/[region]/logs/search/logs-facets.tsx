'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { Facet, LogLevel, Population } from '@/lib/monitoring/shared/logs-search';
import { cn } from '@/lib/utils';

/**
 * What the lines on screen are made of: which levels, which streams.
 *
 * **The counts are of the rows in hand and nothing else.** When the limit cut the result, that is said in
 * as many words above them — otherwise "3 errors" reads as "there were three errors" when it means "three
 * of the hundred lines we fetched said error". Narrowing here filters what is already displayed; it does
 * not run a second query, and the header says how many of how many are showing.
 */

/**
 * `level: null` is "no level filter"; `level: 'none'` is "only the lines that announce no level". They are
 * different requests, and collapsing them would make the largest group on most screens unselectable.
 */
export type FacetFilter = { level: LogLevel | 'none' | null; stream: string | null };

function Group({
  title,
  values,
  active,
  onPick,
}: {
  title: string;
  values: { key: string; label: string; count: number }[];
  active: string | null;
  onPick: (key: string | null) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{title}</p>
      <ul className="space-y-0.5">
        {values.map((value) => (
          <li key={value.key}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={active === value.key}
              onClick={() => onPick(active === value.key ? null : value.key)}
              className={cn('h-7 w-full justify-between gap-2 px-2 text-xs font-normal', active === value.key && 'bg-muted font-medium')}
            >
              <span className="min-w-0 truncate">{value.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{value.count}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LogsFacets({
  levels,
  streams,
  filter,
  population,
  onChange,
}: {
  levels: { level: LogLevel | null; count: number }[];
  streams: Facet[];
  filter: FacetFilter;
  population: Population;
  onChange: (next: FacetFilter) => void;
}) {
  const t = useTranslations('Monitoring.client');
  if (levels.length === 0 && streams.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">{t('logs.facets.title')}</p>
        {/* Said before the numbers, not in a footnote underneath them. */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {population === 'sample' ? t('logs.facets.ofSample') : t('logs.facets.ofAll')}
        </p>
      </div>
      <Group
        title={t('logs.facets.level')}
        values={levels.map(({ level, count }) => ({
          key: level ?? 'none',
          label: level === null ? t('logs.facets.noLevel') : t(`logs.levels.${level}`),
          count,
        }))}
        active={filter.level}
        onPick={(key) => onChange({ ...filter, level: key as LogLevel | 'none' | null })}
      />
      <Group
        title={t('logs.facets.stream')}
        values={streams.map((facet) => ({ key: facet.value, label: facet.value, count: facet.count }))}
        active={filter.stream}
        onPick={(key) => onChange({ ...filter, stream: key })}
      />
    </div>
  );
}
