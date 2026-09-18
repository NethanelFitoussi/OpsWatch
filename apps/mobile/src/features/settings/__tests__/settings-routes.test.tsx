import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { Settings } from '@/state/settings';
import { PREF_KEYS } from '@/state/storage';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

/** Sub-screens are not external link targets (the allow-list sends them Home), so they are opened from Settings. */
async function openFromSettings(testID: string): Promise<void> {
  renderRouter('./app', { initialUrl: '/settings' });
  fireEvent.press(await screen.findByTestId(testID, {}, { timeout: 5000 }));
}

async function storedSettings(): Promise<Partial<Settings>> {
  const raw = await AsyncStorage.getItem(PREF_KEYS.settings);
  return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
}

it('switches the theme', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/settings' });
  expect(await screen.findByTestId('settings-screen', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByTestId('settings-user')).toHaveTextContent(/Signed in as/);
  fireEvent.press(screen.getByTestId('chip-dark'));
  await waitFor(async () => expect((await storedSettings()).themeMode).toBe('dark'));
  expect(screen.getByTestId('chip-dark')).toBeSelected();
});

it('asks for confirmation before leaving the demo', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/settings' });
  fireEvent.press(await screen.findByTestId('settings-sign-out', {}, { timeout: 5000 }));
  expect(screen.getByTestId('confirm-sign-out')).toBeTruthy();
  fireEvent.press(screen.getByTestId('confirm-sign-out-cancel'));
  expect(screen.queryByTestId('confirm-sign-out')).toBeNull();
});

it('marks Production and requires confirmation to switch to it', async () => {
  await seedDemoSession();
  await AsyncStorage.setItem(PREF_KEYS.settings, JSON.stringify({ environmentId: 'staging-eu-west-1' }));
  await openFromSettings('settings-environment');
  const productionRow = await screen.findByTestId('env-row-prod-eu-west-1', {}, { timeout: 5000 });
  expect(productionRow).toHaveTextContent(/PRODUCTION/);

  fireEvent.press(productionRow);
  expect(screen.getByTestId('env-production-warning')).toHaveTextContent(/You are looking at PRODUCTION/);
  expect((await storedSettings()).environmentId).toBe('staging-eu-west-1');

  fireEvent.press(screen.getByTestId('env-confirm'));
  await waitFor(async () => expect((await storedSettings()).environmentId).toBe('prod-eu-west-1'));
});

it('explains that the demo server cannot send push notifications', async () => {
  await seedDemoSession();
  await openFromSettings('settings-notifications');
  expect(await screen.findByTestId('notifications-server-unsupported', {}, { timeout: 5000 })).toHaveTextContent(/cannot send push notifications yet/);
  expect(screen.getByTestId('notifications-test')).toBeTruthy();
});

it('lists favorites from the server with a remove button', async () => {
  await seedDemoSession();
  await openFromSettings('settings-favorites');
  expect(await screen.findByTestId('favorite-service-svc-checkout-api', {}, { timeout: 5000 })).toHaveTextContent(/checkout-api/);
  expect(screen.getByTestId('favorites-storage')).toHaveTextContent(/Synced with your OpsWatch server\./);
  fireEvent.press(screen.getByTestId('favorite-remove-service-svc-checkout-api'));
  expect(await screen.findByTestId('empty-state', {}, { timeout: 5000 })).toBeTruthy();
});
