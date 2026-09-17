'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mergeSeriesRows } from '@/lib/monitoring/shared/chart-data';
import { formatAxisTime, formatMetricValue, type MetricUnit } from '@/lib/monitoring/shared/format';
import type { TimeRange } from '@/lib/monitoring/shared/time-range';

export type ChartSeries = { id: string; label: string; timestamps: number[]; values: number[] };

const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

export function MetricChart({ title, unit, range, series }: { title: string; unit: MetricUnit; range: TimeRange; series: ChartSeries[] }) {
  const t = useTranslations('Monitoring.client');
  const locale = useLocale();
  const captionId = useId();
  const rows = useMemo(() => mergeSeriesRows(series), [series]);
  return (
    <figure aria-labelledby={captionId} className="min-w-0 space-y-2">
      <figcaption id={captionId} className="text-sm font-medium">
        {title}
      </figcaption>
      {rows.length === 0 ? (
        <p className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t('chart.noData')}</p>
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v: number) => formatAxisTime(v, range, locale)}
                tick={{ fontSize: 11 }}
                minTickGap={32}
              />
              <YAxis width={64} tickFormatter={(v: number) => formatMetricValue(v, unit, locale)} tick={{ fontSize: 11 }} />
              <Tooltip
                labelFormatter={(v) => formatAxisTime(Number(v), range, locale)}
                formatter={(v) => formatMetricValue(Number(v), unit, locale)}
              />
              {series.map((s, i) => (
                <Line
                  key={s.id}
                  dataKey={`s${i}`}
                  name={s.label}
                  type="monotone"
                  dot={false}
                  strokeWidth={1.75}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {series.length > 1 && (
        <ul aria-label={t('chart.legend')} className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {series.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
