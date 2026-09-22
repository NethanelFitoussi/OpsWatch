/**
 * The parts of the history settings a client component may read.
 *
 * No `server-only` here on purpose, and nothing in it touches the database, AWS or Node: the form that
 * offers these choices runs in the browser, and `lib/history/settings.ts` is server-only because it reads
 * the database. `module-boundaries.test.ts` enforces that split, and caught the form importing the wrong one.
 */

/** §31.1's intervals. A custom value is allowed; these are what the form offers. */
export const HISTORY_INTERVALS = [1, 5, 10, 15, 30, 60] as const;
export type HistoryInterval = (typeof HISTORY_INTERVALS)[number];

/** How long history may be kept, as the form offers it. */
export const RETENTION_CHOICES = [30, 90, 180, 365] as const;

/**
 * What is limited while history is off, stated plainly so the trade is visible before it is made (§31.1).
 *
 * The page shows this whenever collection is disabled: an operator deciding whether to spend money on
 * polling should be able to see exactly what they are buying.
 */
export const LIMITED_WITHOUT_HISTORY = [
  'baselines',
  'anomalies',
  'whatsNew',
  'slos',
  'incidentTimelines',
  'reports',
  'correlation',
] as const;
