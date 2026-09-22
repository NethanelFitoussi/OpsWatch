import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('lists SLOs, showing No data rather than 0 for slo-auth', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/slos' });
  const auth = await screen.findByTestId('slo-row-slo-auth', {}, { timeout: 5000 });
  expect(auth).toHaveTextContent(/current No data/);
  expect(auth).not.toHaveTextContent(/current 0/);
  expect(screen.getByTestId('slo-row-slo-checkout-availability')).toHaveTextContent(/Breached/);
  // An exhausted budget says so in words in the list too, not only as a red bar with a negative percentage.
  expect(screen.getByTestId('slo-row-budget-slo-checkout-availability')).toHaveTextContent('Budget exhausted');
  expect(screen.getByTestId('slo-row-budget-slo-auth')).toHaveTextContent('Error budget remaining');
  expect(auth).not.toHaveTextContent('Budget exhausted');
});

it('shows slo-checkout-availability with its budget exhausted', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/slos/slo-checkout-availability' });
  expect(await screen.findByTestId('slo-budget-exhausted', {}, { timeout: 5000 })).toHaveTextContent('Budget exhausted');
  expect(screen.getByTestId('slo-burn-rate')).toHaveTextContent('×14.2');
  expect(screen.getByTestId('slo-current')).toHaveTextContent(/99.62 %/);
  expect(screen.getByTestId('slo-status')).toHaveTextContent(/Breached/);
});

it('handles slo-auth, which has no data at all', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/slos/slo-auth' });
  expect(await screen.findByTestId('slo-current', {}, { timeout: 5000 })).toHaveTextContent(/No data/);
  expect(screen.getByTestId('slo-burn-rate')).toHaveTextContent('No data');
  expect(screen.getByTestId('slo-no-series')).toBeTruthy();
  expect(screen.queryByTestId('slo-budget-exhausted')).toBeNull();
});
