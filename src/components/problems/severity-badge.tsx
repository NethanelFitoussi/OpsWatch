import { Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { Severity } from '@opswatch/contract';
import { TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const ICON: Record<Severity, typeof Info> = { critical: OctagonAlert, warning: TriangleAlert, info: Info };
const CLASS: Record<Severity, string> = {
  critical: TONE_TEXT.danger,
  warning: TONE_TEXT.warning,
  info: 'text-muted-foreground',
};

/**
 * A severity, shown as an icon *and* a word.
 *
 * The word is not decoration: colour alone must never carry meaning, for a reader who cannot distinguish
 * these two reds and for a screen reader that sees neither.
 */
export function SeverityBadge({ severity, label }: { severity: Severity; label: string }) {
  const Icon = ICON[severity];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', CLASS[severity])}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </span>
  );
}
