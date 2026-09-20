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
export function shouldPresent(prefs: NotificationPreferences & { enabled?: boolean }, event: { category: NotificationCategory; severity?: Severity }): boolean {
  if (prefs.enabled === false) return false;
  if (!prefs.categories.includes(event.category)) return false;
  if (event.category === 'recovery' || !event.severity) return true;
  return RANK[event.severity] <= RANK[prefs.minSeverity];
}

export function categoryOf(value: unknown): NotificationCategory | null {
  const known: NotificationCategory[] = ['critical_problem', 'alert', 'synthetic_failure', 'incident', 'recovery'];
  return typeof value === 'string' && (known as string[]).includes(value) ? (value as NotificationCategory) : null;
}
