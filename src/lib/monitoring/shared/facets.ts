// Facets over a client-side table. Counting always runs on the unfiltered list (spec §1b: "counts always
// reflect the unfiltered set so the user can see what they are excluding"), which is why `countFacets` takes
// the items and never the selection.

export type FacetValue = { value: string; count: number };
export type FacetGroup = { id: string; values: FacetValue[] };
export type FacetSelection = Record<string, string[]>;
export type FacetAccessors<T> = Record<string, (item: T) => string | null>;

/** The longest facet value kept from the URL. */
export const FACET_VALUE_MAX = 40;

/**
 * How many values one group, and the whole selection, keep from the URL. A real facet group offers a handful
 * of values; these bounds only exist because the URL is attacker-controlled and `applyFacets` costs items ×
 * selected values on every render. Anything past them is dropped silently — there is nothing to tell the user.
 */
export const FACET_VALUES_PER_GROUP_MAX = 50;
export const FACET_VALUES_TOTAL_MAX = 200;

export function countFacets<T>(items: readonly T[], accessors: FacetAccessors<T>): FacetGroup[] {
  return Object.entries(accessors)
    .map(([id, read]) => {
      const counts = new Map<string, number>();
      for (const item of items) {
        const value = read(item);
        if (value === null) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return {
        id,
        values: [...counts.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'en')),
      };
    })
    .filter((group) => group.values.length > 0);
}

/**
 * Reads only the known groups, deduplicates, trims blanks, bounds each value to `FACET_VALUE_MAX` and bounds
 * how many values are kept per group and in total.
 */
export function parseFacetSelection(params: Record<string, string | string[] | undefined>, groupIds: readonly string[]): FacetSelection {
  const selection: FacetSelection = {};
  let budget = FACET_VALUES_TOTAL_MAX;
  for (const id of groupIds) {
    if (budget === 0) break;
    const raw = params[id];
    if (raw === undefined) continue;
    const keep = Math.min(FACET_VALUES_PER_GROUP_MAX, budget);
    const values = new Set<string>();
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const trimmed = value.trim().slice(0, FACET_VALUE_MAX);
      if (trimmed.length === 0) continue;
      values.add(trimmed);
      if (values.size === keep) break;
    }
    if (values.size > 0) {
      selection[id] = [...values];
      budget -= values.size;
    }
  }
  return selection;
}

export function applyFacets<T>(items: readonly T[], selection: FacetSelection, accessors: FacetAccessors<T>): T[] {
  const active = Object.entries(selection).filter(([, values]) => values.length > 0);
  if (active.length === 0) return [...items];
  return items.filter((item) =>
    active.every(([id, values]) => {
      const read = accessors[id];
      if (!read) return true; // an unknown group never filters anything out
      const value = read(item);
      return value !== null && values.includes(value);
    }),
  );
}

export function toggleFacetQuery(search: string, groupId: string, value: string, checked: boolean): string {
  const params = new URLSearchParams(search);
  const kept = params.getAll(groupId).filter((v) => v !== value);
  params.delete(groupId);
  for (const v of kept) params.append(groupId, v);
  if (checked) params.append(groupId, value);
  return params.toString();
}

/** Removes every value of the given groups, keeping the rest of the query string untouched. */
export function clearFacetsQuery(search: string, groupIds: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const id of groupIds) params.delete(id);
  return params.toString();
}

export function isFacetSelected(selection: FacetSelection, groupId: string, value: string): boolean {
  return (selection[groupId] ?? []).includes(value);
}
