'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

/**
 * A form's submit button, disabled while the form's action runs.
 *
 * `disabled` is additive rather than an override: a caller can refuse a submission for its own reason —
 * an unticked confirmation, a switch that is off — and the pending state still applies on top of it.
 */
export function SubmitButton({
  children,
  className,
  disabled,
  // A submit is not always the page's main action: a correction beside a link is still a submit.
  variant,
  size,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending || disabled === true}>
      {children}
    </Button>
  );
}
