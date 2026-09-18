import { getLocale } from 'next-intl/server';
import type React from 'react';
import { ChangeArrow } from '@/components/analysis/change-arrow';
import { Link } from '@/i18n/navigation';
import type { Change, ReportRange } from '@/lib/analysis/window';
import { formatMetricValue, type MetricUnit } from '@/lib/monitoring/shared/format';
import { TONE_DOT, TONE_SOFT, type Tone } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * One headline figure: the big number, the window it covers and, when the caller compares windows, the
 * change against the previous one. `tone` tints the tile with the same soft pair the badges use, so a KPI
 * and the row it summarises carry one colour; `null` leaves the tile neutral. The dot beside the label
 * repeats the tone for a reader who cannot see the tint.
 */
export async function KpiTile({
  label,
  value,
  unit,
  tone,
  windowLabel,
  change,
  rangeKey,
  href,
}: {
  label: string;
  value: number | null;
  unit: MetricUnit;
  tone: Tone | null;
  windowLabel: string;
  change?: Change;
  rangeKey?: ReportRange;
  href?: string;
}): Promise<React.JSX.Element> {
  const locale = await getLocale();
  const className = cn(
    'flex min-w-0 flex-col gap-1 rounded-lg border p-3',
    tone ? TONE_SOFT[tone] : 'bg-card',
    href && 'transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring',
  );
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {tone && <span aria-hidden className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="text-3xl font-semibold tabular-nums">{formatMetricValue(value, unit, locale)}</span>
      <span className="text-xs text-muted-foreground">{windowLabel}</span>
      {change && rangeKey && <ChangeArrow change={change} rangeKey={rangeKey} />}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
