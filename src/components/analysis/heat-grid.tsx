import { getLocale, getTranslations } from 'next-intl/server';
import type React from 'react';
import { Link } from '@/i18n/navigation';
import { formatMetricValue, type MetricUnit } from '@/lib/monitoring/shared/format';
import { TONE_DOT, TONE_SOFT, type Tone } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

export type HeatCell = { id: string; name: string; value: number | null; tone: Tone | null; href: string };

const LEGEND = ['success', 'warning', 'danger', 'unknown'] as const;

/**
 * A fleet at a glance: one small coloured tile per resource, each a link to it.
 *
 * A tile is too small for its name, so the name and the figure live in the tile's `title` (hover, no
 * JavaScript) and in a screen-reader copy, and only the first two characters are drawn. `role="list"` is
 * written out because the grid removes the list markers, which drops the role in Safari.
 */
export async function HeatGrid({
  label,
  cells,
  unit,
}: {
  label: string;
  cells: readonly HeatCell[];
  unit: MetricUnit;
}): Promise<React.JSX.Element> {
  const t = await getTranslations('Monitoring.common');
  const locale = await getLocale();
  return (
    <div className="space-y-2">
      <ul
        role="list"
        aria-label={label}
        className="grid gap-1"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(2.5rem, 1fr))' }}
      >
        {cells.map((cell) => {
          const text = `${cell.name} — ${formatMetricValue(cell.value, unit, locale)}`;
          return (
            <li key={cell.id} className="min-w-0">
              <Link
                href={cell.href}
                title={text}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-sm text-[10px] font-medium uppercase transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring',
                  cell.tone ? TONE_SOFT[cell.tone] : 'bg-muted text-muted-foreground',
                )}
              >
                <span aria-hidden>{cell.name.slice(0, 2)}</span>
                <span className="sr-only">{text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', key === 'unknown' ? 'bg-muted-foreground/40' : TONE_DOT[key])} />
            {t(`heat.${key}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
