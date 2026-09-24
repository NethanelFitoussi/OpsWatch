'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { DocLink } from '@/components/docs/doc-link';
import { MetricChart } from '@/components/monitoring/metric-chart';
import type { LifecycleMark, ProblemSeries } from '@/lib/read/diagnosis';
import { TONE_DOT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * What a problem looked like over time, drawn rather than described.
 *
 * Two pieces, and they answer different questions. The **timeline** answers "when did this start, has it
 * come back, is it over" and is always available, because the events spine is written whether or not
 * historical collection is on. The **chart** answers "how bad, compared with what" and exists only where
 * rollups were stored.
 *
 * **An empty chart is never drawn.** A line at zero and "nobody collected this" look identical and mean
 * opposite things, so the absence is a sentence instead.
 */

const MARK_TONE: Record<LifecycleMark['kind'], string> = {
  opened: TONE_DOT.warning,
  reopened: TONE_DOT.warning,
  resolved: TONE_DOT.success,
  deployment: 'bg-muted-foreground',
};

/** Where a mark sits along the strip, as a share of the window it is drawn over. */
function positionOf(at: number, from: number, to: number): number {
  if (to <= from) return 0;
  return Math.min(100, Math.max(0, ((at - from) / (to - from)) * 100));
}

export function ProblemTimeline({ marks }: { marks: LifecycleMark[] }) {
  const t = useTranslations('Monitoring.diagnosis');
  const format = useFormatter();
  if (marks.length === 0) return null;

  const from = marks[0].at;
  const to = marks[marks.length - 1].at;
  const single = to <= from;

  return (
    <div>
      {/* The strip is decoration over the list: it shows the shape, and the list carries the facts. */}
      {!single && (
        <div className="relative h-8" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          {marks.map((mark, index) => (
            <span
              key={`${mark.at}-${index}`}
              className={cn('absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full', MARK_TONE[mark.kind])}
              style={{ left: `${positionOf(mark.at, from, to)}%` }}
            />
          ))}
        </div>
      )}
      <ol className="mt-1 space-y-1 text-sm">
        {marks.map((mark, index) => (
          <li key={`${mark.at}-${index}-row`} className="flex flex-wrap items-baseline gap-2">
            <span className={cn('size-2 shrink-0 rounded-full', MARK_TONE[mark.kind])} aria-hidden />
            <span>{t(`mark.${mark.kind}`)}</span>
            <span className="text-xs text-muted-foreground">{format.dateTime(new Date(mark.at), { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ProblemChart({ series, historyEnabled }: { series: ProblemSeries[]; historyEnabled: boolean }) {
  const t = useTranslations('Monitoring.diagnosis');

  // Two different emptinesses, told apart. Only one of them is something the operator can change.
  if (series.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{historyEnabled ? t('noSeriesYet') : t('noHistory')}</p>
        {/* An honest empty state that leaves the reader stuck is still a dead end. */}
        {!historyEnabled && <DocLink slug="history" label={t('historyGuide')} />}
      </div>
    );
  }

  return (
    <MetricChart
      title={t('measuredOverTime')}
      unit="count"
      // The window the rollups cover is the window the chart draws; a fixed range would crop or pad it.
      range="24h"
      series={series.map((one) => ({ id: one.metric, label: t(`series.${one.metric}`), timestamps: one.timestamps, values: one.values }))}
    />
  );
}
