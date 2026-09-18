import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('lists services with checkout-api first, and shows "No data" (never 0) for orders-worker metrics', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/services' });
  expect(await screen.findByTestId('service-row-svc-checkout-api', {}, { timeout: 5000 })).toBeTruthy();
  const rows = screen.getAllByTestId(/^service-row-/);
  expect(rows[0]).toHaveProp('testID', 'service-row-svc-checkout-api');

  for (const metric of ['errorRate', 'latencyP95', 'requests']) {
    const cell = screen.getByTestId(`service-svc-orders-worker-${metric}`);
    expect(cell).toHaveTextContent(/No data/);
    expect(cell).not.toHaveTextContent(/\b0\b/);
  }
  // checkout-api is a favorite on the demo server: it carries the star.
  expect(await screen.findByTestId('service-favorite-svc-checkout-api', {}, { timeout: 5000 })).toBeTruthy();
});

it('filters services by text and health', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/services' });
  expect(await screen.findByTestId('service-row-svc-checkout-api', {}, { timeout: 5000 })).toBeTruthy();

  fireEvent.press(screen.getByTestId('chip-degraded'));
  await waitFor(() => expect(screen.queryByTestId('service-row-svc-checkout-api')).toBeNull());
  expect(screen.getByTestId('service-row-svc-orders-worker')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('services-search'), 'auth');
  await waitFor(() => expect(screen.queryByTestId('service-row-svc-orders-worker')).toBeNull());
  expect(screen.getByTestId('service-row-svc-auth-api')).toBeTruthy();
});

it('shows the service detail with its problems, and toggles the favorite star', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/services/svc-checkout-api' });
  expect(await screen.findByTestId('service-header', {}, { timeout: 5000 })).toHaveTextContent(/checkout-api/);
  expect(screen.getByTestId('problem-prb-checkout-5xx')).toBeTruthy();
  expect(screen.getByTestId('problem-prb-aurora-connections')).toBeTruthy();
  expect(screen.getByTestId('service-metric-errorRate')).toHaveTextContent(/6\.8 %/);
  expect(screen.getByTestId('service-resource-res-aurora-main-writer')).toBeTruthy();
  expect(screen.getByTestId('deployment-row-dep-checkout-2140')).toBeTruthy();
  expect(screen.getByTestId('ask-ai')).toHaveTextContent(/Analyze this service/);

  // Favorite on the demo server to start with.
  expect(await screen.findByLabelText('Remove from favorites', {}, { timeout: 5000 })).toBeTruthy();
  fireEvent.press(screen.getByTestId('favorite-toggle'));
  expect(await screen.findByLabelText('Add to favorites', {}, { timeout: 5000 })).toBeTruthy();
  fireEvent.press(screen.getByTestId('favorite-toggle'));
  expect(await screen.findByLabelText('Remove from favorites', {}, { timeout: 5000 })).toBeTruthy();
});

it('shows metrics as "No data" on a service without HTTP metrics', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/services/svc-orders-worker' });
  expect(await screen.findByTestId('service-metric-requests', {}, { timeout: 5000 })).toHaveTextContent(/No data/);
  expect(screen.getByTestId('service-metric-errorRate')).toHaveTextContent(/No data/);
});
