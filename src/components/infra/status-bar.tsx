import { getTranslations } from 'next-intl/server';
import { EVALUATED_STATES, type EvaluatedState, type GroupHealth } from '@/lib/monitoring/shared/evaluated-health';
import { STATE_FILL } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * The composition of a set, in the height of a table row.
 *
 * A stacked bar and the exact numbers at once: the segment says how much, and the count printed beside it
 * says how much of what. A bar whose numbers live only in a tooltip makes the reader infer what they are
 * looking at, which is the failure this product keeps having to fix.
 *
 * A state with none of anything is left out of the bar and out of the legend — except `unknown` and
 * `stale`, which are printed at zero when anything at all was counted. "Nothing unmeasured" is worth
 * saying; it is the sentence that makes the green beside it mean something.
 */
export async function StatusBar({ group, className }: { group: GroupHealth; className?: string }) {
  const t = await getTranslations('Monitoring.estate');
  if (group.total === 0) return <p className={cn('text-sm text-muted-foreground', className)}>{t('nothingHere')}</p>;

  const shown = EVALUATED_STATES.filter((state) => group.counts[state] > 0);
  const legend = EVALUATED_STATES.filter(
    (state) => group.counts[state] > 0 || state === 'unknown' || state === 'stale',
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={legend.map((state) => t(`countOf.${state}`, { count: group.counts[state] })).join(', ')}
      >
        {shown.map((state) => (
          <span
            key={state}
            className={cn('h-full', STATE_FILL[state])}
            style={{ width: `${(group.counts[state] / group.total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-hidden>
        {legend.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span className={cn('size-2 shrink-0 rounded-full', STATE_FILL[state])} />
            <span className="tabular-nums">{group.counts[state]}</span>
            <span className="text-muted-foreground">{t(`state.${state}` satisfies `state.${EvaluatedState}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
