import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('lists deployments with status, version and short commit', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/deployments' });
  const row = await screen.findByTestId('deployment-row-dep-checkout-2140', {}, { timeout: 5000 });
  expect(row).toHaveTextContent(/checkout-api v2\.14\.0/);
  expect(row).toHaveTextContent(/8f3c2a9 · Batch currency lookups when pricing the cart/);
  expect(row).toHaveTextContent(/Completed/);
  expect(screen.getByTestId('deployment-row-dep-worker-118')).toHaveTextContent(/Rolled back/);
});

it('phrases problems after dep-checkout-2140 as timing facts, never as causes', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/deployments/dep-checkout-2140' });
  expect(await screen.findByTestId('timing-prb-aurora-connections', {}, { timeout: 5000 })).toHaveTextContent('Started 3 min after this deployment');
  expect(screen.getByTestId('timing-prb-checkout-5xx')).toHaveTextContent('Started 9 min after this deployment');
  expect(screen.getByTestId('correlation-note')).toHaveTextContent(/correlation, not proof/);
  expect(screen.queryByText(/caused/i)).toBeNull();

  expect(screen.getByTestId('deployment-changes')).toHaveTextContent(/7 file\(s\) · \+184 · −61/);
  expect(screen.getByTestId('evidence-row-ev-repo-checkout-pricing')).toBeTruthy();
  expect(screen.getByTestId('deployment-service')).toHaveTextContent(/checkout-api/);
  expect(screen.getByTestId('ask-ai')).toHaveTextContent(/Analyze changes/);
});
