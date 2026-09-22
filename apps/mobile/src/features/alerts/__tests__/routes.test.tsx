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

it('leads the alert detail with the condition that fired and the metric it reads now', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/alerts/al-checkout-5xx' });
  expect(await screen.findByTestId('alert-condition', {}, { timeout: 5000 })).toHaveTextContent(/HTTPCode_Target_5XX rate > 5 % for 3 of 3 minutes/);
  const current = screen.getByTestId('alert-current-value');
  expect(current).toHaveTextContent(/%/);
  expect(current).not.toHaveTextContent('No data');
  expect(screen.getByTestId('alert-since')).toHaveTextContent(/Started .* · for /);
});

it('shows who acknowledged an alert, and keeps saying so after the screen reloads it', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/alerts/al-redis-latency' });
  expect(await screen.findByTestId('alert-status', {}, { timeout: 5000 })).toHaveTextContent(/Acknowledged/);
  expect(screen.getByTestId('alert-screen')).toHaveTextContent(/demo@opswatch\.dev/);
  fireEvent(screen.getByTestId('alert-screen'), 'refresh');
  await waitFor(() => expect(screen.getByTestId('alert-status')).toHaveTextContent(/Acknowledged/), { timeout: 5000 });
  expect(screen.queryByTestId('alert-acknowledge')).toBeNull();
});

it('never claims a firing duration for a resolved alert', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/alerts/al-catalog-tasks' });
  const since = await screen.findByTestId('alert-since', {}, { timeout: 5000 });
  expect(since).toHaveTextContent(/^Started /);
  expect(since).not.toHaveTextContent(/ · for /);
  expect(screen.getByTestId('alert-status')).toHaveTextContent(/Resolved/);
});

it('carries the state of every alert as a badge in the list, so History cannot be misread', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/alerts' });
  fireEvent.press(await screen.findByTestId('chip-history', {}, { timeout: 5000 }));
  expect(await screen.findByTestId('alert-row-status-al-catalog-tasks', {}, { timeout: 5000 })).toHaveTextContent(/Resolved/);
  expect(screen.getByTestId('alert-row-status-al-redis-latency')).toHaveTextContent(/Acknowledged/);
  expect(screen.getByTestId('alert-row-status-al-checkout-5xx')).toHaveTextContent(/Firing/);
});
