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
  // Failures lead the summary; a zero count is not worth a word, but "up" is always stated.
  expect(screen.getByTestId('synthetics-summary')).toHaveTextContent('1 degraded · 1 unknown · 3 up');
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

it('puts recent failures above the figures, newest first', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/synthetics/syn-checkout-api' });
  const failures = await screen.findByTestId('synthetic-failures', {}, { timeout: 5000 });
  // Newest failure first inside the card.
  expect(failures).toHaveTextContent(/HTTP 502[\s\S]*Timeout after 10 s[\s\S]*HTTP 500/);
});

it('raises an expiring certificate to the top of the check it protects', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/synthetics/syn-status' });
  expect(await screen.findByTestId('synthetic-ssl-flag', {}, { timeout: 5000 })).toHaveTextContent(/Certificate expires in 12 days/);
  // A healthy certificate is not worth a flag at the top.
  expect(screen.getByTestId('synthetic-status')).toHaveTextContent(/Up/);
});

it('does not flag a certificate that is fine', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/synthetics/syn-storefront' });
  expect(await screen.findByTestId('synthetic-status', {}, { timeout: 5000 })).toHaveTextContent(/Up/);
  expect(screen.queryByTestId('synthetic-ssl-flag')).toBeNull();
  expect(screen.getByTestId('synthetic-screen')).toHaveTextContent(/No recent failures/);
});
