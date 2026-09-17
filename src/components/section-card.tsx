import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { StepNumber } from './step-number';

/** The padding of section cards, shared with their loading skeletons so nothing moves when they load. */
export const SECTION_CARD_SPACING = '[--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]';

/**
 * A titled section of an app page (an `h2` card), with an optional step number, description and an
 * action (a button) aligned with the title.
 */
export function SectionCard({
  title,
  step,
  description,
  action,
  className,
  contentClassName,
  children,
}: {
  title: ReactNode;
  step?: number;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={cn(SECTION_CARD_SPACING, className)}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 gap-3">
          {step !== undefined && <StepNumber number={step} decorative className="size-7 text-[13px]" />}
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base font-semibold tracking-tight">
              <h2 className={cn(step !== undefined && 'leading-7')}>{title}</h2>
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </div>
        {action}
      </CardHeader>
      {children && <CardContent className={contentClassName}>{children}</CardContent>}
    </Card>
  );
}
