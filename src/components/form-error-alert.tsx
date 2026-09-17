import { Alert, AlertDescription } from '@/components/ui/alert';

/** The error of a form, announced to screen readers; nothing when there is none. */
export function FormErrorAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
