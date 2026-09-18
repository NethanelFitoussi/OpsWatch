import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('lists error groups, and the Regressions filter keeps only the regression', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/errors' });
  expect(await screen.findByTestId('errors-row-err-checkout-currency', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText("TypeError: Cannot read properties of undefined (reading 'value')")).toBeTruthy();

  fireEvent.press(screen.getByTestId('chip-regression'));
  expect(await screen.findByTestId('errors-row-err-worker-ack', {}, { timeout: 5000 })).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId('errors-row-err-checkout-currency')).toBeNull());
  expect(screen.getByText('QueueAckError: message visibility timeout expired before ack')).toBeTruthy();
  expect(screen.queryByTestId('errors-row-err-inventory-timeout')).toBeNull();
});

it('shows the error detail with the in-app frame and the related problem', async () => {
  await seedDemoSession();
  const app = renderRouter('./app', { initialUrl: '/errors/err-checkout-currency' });
  expect(await screen.findByTestId('error-message', {}, { timeout: 5000 })).toHaveTextContent("TypeError: Cannot read properties of undefined (reading 'value')");
  expect(screen.getAllByText('priceCart.lines.map').length).toBeGreaterThan(0);
  expect(screen.getByTestId('error-problem-link')).toBeTruthy();
  expect(screen.getByTestId('error-service-link')).toHaveTextContent(/checkout-api/);
  expect(screen.getByTestId('ask-ai')).toHaveTextContent(/Explain this error/);

  fireEvent.press(screen.getByTestId('error-problem-link'));
  await waitFor(() => expect(app.getPathname()).toBe('/problems/prb-checkout-5xx'));
});
