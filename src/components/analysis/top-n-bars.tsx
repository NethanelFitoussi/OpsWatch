import { getLocale, getTranslations } from 'next-intl/server';
import type React from 'react';
import { Link } from '@/i18n/navigation';
import { formatMetricValue, type MetricUnit } from '@/lib/monitoring/shared/format';
import { TONE_SOFT, type Tone } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

export type BarItem = { id: string; name: string; value: number | null; href?: string; tone?: Tone };

/**
 * The width of every bar as a percentage of the track, to one decimal.
 *
 * The denominator is the caller's `max` when it gives one (so several lists share one scale) and otherwise
 * the largest comparable value. A row with no value, and every row of a list whose denominator is zero or
 * less, is zero wide rather than absent: the row still exists, it just has nothing to draw.
 */
export function barWidths(items: readonly BarItem[], max: number | null | undefined): number[] {
  const values = items.map((item) => (item.value !== null && Number.isFinite(item.value) ? item.value : null));
  const largest = values.reduce<number>((widest, value) => (value !== null && value > widest ? value : widest), 0);
  const denominator = max ?? largest;
  if (!Number.isFinite(denominator) || denominator <= 0) return items.map(() => 0);
  return values.map((value) => {
    if (value === null) return 0;
    const share = Math.min(100, Math.max(0, (value / denominator) * 100));
    return Math.round(share * 10) / 10;
  });
}

/** A ranking: one row per resource, widest first, with the figure written at the end of its bar. */
export async function TopNBars({
  label,
  items,
  unit,
  max,
}: {
  label: string;
  items: readonly BarItem[];
  unit: MetricUnit;
  max?: number | null;
}): Promise<React.JSX.Element> {
  const t = await getTranslations('Monitoring.common');
  const locale = await getLocale();
  const widths = barWidths(items, max);
  return (
    <ol aria-label={t('topN.label', { metric: label })} className="space-y-1">
      {items.map((item, index) => {
        const value = formatMetricValue(item.value, unit, locale);
        return (
          <li
            key={item.id}
            aria-label={t('topN.row', { name: item.name, value })}
            className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-xs"
          >
            <span className="min-w-0 truncate" title={item.name}>
              {item.href ? (
                <Link href={item.href} className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                  {item.name}
                </Link>
              ) : (
                item.name
              )}
            </span>
            {/* The bar repeats the value beside it, so it is decoration: the row's own label carries the meaning. */}
            <span aria-hidden className="block h-2 w-full overflow-hidden rounded-sm bg-muted">
              <span
                className={cn('block h-full rounded-sm', item.tone ? TONE_SOFT[item.tone] : 'bg-primary')}
                style={{ width: `${widths[index]}%` }}
              />
            </span>
            <span className="tabular-nums text-muted-foreground">{value}</span>
          </li>
        );
      })}
    </ol>
  );
}
