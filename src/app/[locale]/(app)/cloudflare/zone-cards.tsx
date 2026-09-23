'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { MetricChart } from '@/components/monitoring/metric-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ZonePoint, ZoneSummary } from '@/lib/read/cloudflare';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * One zone, as figures and a chart (CF-2).
 *
 * Every number is a count Cloudflare reported or a ratio of two of them. **A ratio with nothing to divide
 * by is absent, not zero**: a zone with no traffic has not got a 0 % cache hit rate, and showing one would
 * invent a measurement out of an absence.
 */

/** Bytes, at the scale a human reads them. */
function bytes(value: number): { value: number; unit: 'B' | 'KB' | 'MB' | 'GB' | 'TB' } {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let scaled = value;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return { value: Math.round(scaled * 10) / 10, unit: units[index] };
}

/** A day's key as a moment, so the chart's axis is a time axis rather than a list of strings. */
const atOf = (day: ZonePoint) => Date.parse(`${day.date}T00:00:00Z`);

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warning' | 'danger' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-xl font-semibold tabular-nums', tone && TONE_TEXT[tone])}>{value}</p>
      {hint !== undefined && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ZoneCard({ zone }: { zone: ZoneSummary }) {
  const t = useTranslations('Monitoring.cloudflare');
  const format = useFormatter();
  const percent = (value: number | null) => (value === null ? t('noRatio') : t('percent', { value: Number((value * 100).toFixed(2)) }));
  const size = bytes(zone.bytes);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold">
          {zone.name}
          {/* Only where there are two days to compare. A first day against nothing is not a trend. */}
          {zone.requestsTrend !== null && (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              {zone.requestsTrend >= 0 ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
              {t('trend', { value: Number((zone.requestsTrend * 100).toFixed(0)) })}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label={t('requests')} value={format.number(zone.requests)} />
          <Figure label={t('bandwidth')} value={`${format.number(size.value)} ${size.unit}`} />
          <Figure label={t('cacheHit')} value={percent(zone.cacheHitRate)} hint={t('cacheHitHint')} />
          <Figure label={t('cachedBytes')} value={percent(zone.cachedByteShare)} />
          <Figure
            label={t('serverErrors')}
            value={percent(zone.serverErrorRate)}
            // A 5xx is usually yours; colour it only when there is a measured rate to colour.
            tone={zone.serverErrorRate !== null && zone.serverErrorRate > 0.01 ? 'danger' : undefined}
          />
          <Figure label={t('threats')} value={format.number(zone.threats)} hint={t('threatsHint')} />
        </div>

        {/* Two days or there is no shape to draw; one point is a dot, not a trend. */}
        {zone.days.length > 1 && (
          <MetricChart
            title={t('requestsOverTime')}
            unit="count"
            range="7d"
            series={[
              {
                id: 'requests',
                label: t('requests'),
                timestamps: zone.days.map(atOf),
                values: zone.days.map((day) => day.requests),
              },
              {
                id: 'cached',
                label: t('cachedRequests'),
                timestamps: zone.days.map(atOf),
                values: zone.days.map((day) => day.cachedRequests),
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
