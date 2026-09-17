import type { ComponentProps, ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type FormFieldProps = Omit<ComponentProps<typeof Input>, 'id' | 'name'> & {
  /** Used as the input's id and name. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
};

/** A labelled input; the optional hint below it is linked with aria-describedby. */
export function FormField({ id, label, hint, ...inputProps }: FormFieldProps) {
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-describedby={hint ? hintId : undefined} {...inputProps} />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
