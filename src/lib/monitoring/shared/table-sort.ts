// Sortable table columns for client-side tables. Encoded in the URL as `sort=<column>:<direction>`.

export type SortDirection = 'asc' | 'desc';
export type SortState = { column: string; direction: SortDirection };
export type SortAccessors<T> = Record<string, (row: T) => number | string | null>;

export function parseSort(value: string | string[] | undefined, columns: readonly string[], fallback: SortState): SortState {
  const first = Array.isArray(value) ? value[0] : value;
  const [column, direction] = (first ?? '').split(':');
  if (!columns.includes(column)) return fallback;
  return { column, direction: direction === 'desc' ? 'desc' : 'asc' };
}

export function sortRows<T>(rows: readonly T[], state: SortState, accessors: SortAccessors<T>): T[] {
  const read = accessors[state.column];
  if (!read) return [...rows];
  const sign = state.direction === 'asc' ? 1 : -1;
  // Decorate with the original index so ties keep their input order in both directions.
  return rows
    .map((row, index) => ({ row, index, key: read(row) }))
    .sort((a, b) => {
      // Nulls sort last whichever way the column points: an absent value is never "the best" or "the worst".
      if (a.key === null && b.key === null) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      const compared = typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key), 'en');
      return compared === 0 ? a.index - b.index : compared * sign;
    })
    .map((entry) => entry.row);
}

export function nextDirection(column: string, current: SortState): SortDirection {
  return current.column === column && current.direction === 'desc' ? 'asc' : 'desc';
}

export function sortQuery(search: string, column: string, current: SortState): string {
  const params = new URLSearchParams(search);
  params.set('sort', `${column}:${nextDirection(column, current)}`);
  return params.toString();
}
