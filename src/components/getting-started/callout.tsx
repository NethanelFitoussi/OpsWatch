import { CircleHelp, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { TONE_BORDER, TONE_TEXT } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

const VARIANTS: Record<'question' | 'warning', { icon: LucideIcon; box: string; iconClass: string }> = {
  question: { icon: CircleHelp, box: 'border-border bg-muted/40', iconClass: 'text-foreground/70' },
  warning: {
    icon: TriangleAlert,
    box: cn(TONE_BORDER.warning, 'bg-amber-50 dark:bg-amber-950/30'),
    iconClass: TONE_TEXT.warning,
  },
};

export function Callout({ title, variant = 'question', children }: { title: string; variant?: 'question' | 'warning'; children: ReactNode }) {
  const { icon: Icon, box, iconClass } = VARIANTS[variant];
  return (
    <aside className={cn('flex gap-3 rounded-xl border p-4', box)}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', iconClass)} aria-hidden />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </aside>
  );
}
