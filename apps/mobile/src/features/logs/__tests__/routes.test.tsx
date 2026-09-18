import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

async function searchFor(text: string) {
  const input = await screen.findByTestId('logs-search-input', {}, { timeout: 5000 });
  fireEvent.changeText(input, text);
  fireEvent(input, 'submitEditing');
}

it('shows examples first, then results for a submitted search', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/logs' });
  expect(await screen.findByTestId('logs-examples', {}, { timeout: 5000 })).toBeTruthy();
  await searchFor('TypeError');
  const rows = await screen.findAllByTestId(/^logs-row-/, {}, { timeout: 5000 });
  expect(rows.length).toBeGreaterThan(0);
  expect(screen.getAllByText("TypeError: Cannot read properties of undefined (reading 'value')").length).toBe(rows.length);
  expect(screen.getByTestId('logs-statistics')).toHaveTextContent(/records matched, 240 scanned/);
});

it('opens a log entry from the results with pretty JSON and its links', async () => {
  await seedDemoSession();
  const app = renderRouter('./app', { initialUrl: '/logs' });
  await searchFor('TypeError');
  const rows = await screen.findAllByTestId(/^logs-row-/, {}, { timeout: 5000 });
  fireEvent.press(rows[0]!);
  expect(await screen.findByTestId('log-entry-screen', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText(/"route": "POST \/v1\/cart\/price",/)).toBeTruthy();
  expect(screen.getByTestId('log-link-error')).toBeTruthy();
  expect(screen.getByTestId('log-link-problem')).toBeTruthy();
  expect(screen.getByTestId('log-link-service')).toBeTruthy();

  fireEvent.press(screen.getByTestId('log-link-error'));
  await waitFor(() => expect(app.getPathname()).toBe('/errors/err-checkout-currency'));
});

it('explains when a log entry is not in memory', async () => {
  await seedDemoSession();
  // Log entries are not linkable from outside (deep-link allow-list), so open the route from inside the app.
  renderRouter('./app', { initialUrl: '/logs' });
  await screen.findByTestId('logs-examples', {}, { timeout: 5000 });
  act(() => router.push('/logs/log-0'));
  expect(await screen.findByTestId('logs-back-to-search', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText('This log line is no longer available')).toBeTruthy();
});
