import { STATE_FILL } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * A number, and — only where the number has a ceiling — a bar showing how much of it is used.
 *
 * The bar is what lets a column be scanned for outliers before a single figure is read. It is drawn only
 * when there is a real maximum to be a fraction of: a percentage has one, a count of connections does
 * not, and a bar under a scale nobody stated is a picture of nothing.
 */
export function MetricCell({
  value,
  max,
  warnAt,
  failAt,
  suffix,
  missing,
  className,
}: {
  value: number | null;
  /** The ceiling the bar is a fraction of. Omit it and no bar is drawn. */
  max?: number;
  /**
   * The thresholds that colour the bar, where the metric has real ones — the same constants the detector
   * judges it by. Without them the bar is drawn in a neutral tone, because **magnitude is not severity**:
   * a bar that turns amber at some generic fraction once showed 83 % engine CPU in green beside a verdict
   * of "needs attention", which is the picture arguing with the words.
   */
  warnAt?: number;
  failAt?: number;
  suffix?: string;
  /** What to render when the value was not measured — never a zero. */
  missing: string;
  className?: string;
}) {
  if (value === null) return <span className={cn('text-muted-foreground', className)}>{missing}</span>;

  const share = max !== undefined && max > 0 ? Math.min(1, Math.max(0, value / max)) : null;
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="tabular-nums">
        {value}
        {suffix}
      </span>
      {share !== null && (
        <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className={cn(
              'block h-full',
              failAt !== undefined && value >= failAt
                ? STATE_FILL.critical
                : warnAt !== undefined && value >= warnAt
                  ? STATE_FILL.warning
                  : warnAt === undefined && failAt === undefined
                    ? 'bg-primary/60'
                    : STATE_FILL.healthy,
            )}
            style={{ width: `${share * 100}%` }}
          />
        </span>
      )}
    </span>
  );
}
