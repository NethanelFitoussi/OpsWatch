import type { ReactNode } from 'react';
import { SECTION_CARD_SPACING } from '@/components/section-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** A titled card of a monitoring page, with optional actions aligned with the title. */
export function MonitoringCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn(SECTION_CARD_SPACING, className)}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {/* A card title can be an AWS identifier with no spaces in it; at 390px it has to wrap. */}
          <CardTitle className="text-base font-semibold tracking-tight break-words">
            <h2>{title}</h2>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
