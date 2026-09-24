'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { Bucket, Population } from '@/lib/monitoring/shared/logs-search';
import { cn } from '@/lib/utils';

/**
 * When the matching lines happened, as bars.
 *
 * The bars are drawn from the rows that came back, which is the only population OpsWatch has: Logs Insights
 * returns records, not a volume series. So the caption says which population it is. Over a `sample` the
 * shape is the newest N lines and nothing more — reading it as "the traffic" would be reading a graph of
 * the limit. The Volume page answers "how much is being logged" from a CloudWatch metric instead.
 */
export function LogsTimeline({
  buckets,
  population,
  className,
}: {
  buckets: Bucket[];
  population: Population;
  className?: string;
}) {
  const t = useTranslations('Monitoring.client');
  const format = useFormatter();
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  if (buckets.length === 0 || peak === 0) return null;

  const time = (ms: number) => format.dateTime(new Date(ms), { hour: '2-digit', minute: '2-digit' });

  return (
    <figure className={className}>
      {/* A baseline under the bars, so a stretch with nothing in it reads as an empty stretch of the range
          rather than as blank space where a chart failed to draw. */}
      <div
        className="flex h-16 items-end gap-px border-b"
        role="img"
        aria-label={t('logs.timeline.alt', { count: buckets.reduce((sum, b) => sum + b.count, 0) })}
      >
        {buckets.map((bucket) => (
          <div
            key={bucket.startMs}
            className="flex h-full flex-1 items-end"
            title={t('logs.timeline.bucket', { count: bucket.count, from: time(bucket.startMs), to: time(bucket.endMs) })}
          >
            <div
              className={cn('w-full rounded-t-[2px]', bucket.count === 0 ? 'bg-muted' : 'bg-primary/70')}
              // A bucket with events is never invisible: one line still has to be findable on the axis.
              // A bucket with none still gets a sliver, so the axis reads as an axis.
              style={{ height: bucket.count === 0 ? '2px' : `${Math.max(6, (bucket.count / peak) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{time(buckets[0].startMs)}</span>
        <span>{time(buckets[buckets.length - 1].endMs)}</span>
      </div>
      <figcaption className="mt-1 text-xs text-muted-foreground">
        {population === 'sample' ? t('logs.timeline.sample') : t('logs.timeline.complete')}
      </figcaption>
    </figure>
  );
}
