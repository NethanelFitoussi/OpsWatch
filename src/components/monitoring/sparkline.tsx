import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { SPARKLINE_HEIGHT, SPARKLINE_WIDTH, sparklinePoints } from '@/lib/monitoring/shared/sparkline';

/** A small trend line for a table cell; `label` describes it for screen readers. */
export function Sparkline({ values, label, max }: { values: number[]; label: string; max?: number }) {
  if (values.length === 0) return <span className="text-muted-foreground">{NO_VALUE}</span>;
  return (
    <svg
      role="img"
      aria-label={label}
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      className="overflow-visible"
      style={{ color: 'var(--series-1)' }}
    >
      <polyline
        points={sparklinePoints(values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT, max)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
