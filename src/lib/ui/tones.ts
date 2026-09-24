// One place for the status colours. Tailwind only generates classes it finds written out in full,
// so every combination is spelled out here rather than built from a colour name.

export type Tone = 'info' | 'success' | 'warning' | 'danger';

/** Filled badges. */
export const TONE_SOFT = {
  info: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  success: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  danger: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
} as const satisfies Record<Tone, string>;

/** Icons and short status text. */
export const TONE_TEXT = {
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
} as const satisfies Partial<Record<Tone, string>>;

/** Borders of a card or callout that carries a tone. */
export const TONE_BORDER = {
  warning: 'border-amber-300/70 dark:border-amber-800/60',
  danger: 'border-red-200 dark:border-red-900',
} as const satisfies Partial<Record<Tone, string>>;

/** Small status dots. */
export const TONE_DOT = {
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
} as const satisfies Record<Tone, string>;

/** The 2 px left edge of a dense table row that carries a tone. */
export const TONE_EDGE = {
  info: 'border-l-sky-500',
  success: 'border-l-emerald-500',
  warning: 'border-l-amber-500',
  danger: 'border-l-red-500',
} as const satisfies Record<Tone, string>;

/**
 * The five evaluated states, as colour.
 *
 * `unknown` and `stale` are deliberately not a colour at all — an outline and the page's own foreground.
 * Giving "OpsWatch could not tell" a hue of its own would put it on the same scale as healthy and broken,
 * and it is not on that scale: it is the admission that the scale was never applied.
 */
export const STATE_TILE = {
  healthy: 'bg-emerald-500/85 text-white ring-emerald-600/40 dark:bg-emerald-500/70',
  warning: 'bg-amber-500/85 text-amber-950 ring-amber-600/40 dark:bg-amber-500/75',
  critical: 'bg-red-600/90 text-white ring-red-700/40 dark:bg-red-600/80',
  unknown: 'bg-transparent text-muted-foreground ring-border ring-dashed',
  stale: 'bg-transparent text-muted-foreground ring-border ring-dashed',
} as const;

/** The same five as a solid dot or a bar segment, where there is no tile to fill. */
export const STATE_FILL = {
  healthy: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-600',
  // Neutral, never a hue — but the two must be told apart in a legend, and a bar segment must be visible
  // against the bar's own track. `/30` over `bg-muted` was indistinguishable from an empty bar, which read
  // as "we counted three of four" rather than as "one of these was never evaluated".
  unknown: 'bg-muted-foreground/45',
  stale: 'bg-muted-foreground/75',
} as const;

/** Short status text, where the word carries the state rather than a shape. */
export const STATE_TEXT = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
  unknown: 'text-muted-foreground',
  stale: 'text-muted-foreground',
} as const;
