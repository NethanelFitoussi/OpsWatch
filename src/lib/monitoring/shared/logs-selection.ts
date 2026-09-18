/**
 * Log group selection, shared by the picker and the query editor. Pure string work: the picker filters
 * the groups it already loaded in the browser, so typing costs no AWS call and no round trip.
 */

/** Does this log group name contain the typed text? Blank keeps everything. */
export function matchesGroupFilter(name: string, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  return needle === '' || name.toLowerCase().includes(needle);
}

/** Ticks or unticks one group, keeping selection order and never going past the cap the API enforces. */
export function toggleGroup(selected: readonly string[], name: string, checked: boolean, max: number): string[] {
  if (!checked) return selected.filter((group) => group !== name);
  if (selected.includes(name) || selected.length >= max) return [...selected];
  return [...selected, name];
}

/** The current query string with `group` rewritten from the selection; the range and the prefix ride along. */
export function withGroups(search: string, groups: readonly string[]): string {
  const params = new URLSearchParams(search);
  params.delete('group');
  for (const group of groups) params.append('group', group);
  return params.toString();
}
