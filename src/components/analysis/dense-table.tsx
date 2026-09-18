import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type React from 'react';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import type { SortState } from '@/lib/monitoring/shared/table-sort';
import { TONE_EDGE, type Tone } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/** How wide the screen has to be before the column is worth its width. `always` never hides. */
export type ColumnPriority = 'always' | 'sm' | 'md' | 'lg';
export type DenseColumn = { id: string; label: string; align?: 'left' | 'right'; priority?: ColumnPriority; sortable?: boolean };
export type DenseRow = { id: string; cells: Record<string, React.ReactNode>; tone?: Tone };

/** Row density stays readable at 360 px by dropping the least important columns first. */
export function columnClass(priority: ColumnPriority | undefined): string {
  switch (priority) {
    case 'sm':
      return 'hidden sm:table-cell';
    case 'md':
      return 'hidden md:table-cell';
    case 'lg':
      return 'hidden lg:table-cell';
    default:
      return '';
  }
}

const alignClass = (column: DenseColumn) => (column.align === 'right' ? 'text-right tabular-nums' : '');

const ariaSort = (column: DenseColumn, sort: SortState | undefined) => {
  if (!sort || !column.sortable) return undefined;
  if (sort.column !== column.id) return 'none' as const;
  return sort.direction === 'asc' ? ('ascending' as const) : ('descending' as const);
};

/**
 * The dense list table: one compact row per resource, sorted through the URL so the view stays shareable.
 *
 * Sorting is one prop, not two. The state and the link builder are useless apart — a state with no builder
 * renders headers that say they are sorted but cannot be clicked, a builder with no state renders links that
 * never show which column is active — so they are passed together and the type makes either half impossible.
 * `href` builds the link of a sortable header from the page's own search params, which a server component
 * cannot read for itself.
 */
export async function DenseTable({
  caption,
  columns,
  rows,
  sorting,
  shown,
  total,
  emptyKey,
}: {
  caption: string;
  columns: readonly DenseColumn[];
  rows: readonly DenseRow[];
  sorting?: { state: SortState; href: (column: string) => string };
  shown: number;
  total: number;
  emptyKey: string;
}): Promise<React.JSX.Element> {
  const t = await getTranslations();
  const tCommon = await getTranslations('Monitoring.common');
  return (
    <div className="space-y-2">
      <Table className="text-xs">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => {
              const active = sorting?.state.column === column.id;
              return (
                <TableHead
                  key={column.id}
                  aria-sort={ariaSort(column, sorting?.state)}
                  className={cn('px-2 py-1.5 text-xs', columnClass(column.priority), alignClass(column))}
                >
                  {column.sortable && sorting ? (
                    <Link
                      href={sorting.href(column.id)}
                      aria-label={tCommon('table.sortBy', { column: column.label })}
                      className={cn(
                        'group inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                        active ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {column.label}
                      {active ? (
                        sorting.state.direction === 'asc' ? (
                          <ChevronUp className="size-3" aria-hidden />
                        ) : (
                          <ChevronDown className="size-3" aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40 group-hover:opacity-100" aria-hidden />
                      )}
                    </Link>
                  ) : (
                    column.label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        {rows.length > 0 && (
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn(row.tone && cn('border-l-2', TONE_EDGE[row.tone]))}>
                {columns.map((column) => (
                  <TableCell key={column.id} className={cn('px-2 py-1.5', columnClass(column.priority), alignClass(column))}>
                    {row.cells[column.id]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        )}
      </Table>
      {rows.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">{t(emptyKey)}</p>}
      {total > 0 && <p className="px-2 text-xs text-muted-foreground tabular-nums">{tCommon('table.showing', { shown, total })}</p>}
    </div>
  );
}
