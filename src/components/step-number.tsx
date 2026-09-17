import { cn } from '@/lib/utils';

/** A numbered step marker; `decorative` hides it from assistive technology when the heading is read alone. */
export function StepNumber({ number, decorative, className }: { number: number; decorative?: boolean; className?: string }) {
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums',
        className,
      )}
    >
      {number}
    </span>
  );
}
