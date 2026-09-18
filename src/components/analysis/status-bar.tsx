import type React from 'react';
import { Link } from '@/i18n/navigation';
import { TONE_DOT, TONE_SOFT, type Tone } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/** One state of the list, already counted and already worded (e.g. "3 degraded"). */
export type StatusSegment = { key: string; label: string; count: number; tone: Tone; href: string };

/**
 * The coloured bar over a dense list: every state as a segment as wide as its share, with the count written
 * on it. Colour is never the only signal — each segment carries its label as text, and the legend under the
 * bar repeats every segment as a dot plus its label so the bar still reads at 360 px.
 *
 * The bar is a list of links, not a picture of one: `role="img"` would collapse it into a single image and
 * take the links with it, leaving a keyboard or screen-reader user no way to filter the list by state.
 */
export async function StatusBar({
  segments,
  label,
}: {
  segments: readonly StatusSegment[];
  label: string;
}): Promise<React.JSX.Element | null> {
  const shown = segments.filter((segment) => segment.count > 0);
  if (shown.length === 0) return null;
  return (
    <div className="space-y-2">
      <ul aria-label={label} className="flex h-6 w-full overflow-hidden rounded-md">
        {shown.map((segment) => (
          <li key={segment.key} style={{ flexGrow: segment.count }} className="flex min-w-0 basis-0">
            <Link
              href={segment.href}
              title={segment.label}
              className={cn(
                'flex w-full min-w-0 items-center justify-center overflow-hidden px-1.5 text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring',
                TONE_SOFT[segment.tone],
              )}
            >
              {/* The segment may be too narrow for its text, and a server render cannot measure it: keep the
                  label both as (clipped) text and in a screen-reader copy, which is also the link's name. */}
              <span aria-hidden className="truncate tabular-nums">
                {segment.label}
              </span>
              <span className="sr-only">{segment.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {shown.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', TONE_DOT[segment.tone])} />
            <span className="tabular-nums">{segment.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
