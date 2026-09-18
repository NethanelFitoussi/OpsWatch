'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Link, usePathname } from '@/i18n/navigation';
import { clearFacetsQuery, type FacetSelection, isFacetSelected, toggleFacetQuery } from '@/lib/monitoring/shared/facets';
import { cn } from '@/lib/utils';

/** A counted facet group, already labelled: the counts always come from the unfiltered list. */
export type FacetGroupView = { id: string; label: string; values: { value: string; label: string; count: number }[] };

/**
 * The filters beside a dense list. Every value is a plain link that toggles it in the query string, so
 * filtering works without JavaScript and the filtered view stays shareable; the checkbox only shows the
 * state. Below 1024 px the panel folds into a `<details>`.
 */
export function FacetsPanel({ groups, selection }: { groups: FacetGroupView[]; selection: FacetSelection }): React.JSX.Element | null {
  const t = useTranslations('Monitoring.client');
  const pathname = usePathname();
  const search = useSearchParams().toString();
  if (groups.length === 0) return null;

  const active = groups.reduce(
    (count, group) => count + group.values.filter((value) => isFacetSelected(selection, group.id, value.value)).length,
    0,
  );
  const body = (
    <div className="space-y-4">
      {groups.map((group) => (
        <fieldset key={group.id}>
          <legend className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.label}</legend>
          <ul>
            {group.values.map((value) => {
              const checked = isFacetSelected(selection, group.id, value.value);
              return (
                <li key={value.value}>
                  <Link
                    href={`${pathname}?${toggleFacetQuery(search, group.id, value.value, !checked)}`}
                    aria-pressed={checked}
                    className={cn(
                      'flex items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                      checked && 'font-medium',
                    )}
                  >
                    {/* The link does the navigating; the box is only the state, never a second tab stop. */}
                    <Checkbox checked={checked} tabIndex={-1} aria-hidden className="pointer-events-none" />
                    <span className="truncate">{value.label}</span>
                    <span className="ml-auto tabular-nums text-xs text-muted-foreground">{value.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
      {active > 0 && (
        <Link
          href={`${pathname}?${clearFacetsQuery(
            search,
            groups.map((group) => group.id),
          )}`}
          className="inline-block px-1 text-sm underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t('facets.clear')}
        </Link>
      )}
    </div>
  );

  return (
    <nav aria-label={t('facets.label')}>
      <details className="rounded-md border p-2 lg:hidden">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          {t('facets.label')}
          {active > 0 && <span className="text-xs font-normal text-muted-foreground">{t('facets.active', { count: active })}</span>}
        </summary>
        <div className="mt-3">{body}</div>
      </details>
      <div className="hidden lg:block">{body}</div>
    </nav>
  );
}
