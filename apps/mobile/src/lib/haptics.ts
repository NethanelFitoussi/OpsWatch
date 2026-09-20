/**
 * Physical feedback for actions whose result matters: acknowledging an alert or a problem, or failing to.
 *
 * On-call work happens one-handed, often without looking closely, so a confirmed action should be felt as well as
 * seen. Every call is best effort: haptics are unavailable on web, absent on some devices, and switched off by some
 * users, and none of that should ever surface as an error.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

export const haptics = {
  /** An action the server accepted. */
  success(): void {
    if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  /** An action that failed, so the user looks at the screen. */
  error(): void {
    if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  },
  /** A consequential choice, such as switching to production. */
  selection(): void {
    if (enabled) void Haptics.selectionAsync().catch(() => undefined);
  },
};
