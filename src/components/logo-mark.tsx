import { cn } from '@/lib/utils';

/** The OpsWatch mark: a pulse across a watch ring, on the accent colour. Decorative: the name is always next to it. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false" className={cn('size-6 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <circle cx="16" cy="16" r="9.5" fill="none" strokeWidth="2" className="stroke-primary-foreground/40" />
      <path
        d="M4.5 16.5h6l2.5-5.5 4 11 2.75-5.5H27.5"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
    </svg>
  );
}
