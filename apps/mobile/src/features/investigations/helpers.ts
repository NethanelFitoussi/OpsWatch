/**
 * Pure helpers for investigations and repository evidence.
 */
import type { Evidence, EvidenceKind, RepositoryEvidence } from '@/api/contract';
import type { IconName } from '@/ui/layout';

export const INVESTIGATION_VIEWS = ['all', 'kind'] as const;
export type InvestigationView = (typeof INVESTIGATION_VIEWS)[number];

const KIND_ORDER: Record<EvidenceKind, number> = { fact: 0, correlation: 1, hypothesis: 2 };

/** Every item in time order; at the same instant facts come before correlations, and those before hypotheses. */
export function chronological(timeline: Evidence[]): Evidence[] {
  return [...timeline].sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/**
 * The timeline in order, with the day label attached to the first item of each day. A timeline that crosses midnight
 * would otherwise show "23:50" then "00:10" with nothing saying a day went by.
 */
export function withDayBreaks(timeline: Evidence[], dayOf: (at: number) => string): { item: Evidence; day: string | null }[] {
  let previous: string | null = null;
  return chronological(timeline).map((item) => {
    const day = dayOf(item.at);
    const isFirstOfDay = day !== previous;
    previous = day;
    return { item, day: isFirstOfDay ? day : null };
  });
}

export function countByKind(timeline: Evidence[]): Record<EvidenceKind, number> {
  const counts: Record<EvidenceKind, number> = { fact: 0, correlation: 0, hypothesis: 0 };
  for (const item of timeline) counts[item.kind] += 1;
  return counts;
}

export const KIND_ICONS: Record<EvidenceKind, IconName> = {
  fact: 'eye-outline',
  correlation: 'git-compare-outline',
  hypothesis: 'bulb-outline',
};

/** Highlighted snippet lines restricted to the lines the snippet actually shows. */
export function visibleHighlights(snippet: NonNullable<RepositoryEvidence['snippet']>): number[] {
  const end = snippet.startLine + snippet.code.length - 1;
  return snippet.highlight.filter((line) => line >= snippet.startLine && line <= end);
}

/** "src/pricing/cart-pricing.ts" → directory "src/pricing/" and name "cart-pricing.ts", so the name can lead. */
export function splitPath(path: string): { directory: string | null; name: string } {
  const index = path.lastIndexOf('/');
  const name = path.slice(index + 1);
  return index === -1 || name === '' ? { directory: null, name: path } : { directory: path.slice(0, index + 1), name };
}
