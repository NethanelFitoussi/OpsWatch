import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('shows only firing alerts by default', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/alerts' });
  expect(await screen.findByTestId('alert-row-al-checkout-5xx', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByTestId('alert-row-al-aurora-connections')).toBeTruthy();
  expect(screen.queryByTestId('alert-row-al-redis-latency')).toBeNull();
  expect(screen.queryByTestId('alert-row-al-catalog-tasks')).toBeNull();
  expect(screen.getByTestId('alert-row-al-checkout-5xx')).toHaveTextContent(/Firing/);
});

it('lists every alert in History', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/alerts' });
  fireEvent.press(await screen.findByTestId('chip-history', {}, { timeout: 5000 }));
  expect(await screen.findByTestId('alert-row-al-redis-latency', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByTestId('alert-row-al-catalog-tasks')).toBeTruthy();
});

it('acknowledges al-checkout-5xx: the status becomes acknowledged and the button goes away', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/alerts/al-checkout-5xx' });
  const button = await screen.findByTestId('alert-acknowledge', {}, { timeout: 5000 });
  expect(screen.getByTestId('alert-status')).toHaveTextContent(/Firing/);
  fireEvent.press(button);
  expect(await screen.findByTestId('alert-acknowledge-success', {}, { timeout: 5000 })).toHaveTextContent(/Alert acknowledged/);
  await waitFor(() => expect(screen.getByTestId('alert-status')).toHaveTextContent(/Acknowledged/), { timeout: 5000 });
  expect(screen.queryByTestId('alert-acknowledge')).toBeNull();
});

it('never offers acknowledge on an already acknowledged alert', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/alerts/al-redis-latency' });
  expect(await screen.findByTestId('alert-status', {}, { timeout: 5000 })).toHaveTextContent(/Acknowledged/);
  expect(screen.queryByTestId('alert-acknowledge')).toBeNull();
  expect(screen.getByTestId('alert-history')).toBeTruthy();
});
