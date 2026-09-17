'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import { TIME_RANGES, type TimeRange } from '@/lib/monitoring/shared/time-range';
import { cn } from '@/lib/utils';

export function TimeRangeSelector({ current, ranges = TIME_RANGES }: { current: TimeRange; ranges?: readonly TimeRange[] }) {
  const t = useTranslations('Monitoring.client');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <nav aria-label={t('range.label')}>
      <ul className="flex overflow-hidden rounded-md border">
        {ranges.map((range) => {
          const query = new URLSearchParams(searchParams.toString());
          query.set('range', range);
          const active = range === current;
          return (
            <li key={range} className="border-l first:border-l-0">
              <Link
                href={`${pathname}?${query.toString()}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block px-2.5 py-1 text-sm whitespace-nowrap transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  active ? 'bg-accent font-medium' : 'text-muted-foreground',
                )}
              >
                {t(`range.options.${range}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
