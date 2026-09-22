import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
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
  // The viewer already copies the raw stack this error carries: a second Copy next to it would only be noise.
  expect(screen.queryByTestId('copy-error-stack')).toBeNull();

  fireEvent.press(screen.getByTestId('error-problem-link'));
  await waitFor(() => expect(app.getPathname()).toBe('/problems/prb-checkout-5xx'));
});

it('says on the row why a regression is not a new error, and since when it has been happening', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/errors' });
  const regression = await screen.findByTestId('errors-row-err-worker-ack', {}, { timeout: 5000 });
  expect(regression).toHaveTextContent(/Was resolved, and is happening again\./);
  expect(regression).toHaveTextContent(/Occurrences: 57/);
  expect(regression).toHaveTextContent(/Instances: 2/);
  expect(regression).toHaveTextContent(/Started .* ago/);
  expect(regression).toHaveTextContent(/Last seen .* ago/);

  // "Recurring" says enough on its own; repeating a sentence on every row would only add noise.
  const recurring = screen.getByTestId('errors-row-err-inventory-timeout');
  expect(recurring).toHaveTextContent(/Recurring/);
  expect(recurring).not.toHaveTextContent(/Seen before and still happening/);
});

it('copies a trace that can be pasted into a ticket, even without a raw stack from the server', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/errors/err-worker-ack' });
  const copy = await screen.findByTestId('copy-error-stack', {}, { timeout: 5000 });
  expect(screen.getByTestId('error-message')).toHaveTextContent(/QueueAckError: message visibility timeout expired before ack/);

  fireEvent.press(copy);
  await waitFor(() =>
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      'QueueAckError: message visibility timeout expired before ack\n    at Consumer.ack (src/queue/consumer.ts:120:9)',
    ),
  );
});
