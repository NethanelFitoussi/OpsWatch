import { Minus, Sparkle, TrendingDown, TrendingUp } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type React from 'react';
import type { Change, ReportRange } from '@/lib/analysis/window';
import { NO_VALUE } from '@/lib/monitoring/shared/format';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/** The percentage on its own, for the arrow's label and for the same figure inside a Markdown report. */
export function changeText(change: Change, locale: string): string {
  if (change.kind === 'new' || change.kind === 'unavailable') return NO_VALUE;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(change.ratio);
}

const ICONS = { up: TrendingUp, down: TrendingDown, flat: Minus, new: Sparkle, unavailable: null } as const;

const ICON_TONE: Record<Change['kind'], string> = {
  up: TONE_TEXT.danger,
  down: TONE_TEXT.success,
  flat: 'text-muted-foreground',
  new: 'text-muted-foreground',
  unavailable: 'text-muted-foreground',
};

/**
 * How one figure moved against the previous window of the same length.
 *
 * A rise is coloured as the bad direction, because every metric this stage ranks — CPU, errors, latency,
 * bytes — is worse when it rises. No report of this stage ranks a metric where a rise is the good direction;
 * a caller that one day does must not use this component, or the colour would lie.
 *
 * Colour and an icon are never the only signal: the percentage is written out, and a screen reader is given
 * the whole sentence ("Up 20% against the previous 12 hours") exactly once.
 */
export async function ChangeArrow({ change, rangeKey }: { change: Change; rangeKey: ReportRange }): Promise<React.JSX.Element> {
  const t = await getTranslations('Monitoring.common');
  const locale = await getLocale();
  const percent = changeText(change, locale);
  const sentence = t(`change.${change.kind}`, { percent, window: t(`window.${rangeKey}`) });
  const Icon = ICONS[change.kind];
  // `flat` and `new` have no number to show, so their own message is the visible text and reading it twice
  // would be noise; the other kinds show the percentage and keep the sentence for assistive technology.
  const spellsItself = change.kind === 'flat' || change.kind === 'new';
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs tabular-nums', ICON_TONE[change.kind])}>
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
      {spellsItself ? (
        <span>{sentence}</span>
      ) : (
        <>
          <span aria-hidden>{percent}</span>
          <span className="sr-only">{sentence}</span>
        </>
      )}
    </span>
  );
}
