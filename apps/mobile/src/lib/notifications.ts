/**
 * Pure notification logic: payload validation, routing and preference filtering. The payload `data` carries only a
 * reference (`{ type, id, env? }`); the app builds the route itself through the deep-link allow-list, so a payload
 * can never navigate anywhere else or carry content the app would display.
 */
import type { NotificationCategory, NotificationPreferences, RefType, Severity } from '@/api/contract';
import { isSafeId, routeForRef } from './deep-links';

const NOTIFIABLE: readonly RefType[] = ['problem', 'alert', 'incident', 'synthetic', 'error', 'service', 'deployment'];

export type NotificationTarget = { type: RefType; id: string; env?: string };

export function parseNotificationData(data: unknown): NotificationTarget | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, id, env } = data as Record<string, unknown>;
  if (typeof type !== 'string' || !(NOTIFIABLE as readonly string[]).includes(type) || !isSafeId(id)) return null;
  return { type: type as RefType, id, env: isSafeId(env) ? env : undefined };
}

export function routeForNotification(data: unknown): string | null {
  const target = parseNotificationData(data);
  return target ? routeForRef(target) : null;
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Local mirror of the server-side filter, used for foreground presentation. Recoveries follow their category only.
 * `enabled: false` silences everything, including anything the server sent before it learned of the change.
 */
export function shouldPresent(prefs: NotificationPreferences & { enabled?: boolean }, event: { category: NotificationCategory | null; severity?: Severity }): boolean {
  if (prefs.enabled === false) return false;
  // A payload whose category the app does not recognise is not shown: a filter that fails open is not a filter, and
  // a server (or a newer one with a sixth category) must not be able to bypass the user's choice by omitting it.
  if (!event.category) return false;
  if (!prefs.categories.includes(event.category)) return false;
  if (event.category === 'recovery' || !event.severity) return true;
  return RANK[event.severity] <= RANK[prefs.minSeverity];
}

/**
 * Suppresses a notification the app has already acted on. A server retry, or the same alert delivered twice while a
 * phone reconnects, must not open two screens or show the same banner twice.
 */
const seen = new Map<string, number>();
const DEDUPE_WINDOW_MS = 60_000;
const SEEN_LIMIT = 50;

export function isRepeat(key: string, now: number, windowMs: number = DEDUPE_WINDOW_MS): boolean {
  const previous = seen.get(key);
  seen.set(key, now);
  if (seen.size > SEEN_LIMIT) {
    for (const [k, at] of seen) {
      if (now - at > windowMs) seen.delete(k);
    }
    // Still over the limit means a flood inside the window: drop the oldest, so the map cannot grow without bound.
    for (const k of seen.keys()) {
      if (seen.size <= SEEN_LIMIT) break;
      if (k !== key) seen.delete(k);
    }
  }
  return previous !== undefined && now - previous < windowMs;
}

/** Test seam. */
export function forgetSeenNotifications(): void {
  seen.clear();
}

export function dedupeKey(data: unknown, fallback: string): string {
  const target = parseNotificationData(data);
  return target ? `${target.type}:${target.id}:${target.env ?? ''}` : fallback;
}

export function categoryOf(value: unknown): NotificationCategory | null {
  const known: NotificationCategory[] = ['critical_problem', 'alert', 'synthetic_failure', 'incident', 'recovery'];
  return typeof value === 'string' && (known as string[]).includes(value) ? (value as NotificationCategory) : null;
}
