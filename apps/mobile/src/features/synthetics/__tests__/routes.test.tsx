import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('puts the degraded Checkout API first and flags the status page certificate', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/synthetics' });
  const rows = await screen.findAllByTestId(/^synthetic-row-/, {}, { timeout: 5000 });
  expect(rows[0]).toHaveTextContent(/Checkout API/);
  expect(rows[0]).toHaveTextContent(/Degraded/);
  expect(screen.getByTestId('synthetics-summary')).toHaveTextContent('3 up · 1 degraded · 0 down');
  expect(screen.getByTestId('synthetic-ssl-syn-status')).toHaveTextContent(/Certificate expires in 12 days/);
  expect(screen.queryByTestId('synthetic-ssl-syn-storefront')).toBeNull();
});

it('shows a synthetic check in detail', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/synthetics/syn-checkout-api' });
  expect(await screen.findByTestId('synthetic-status', {}, { timeout: 5000 })).toHaveTextContent(/Degraded/);
  expect(screen.getByTestId('synthetic-target')).toHaveTextContent('https://api.example.com/v1/cart/price');
  expect(screen.getByTestId('synthetic-failures')).toHaveTextContent(/HTTP 502/);
  expect(screen.getByTestId('synthetic-open-problem')).toBeTruthy();
});
