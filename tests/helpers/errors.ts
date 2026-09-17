import { ConnectionInputError } from '@/lib/connections/repository';

/** The code of the ConnectionInputError `fn` throws, or undefined when it does not throw one. */
export function inputErrorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConnectionInputError) return error.code;
    throw error;
  }
  return undefined;
}
