import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The title block of an app page, with optional actions (buttons, a status badge) on the right. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
  if (!actions) return heading;
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      {heading}
      {actions}
    </div>
  );
}
