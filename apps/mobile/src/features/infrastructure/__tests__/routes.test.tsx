import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('summarises health and filters resources by category (RDS shows the two Aurora instances)', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/infrastructure' });
  expect(await screen.findByTestId('infrastructure-row-res-bastion', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByTestId('infrastructure-summary')).toHaveTextContent('2 critical · 3 degraded · 3 healthy · 2 unknown');
  expect(screen.getByTestId('chip-load-balancer')).toBeTruthy();
  expect(screen.queryByTestId('chip-other')).toBeNull();

  fireEvent.press(screen.getByTestId('chip-rds'));
  expect(await screen.findByTestId('infrastructure-row-res-aurora-main-writer', {}, { timeout: 5000 })).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId('infrastructure-row-res-bastion')).toBeNull());
  expect(screen.getByTestId('infrastructure-row-res-aurora-main-reader')).toBeTruthy();
  expect(screen.getAllByTestId(/^infrastructure-row-/)).toHaveLength(2);
  expect(screen.getByText('aurora-main-instance-1')).toBeTruthy();
  expect(screen.getByText('aurora-main-instance-2')).toBeTruthy();
});

it('shows "No data" for the Requests metric of res-assets-bucket', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/infrastructure/res-assets-bucket' });
  const tile = await screen.findByTestId('infrastructure-metric-0', {}, { timeout: 5000 });
  expect(tile).toHaveTextContent(/Requests/);
  expect(tile).toHaveTextContent(/No data/);
  expect(screen.getByTestId('infrastructure-header')).toHaveTextContent(/shop-assets/);
  // Health the server does not know is "Unknown", never quietly promoted to healthy.
  expect(screen.getByTestId('infrastructure-header')).toHaveTextContent(/Unknown/);
  expect(screen.getByTestId('infrastructure-header')).not.toHaveTextContent(/Healthy/);
});

it('says nothing about the estate until the resources have loaded', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/infrastructure' });
  // "No resources" before the first response would be a claim the app cannot make yet.
  expect(screen.queryByTestId('infrastructure-summary')).toBeNull();
  expect(await screen.findByTestId('infrastructure-summary', {}, { timeout: 5000 })).toHaveTextContent(/2 unknown/);
});

it('highlights anomalies and shows problems on the Aurora writer', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/infrastructure/res-aurora-main-writer' });
  expect(await screen.findByTestId('infrastructure-anomalies', {}, { timeout: 5000 })).toHaveTextContent(/Connections 6× usual level/);
  expect(screen.getByTestId('infrastructure-provider-status')).toHaveTextContent(/available/);
  expect(screen.getByTestId('problem-prb-aurora-connections')).toBeTruthy();
  expect(screen.getByTestId('infrastructure-related-svc-checkout-api')).toBeTruthy();
});
