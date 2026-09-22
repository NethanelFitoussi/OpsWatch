/**
 * The foreground handler decides whether an arriving notification is shown. It runs outside React, from a module-level
 * registration, and reads a module-level copy of the user's preferences that an effect fills in once they are loaded.
 *
 * Until that has happened the copy is null, and the handler must show nothing. The window is small but real — a push
 * that arrives during the first moments after launch, or before a signed-out app has read anything — and getting it
 * wrong means a banner on the device of someone who switched notifications off. `shouldPresent` has its own tests;
 * what is asserted here is that the handler refuses to call it at all without preferences.
 */
import * as Notifications from 'expo-notifications';
import { setPresentationPreferencesForTest } from '../notification-effects';

type Handler = (notification: unknown) => Promise<{ shouldShowBanner: boolean; shouldPlaySound: boolean }>;

/** The handler the module registered when it was first imported. */
const handler = (Notifications.setNotificationHandler as jest.Mock).mock.calls[0][0].handleNotification as Handler;

const arriving = (data: Record<string, unknown>, id = `n-${Math.random()}`) => ({
  request: { identifier: id, content: { data } },
});

const allOn = { enabled: true, minSeverity: 'info' as const, categories: ['alert' as const, 'critical_problem' as const, 'recovery' as const] };

it('shows nothing until the stored preferences have been read', async () => {
  setPresentationPreferencesForTest(null);
  const result = await handler(arriving({ category: 'alert', severity: 'critical' }));
  expect(result.shouldShowBanner).toBe(false);
  expect(result.shouldPlaySound).toBe(false);
});

it('shows what the preferences allow, once they are known', async () => {
  setPresentationPreferencesForTest(allOn);
  const result = await handler(arriving({ category: 'alert', severity: 'critical' }));
  expect(result.shouldShowBanner).toBe(true);
  expect(result.shouldPlaySound).toBe(true);
});

it('stays silent for anything below critical, even when it is shown', async () => {
  setPresentationPreferencesForTest(allOn);
  const result = await handler(arriving({ category: 'alert', severity: 'warning' }));
  expect(result.shouldShowBanner).toBe(true);
  expect(result.shouldPlaySound).toBe(false);
});

it('refuses a category it does not recognise', async () => {
  setPresentationPreferencesForTest(allOn);
  const result = await handler(arriving({ category: 'something-new', severity: 'critical' }));
  expect(result.shouldShowBanner).toBe(false);
});
