/**
 * The windows the endpoints form offers.
 *
 * It lives beside the action rather than inside it because a `'use server'` module may only export async
 * functions — a constant there makes every other export in the file unresolvable.
 */
export const WINDOW_CHOICES = [1, 3, 12, 24] as const;
