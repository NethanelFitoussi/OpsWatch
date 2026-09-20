/**
 * Degraded operation: what the user is told when the network, the server or the server's capabilities are missing.
 * These assert the behaviour an on-call engineer depends on — never mistaking cached data for live data, never being
 * offered a retry that cannot work — not the exact wording.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { ApiError } from '@/api/errors';
import type { ServerInfo } from '@/api/contract';
import { buildDemoDataset, DEMO_CREDENTIALS } from '@/demo/fixtures';
import { DEMO_SERVER_URL } from '@/state/session';
import { PREF_KEYS } from '@/state/storage';
import { renderWithProviders } from '@/test/render';
import { ErrorState, FeatureGate, Freshness, LoadingState } from '../states';
import { Text } from '../text';

jest.setTimeout(20_000);

const listener = NetInfo.addEventListener as jest.Mock;

/** The app only learns it is offline through NetInfo, so the tests speak to it the same way. */
function network(connected: boolean): void {
  listener.mockImplementation((callback: (state: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
    callback({ isConnected: connected, isInternetReachable: connected });
    return () => undefined;
  });
}

/** Signs in against a server whose capabilities are exactly `info` (null = a server that never answered). */
async function seedServer(info: ServerInfo | null): Promise<void> {
  await AsyncStorage.setItem(
    PREF_KEYS.server,
    JSON.stringify({ url: DEMO_SERVER_URL, demo: true, insecure: false, info, user: { email: DEMO_CREDENTIALS.email } }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  listener.mockReset();
  listener.mockImplementation(() => () => undefined);
});

// The session restores itself from storage asynchronously; let it finish before the test tears the tree down.
afterEach(async () => {
  await act(async () => undefined);
});

describe('ErrorState', () => {
  it('offers a retry for a failure that repeating can fix', async () => {
    await renderWithProviders(<ErrorState error={new ApiError('network')} onRetry={jest.fn()} />);
    expect(screen.getByTestId('error-state')).toHaveTextContent(/Can't reach the OpsWatch server/);
    expect(screen.getByTestId('error-retry')).toBeTruthy();
  });

  it('never offers a retry for a permission or a missing object, and says what to do instead', async () => {
    await renderWithProviders(<ErrorState error={new ApiError('forbidden', { action: 'logs:StartQuery' })} onRetry={jest.fn()} />);
    expect(screen.queryByTestId('error-retry')).toBeNull();
    expect(screen.getByTestId('error-state')).toHaveTextContent(/Ask whoever administers this OpsWatch instance/);
    // The provider permission is shown exactly as the server named it, so it can be pasted into a policy.
    expect(screen.getByTestId('error-permission')).toHaveTextContent(/logs:StartQuery/);
  });

  it('never offers a retry for something that no longer exists', async () => {
    await renderWithProviders(<ErrorState error={new ApiError('not_found')} onRetry={jest.fn()} />);
    expect(screen.queryByTestId('error-retry')).toBeNull();
    expect(screen.getByTestId('error-state')).toHaveTextContent(/no longer exists/);
  });

  it('passes on how long the server asked to wait', async () => {
    await renderWithProviders(<ErrorState error={new ApiError('rate_limited', { retryAfterMs: 90_000 })} onRetry={jest.fn()} />);
    expect(screen.getByTestId('error-state')).toHaveTextContent(/asked to wait 2 min/);
    expect(screen.getByTestId('error-retry')).toBeTruthy();
  });

  it('points an unreadable answer at the server address rather than at the network', async () => {
    await renderWithProviders(<ErrorState error={new ApiError('invalid_response')} onRetry={jest.fn()} />);
    expect(screen.getByTestId('error-state')).toHaveTextContent(/Check the server address in Settings/);
  });

  it('says plainly that a never-loaded screen is empty because the device is offline', async () => {
    network(false);
    await renderWithProviders(<ErrorState error={new ApiError('network')} onRetry={jest.fn()} />);
    expect(screen.getByTestId('error-state')).toHaveTextContent(/offline, and this screen has nothing saved/);
    expect(screen.getByTestId('error-state')).toHaveTextContent(/never been loaded|never loaded/);
    expect(screen.getByTestId('error-retry')).toBeTruthy();
  });
});

describe('LoadingState', () => {
  it('holds the spinner back so a fast answer never makes it flash', async () => {
    await renderWithProviders(<LoadingState delayMs={80} />);
    expect(screen.queryByTestId('loading-state')).toBeNull();
    expect(screen.getByTestId('loading-placeholder')).toBeTruthy();
    expect(await screen.findByTestId('loading-state', {}, { timeout: 3000 })).toBeTruthy();
  });
});

describe('Freshness', () => {
  it('calls data live only when it really is', async () => {
    await renderWithProviders(<Freshness updatedAt={Date.now()} />);
    expect(screen.queryByTestId('stale-banner')).toBeNull();
    expect(screen.getByTestId('freshness')).toHaveTextContent(/Updated just now/);
  });

  it('warns and offers a retry when the refresh failed under the data on screen', async () => {
    const onRetry = jest.fn();
    await renderWithProviders(<Freshness updatedAt={Date.now() - 120_000} refreshFailed onRetry={onRetry} />);
    expect(screen.queryByTestId('freshness')).toBeNull();
    expect(screen.getByTestId('stale-banner')).toHaveTextContent(/Couldn't refresh.*not live/);
    fireEvent.press(screen.getByTestId('stale-banner-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('warns while offline, with the age of what is on screen', async () => {
    network(false);
    await renderWithProviders(<Freshness updatedAt={Date.now() - 180_000} />);
    expect(screen.getByTestId('stale-banner')).toHaveTextContent(/offline.*3 min ago.*not live/);
  });

  it('stops calling old data fresh once it has aged past a glance', async () => {
    await renderWithProviders(<Freshness updatedAt={Date.now() - 10 * 60_000} />);
    expect(screen.queryByTestId('freshness')).toBeNull();
    expect(screen.getByTestId('stale-banner')).toHaveTextContent(/Not live: this is data from 10 min ago/);
  });

  it('says nothing at all when there is no data to date', async () => {
    await renderWithProviders(<Freshness updatedAt={0} />);
    expect(screen.queryByTestId('freshness')).toBeNull();
    expect(screen.queryByTestId('stale-banner')).toBeNull();
  });
});

describe('FeatureGate', () => {
  const info = buildDemoDataset().server;

  it('shows the feature when the server advertises it', async () => {
    await seedServer({ ...info, features: { ...info.features, slos: true } });
    await renderWithProviders(
      <FeatureGate feature="slos" label="SLOs">
        <Text testID="gated">SLO list</Text>
      </FeatureGate>,
    );
    expect(await screen.findByTestId('gated', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('explains that the server simply does not provide it, with nothing to retry', async () => {
    await seedServer({ ...info, features: { ...info.features, slos: false } });
    await renderWithProviders(
      <FeatureGate feature="slos" label="SLOs">
        <Text testID="gated">SLO list</Text>
      </FeatureGate>,
    );
    expect(await screen.findByTestId('feature-unavailable', {}, { timeout: 5000 })).toHaveTextContent(/This server has no SLOs/);
    expect(screen.getByTestId('feature-unavailable')).toHaveTextContent(/Everything else in the app keeps working/);
    expect(screen.queryByTestId('gated')).toBeNull();
    expect(screen.queryByTestId('feature-unknown-retry')).toBeNull();
  });

  // An older server that never answered GET /server must not have its features guessed at.
  it('never shows a feature as working when the server reported no capabilities at all', async () => {
    await seedServer(null);
    await renderWithProviders(
      <FeatureGate feature="slos" label="SLOs">
        <Text testID="gated">SLO list</Text>
      </FeatureGate>,
    );
    expect(await screen.findByTestId('feature-unknown', {}, { timeout: 5000 })).toHaveTextContent(/hasn't said what it provides/);
    expect(screen.queryByTestId('gated')).toBeNull();
    expect(screen.getByTestId('feature-unknown-retry')).toBeTruthy();
  });
});
