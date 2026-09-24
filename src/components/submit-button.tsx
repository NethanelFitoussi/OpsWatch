'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

/**
 * A form's submit button, disabled while the form's action runs.
 *
 * `disabled` is additive rather than an override: a caller can refuse a submission for its own reason —
 * an unticked confirmation, a switch that is off — and the pending state still applies on top of it.
 */
export function SubmitButton({ children, className, disabled }: { children: ReactNode; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className={className} disabled={pending || disabled === true}>
      {children}
    </Button>
  );
}
