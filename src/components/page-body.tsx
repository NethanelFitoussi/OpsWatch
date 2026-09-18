import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * An application page that is not a monitoring section: an even gutter on every side, the usual rhythm
 * between blocks, and the whole width of the content area. A wide screen gives the grids inside more
 * columns instead of leaving an empty band on the right; a page whose content is prose passes its own
 * reading width through `className`.
 */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('w-full flex-1 space-y-6 px-4 py-6 md:px-6', className)}>{children}</div>;
}
