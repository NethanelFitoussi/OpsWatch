/**
 * Notifications, and the device a push would be sent to.
 *
 * Push is declared `false` by `GET /server` for this mission: it needs FCM/APNs credentials that do not exist yet.
 * The shapes are here so the flag is the only thing that has to change when they do.
 */
import { z } from 'zod';
import { idSchema } from './primitives';

export const NOTIFICATION_CATEGORIES = ['critical_problem', 'alert', 'synthetic_failure', 'incident', 'recovery'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const MIN_SEVERITIES = ['critical', 'warning', 'info'] as const;

export type NotificationPreferences = {
  /** `critical`: critical only; `warning`: critical and warning; `info`: everything. */
  minSeverity: (typeof MIN_SEVERITIES)[number];
  categories: NotificationCategory[];
};

export const notificationPreferencesSchema = z.object({
  minSeverity: z.enum(MIN_SEVERITIES),
  categories: z.array(z.enum(NOTIFICATION_CATEGORIES)),
}) satisfies z.ZodType<NotificationPreferences>;

/** A registration answers with the id only: the push token the client sent is never echoed back. */
export const deviceRegistrationSchema = z.object({ id: idSchema });
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;
