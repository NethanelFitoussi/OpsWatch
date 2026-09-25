'use client';

import { AlertTriangle, Clock, ServerCrash, Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LogLevel } from '@/lib/monitoring/shared/logs-search';

/**
 * What to offer somebody who has not searched yet.
 *
 * The page used to open on an empty query box beside an empty results panel: an enormous void that told
 * a reader nothing about what they could ask. These are the four questions people actually arrive with,
 * each one a real search rather than a suggestion — pressing one runs it.
 */

export type QuickSearch = { id: string; text: string; level: LogLevel | null };

export const QUICK_SEARCHES: QuickSearch[] = [
  { id: 'errors', text: '', level: 'error' },
  { id: 'serverErrors', text: '500', level: null },
  { id: 'timeouts', text: 'timeout', level: null },
  { id: 'latest', text: '', level: null },
];

const ICONS = { errors: AlertTriangle, serverErrors: ServerCrash, timeouts: Timer, latest: Clock } as const;

export function QuickSearches({ onPick }: { onPick: (quick: QuickSearch) => void }) {
  const t = useTranslations('Monitoring.client');
  return (
    <div className="flex flex-wrap gap-2">
      {QUICK_SEARCHES.map((quick) => {
        const Icon = ICONS[quick.id as keyof typeof ICONS];
        return (
          <button
            key={quick.id}
            type="button"
            onClick={() => onPick(quick)}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            {t(`logs.quick.${quick.id}`)}
          </button>
        );
      })}
    </div>
  );
}
