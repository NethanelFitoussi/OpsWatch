'use client';

import { ChevronRight } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { detectLevel, rowTimeMs, type LogLevel } from '@/lib/monitoring/shared/logs-search';
import { cn } from '@/lib/utils';

/**
 * The log lines themselves: one row each, expandable.
 *
 * Compact by default because reading logs is scanning, and a card per line turns eighty lines into eight
 * screens. Expanding shows every field Logs Insights returned for that record, including the ones the
 * compact row has no space for.
 *
 * Every value is rendered as text. A log line is untrusted input — it is whatever some process wrote — and
 * it never becomes markup here.
 */

/** Level colours. Neutral for a line that announces no level, which is not the same as `info`. */
const LEVEL_TONE: Record<LogLevel, string> = {
  error: 'text-red-700 dark:text-red-400',
  warn: 'text-amber-700 dark:text-amber-400',
  info: 'text-muted-foreground',
  debug: 'text-muted-foreground',
};

function LogRow({ row, fields }: { row: Record<string, string>; fields: string[] }) {
  const t = useTranslations('Monitoring.client');
  const format = useFormatter();
  const [open, setOpen] = useState(false);

  const message = row['@message'] ?? '';
  const level = detectLevel(message);
  const ms = rowTimeMs(row['@timestamp']);

  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {/* Null rather than a guess: a row whose timestamp AWS did not send has no time to print. */}
          {ms === null ? '—' : format.dateTime(new Date(ms), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        {level !== null && <span className={cn('w-12 shrink-0 font-mono text-[11px] uppercase', LEVEL_TONE[level])}>{level}</span>}
        <span className={cn('min-w-0 flex-1 font-mono text-xs', open ? 'break-all whitespace-pre-wrap' : 'truncate')}>{message || t('logs.rows.noMessage')}</span>
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-3 pl-9">
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
            {fields.map((field) => (
              <div key={field} className="contents">
                <dt className="font-mono text-[11px] text-muted-foreground">{field}</dt>
                <dd className="font-mono text-xs break-all whitespace-pre-wrap">{row[field] ?? ''}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={message} label={t('logs.rows.copyMessage')} text={t('logs.rows.message')} />
            <CopyButton value={JSON.stringify(row, null, 2)} label={t('logs.rows.copyRow')} text={t('logs.rows.record')} />
          </div>
        </div>
      )}
    </li>
  );
}

export function LogsRows({ rows, fields }: { rows: Record<string, string>[]; fields: string[] }) {
  const t = useTranslations('Monitoring.client');
  return (
    <ul className="rounded-md border" aria-label={t('logs.results.label')}>
      {rows.map((row, index) => (
        // Logs Insights rows have no stable id once @ptr is dropped, and the list is replaced wholesale.
        <LogRow key={index} row={row} fields={fields} />
      ))}
    </ul>
  );
}
