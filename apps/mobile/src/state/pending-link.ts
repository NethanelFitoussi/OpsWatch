/**
 * The destination a signed-out user was heading to (deep link or notification tap), restored after sign-in.
 * Kept in memory only: it never survives an app restart and never lands on disk.
 */
import { parseDeepLink } from '@/lib/deep-links';

let pending: string | null = null;

export const pendingLink = {
  /** Stores an in-app path, after checking it against the deep-link allow-list. */
  set(path: string): void {
    pending = parseDeepLink(path);
  },
  peek(): string | null {
    return pending;
  },
  consume(): string | null {
    const value = pending;
    pending = null;
    return value;
  },
  clear(): void {
    pending = null;
  },
};
