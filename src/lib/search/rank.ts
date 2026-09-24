/**
 * Finding something by the name an operator already knows.
 *
 * Pure: candidates and a query in, a ranked list out. No database, no clock, no locale — which is what
 * lets the ranking be argued with in a test rather than judged by eye.
 *
 * **This is navigation, not analysis.** Search exists so somebody who remembers `alb-gigs-prod` can reach
 * it in two keystrokes, not so they can ask questions of it. Everything here is about getting the right
 * row to the top; nothing here computes anything about the thing it found.
 */

/** Only kinds with something real behind them. A kind with no backing capability is not offered. */
type ResultKind =
  | 'connection'
  | 'problem'
  | 'error'
  | 'alert'
  | 'incident'
  | 'deployment'
  | 'repository'
  | 'synthetic'
  | 'objective'
  | 'doc'
  | 'page'
  | 'sectionSearch';

export type SearchCandidate = {
  kind: ResultKind;
  id: string;
  /** What the operator typed at, and what the row shows in bold. */
  title: string;
  /** Type, environment, region — the line that stops two identically-named things being confused. */
  context: string;
  /** A measured state to show as a chip, where the entity has one. Never invented. */
  state?: string;
  href: string;
  /** Extra words that should match without being shown: an ARN, an account number, a synonym. */
  terms?: readonly string[];
};

export type SearchResult = SearchCandidate & { score: number };

/**
 * How much a candidate is worth, given the words typed.
 *
 * Every word has to match something, or the candidate is out: typing two words should narrow, not widen.
 * Beyond that the ordering is about *where* the match landed — a title beats a context beats a hidden
 * term, and a title that starts with the query beats one that merely contains it, because somebody
 * typing `web` wants `web` before `dev-dog-walker-web`.
 */
export function scoreCandidate(candidate: SearchCandidate, words: readonly string[]): number {
  const title = candidate.title.toLowerCase();
  const context = candidate.context.toLowerCase();
  const terms = (candidate.terms ?? []).join(' ').toLowerCase();

  let score = 0;
  for (const word of words) {
    const inTitle = title.includes(word);
    const inContext = context.includes(word);
    const inTerms = terms.includes(word);
    if (!inTitle && !inContext && !inTerms) return 0;

    if (title === word) score += 40;
    else if (title.startsWith(word)) score += 24;
    else if (inTitle) score += 12;
    if (inContext) score += 4;
    if (inTerms) score += 2;
  }
  return score;
}

/** The words a query is made of. Empty for an empty query, which is how "show me nothing yet" is said. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter((word) => word.length > 0);
}

/**
 * How kinds break a tie.
 *
 * A live problem outranks the documentation about problems: somebody who types a service name at 3am
 * wants the thing that is wrong, and somebody who wants to read about it can see it one row down.
 */
const KIND_WEIGHT: Record<ResultKind, number> = {
  problem: 9,
  incident: 8,
  alert: 7,
  error: 6,
  connection: 5,
  deployment: 4,
  synthetic: 4,
  objective: 4,
  repository: 3,
  page: 2,
  doc: 2,
  // Always last: it is an offer to look somewhere OpsWatch has not indexed, not a thing it found.
  sectionSearch: 0,
};

export function rank(candidates: readonly SearchCandidate[], query: string, limit: number): SearchResult[] {
  const words = queryWords(query);
  if (words.length === 0) return [];

  return candidates
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, words) }))
    .filter((result) => result.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_WEIGHT[b.kind] - KIND_WEIGHT[a.kind] ||
        a.title.localeCompare(b.title, 'en') ||
        a.id.localeCompare(b.id, 'en'),
    )
    .slice(0, limit);
}
