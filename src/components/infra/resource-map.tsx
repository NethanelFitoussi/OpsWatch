import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { rollUp, type EvaluatedState } from '@/lib/monitoring/shared/evaluated-health';
import { STATE_TILE } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';
import { StatusBar } from './status-bar';

/** One resource, as one tile. `detail` is the measured line a reader gets on hover and on focus. */
export type MapTile = { id: string; label: string; state: EvaluatedState; detail: string; href: string | null };
/** Tiles gathered by a dimension that matters — an availability zone, a cluster, an instance type. */
export type MapGroup = { key: string; label: string; tiles: readonly MapTile[] };

/**
 * Every resource in a section, as coloured tiles gathered into named groups.
 *
 * It answers "how much is there, and how much of it is wrong" at a scale a table cannot: fifty green
 * tiles with two amber ones is a sentence read in half a second, and when everything is green the mass of
 * green *is* the reassurance — which is the whole reason a healthy estate needed a picture.
 *
 * Colour is the **evaluated state**, never a raw metric ramp. A heat scale of CPU makes an idle machine
 * look mildly warm and a busy healthy one look dangerous; this scale means exactly what §2.6 means.
 * A resource nobody could read is an outline with nothing in it, so a map of unread things can never be
 * mistaken for a map of healthy ones.
 *
 * The grouping dimension is named above the map rather than left to be inferred, because a map whose
 * arrangement is a guess is a map that has to be decoded before it can be read.
 */
export async function ResourceMap({
  groups,
  groupedByLabel,
  className,
}: {
  groups: readonly MapGroup[];
  /** What the groups are, in words: "by availability zone", "by cluster". */
  groupedByLabel: string;
  className?: string;
}) {
  const t = await getTranslations('Monitoring.estate');
  const total = groups.reduce((sum, group) => sum + group.tiles.length, 0);
  if (total === 0) return <p className="text-sm text-muted-foreground">{t('nothingHere')}</p>;

  return (
    <div className={cn('space-y-5', className)}>
      <p className="text-xs text-muted-foreground">{groupedByLabel}</p>
      {groups.map((group) => {
        const health = rollUp(group.tiles.map((tile) => tile.state));
        return (
          <section key={group.key} aria-label={group.label} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm font-medium">{group.label}</h3>
              <p className="text-xs text-muted-foreground tabular-nums">{t('ofTotal', { count: group.tiles.length })}</p>
            </div>
            <StatusBar group={health} />
            <ul className="flex flex-wrap gap-1.5">
              {group.tiles.map((tile) => {
                // The whole sentence, for a screen reader and for a hover: a bare coloured square says
                // nothing without it, and a tooltip that only appears on hover says nothing to a keyboard.
                const label = `${tile.label} — ${t(`state.${tile.state}`)} — ${tile.detail}`;
                const classes = cn(
                  'flex size-9 items-center justify-center rounded-md text-[10px] font-medium ring-1 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  STATE_TILE[tile.state],
                );
                return (
                  <li key={tile.id}>
                    {tile.href === null ? (
                      <span className={classes} title={label} aria-label={label} role="img" />
                    ) : (
                      <Link href={tile.href} className={cn(classes, 'hover:scale-110')} title={label} aria-label={label} />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
