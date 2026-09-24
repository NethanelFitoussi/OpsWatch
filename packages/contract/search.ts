/**
 * Global search (UX-12).
 *
 * Navigation, not analysis: a result says what it is, where it is and where to go. It carries no metric
 * and no verdict OpsWatch has not already computed somewhere a client can read properly.
 *
 * `kind` is a closed list on purpose — a client renders an icon and a label per kind, and a kind it has
 * never heard of would render as nothing. Adding one is an additive change the contract test notices.
 */
import { z } from 'zod';

export const GLOBAL_SEARCH_KINDS = [
  'connection',
  'problem',
  'error',
  'alert',
  'incident',
  'deployment',
  'repository',
  'synthetic',
  'objective',
  'doc',
  'page',
  'sectionSearch',
] as const;

export const globalSearchResultSchema = z.object({
  kind: z.enum(GLOBAL_SEARCH_KINDS),
  id: z.string(),
  /** What the operator searched for, shown as the row's name. */
  title: z.string(),
  /** Type, environment and region — what stops two identically-named things being confused. */
  context: z.string(),
  /**
   * A state already measured elsewhere, where the entity has one. Absent means the entity has no state,
   * never that its state is unknown — a client must not render a missing chip as "healthy".
   */
  state: z.string().optional(),
  /** A path inside OpsWatch, never an absolute URL. */
  href: z.string(),
});
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

export const globalSearchResponseSchema = z.object({
  query: z.string(),
  items: z.array(globalSearchResultSchema),
  /**
   * Whether more matched than were returned. Search is a way to reach one thing, so the answer is
   * deliberately short — and says so rather than implying it found everything.
   */
  truncated: z.boolean(),
});
export type GlobalSearchResponse = z.infer<typeof globalSearchResponseSchema>;
