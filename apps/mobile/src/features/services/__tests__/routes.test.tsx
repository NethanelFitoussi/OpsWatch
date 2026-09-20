import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('lists services worst first, and reads a worker as "not measured" rather than broken', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/services' });
  expect(await screen.findByTestId('service-row-svc-checkout-api', {}, { timeout: 5000 })).toBeTruthy();
  const rows = screen.getAllByTestId(/^service-row-/);
  expect(rows[0]).toHaveProp('testID', 'service-row-svc-checkout-api');

  // orders-worker has no HTTP metric at all: one honest sentence, not three "No data" cells, and never a 0.
  const worker = screen.getByTestId('service-row-svc-orders-worker');
  expect(screen.getByTestId('service-svc-orders-worker-not-measured')).toHaveTextContent(/not measured/i);
  expect(screen.queryByTestId('service-svc-orders-worker-errorRate')).toBeNull();
  expect(worker).not.toHaveTextContent(/\b0\b/);
  // catalog-api is measured, so it keeps its metric cells.
  expect(screen.getByTestId('service-svc-catalog-api-errorRate')).toHaveTextContent(/0\.3 %/);

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

it('explains a service without HTTP metrics instead of showing empty tiles', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/services/svc-orders-worker' });
  expect(await screen.findByTestId('service-not-measured', {}, { timeout: 5000 })).toHaveTextContent(/not measured/i);
  expect(screen.queryByTestId('service-metric-requests')).toBeNull();
  expect(screen.queryByTestId('service-metric-errorRate')).toBeNull();
});
