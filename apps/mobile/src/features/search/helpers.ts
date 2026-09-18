/**
 * Pure search helpers: grouping results for display, the minimum query length and the icons of each group.
 */
import type { RefType, SearchResult } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import type { IconName } from '@/ui/layout';

export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 300;

/** Display order of the groups. Types outside this list are shown last, under "Other". */
export const SEARCH_GROUP_ORDER = ['problem', 'error', 'service', 'infrastructure', 'alert', 'incident'] as const satisfies readonly RefType[];
export type SearchGroupKey = (typeof SEARCH_GROUP_ORDER)[number] | 'other';

export const SEARCH_GROUP_META: Record<SearchGroupKey, { label: MessageKey; icon: IconName }> = {
  problem: { label: 'search.group.problem', icon: 'flash-outline' },
  error: { label: 'search.group.error', icon: 'bug-outline' },
  service: { label: 'search.group.service', icon: 'layers-outline' },
  infrastructure: { label: 'search.group.infrastructure', icon: 'server-outline' },
  alert: { label: 'search.group.alert', icon: 'notifications-outline' },
  incident: { label: 'search.group.incident', icon: 'flame-outline' },
  other: { label: 'search.group.other', icon: 'ellipsis-horizontal-circle-outline' },
};

export type SearchGroup = { key: SearchGroupKey; items: SearchResult[] };

function groupOf(type: RefType): SearchGroupKey {
  return (SEARCH_GROUP_ORDER as readonly RefType[]).includes(type) ? (type as SearchGroupKey) : 'other';
}

/** Groups results by type in a fixed order, keeping the server's order inside each group and dropping empty groups. */
export function groupSearchResults(results: readonly SearchResult[]): SearchGroup[] {
  const buckets = new Map<SearchGroupKey, SearchResult[]>();
  for (const result of results) {
    const key = groupOf(result.type);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(result);
    else buckets.set(key, [result]);
  }
  const order: SearchGroupKey[] = [...SEARCH_GROUP_ORDER, 'other'];
  return order.filter((key) => buckets.has(key)).map((key) => ({ key, items: buckets.get(key)! }));
}

/** True when the text is long enough to search. */
export function isSearchable(text: string): boolean {
  return text.trim().length >= MIN_SEARCH_LENGTH;
}
