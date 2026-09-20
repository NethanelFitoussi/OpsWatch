/**
 * A server-side log query holds one of the account's Logs Insights concurrency slots, so every query this app starts
 * must be released again: when the screen goes away while it is still running, and when a refresh finds one already
 * running (which must be polled, not started again).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { LogSearch } from '../contract';
import type { OpsWatchClient } from '../client';
import { useLogs } from '../queries';
import { SessionProvider } from '@/state/session';
import { SettingsProvider } from '@/state/settings';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

const answer = (status: LogSearch['status'], searchId = 'search-1'): LogSearch => ({ searchId, status, items: [], nextCursor: null });

function harness(client: Partial<OpsWatchClient>) {
  const full = { mode: 'demo', ...client } as unknown as OpsWatchClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Screen() {
    const logs = useLogs({ from: 1, to: 2 });
    return <Text testID="status">{logs.data?.pages[0]?.status ?? 'pending'}</Text>;
  }
  return {
    queryClient,
    ...render(
      <SettingsProvider initial={{}}>
        <SessionProvider locale="en" createClient={() => full}>
          <QueryClientProvider client={queryClient}>
            <Screen />
          </QueryClientProvider>
        </SessionProvider>
      </SettingsProvider>,
    ),
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedDemoSession();
});

it('releases a query that is still running when the screen goes away', async () => {
  const cancelLogs = jest.fn(async () => undefined);
  const searchLogs = jest.fn(async () => answer('running'));
  const screen = harness({ searchLogs, pollLogs: async () => answer('running'), cancelLogs });

  await waitFor(() => expect(searchLogs).toHaveBeenCalled());
  screen.unmount();

  await waitFor(() => expect(cancelLogs).toHaveBeenCalledWith(expect.anything(), 'search-1'));
});

it('leaves a finished search alone', async () => {
  const cancelLogs = jest.fn(async () => undefined);
  const screen = harness({ searchLogs: async () => answer('complete'), cancelLogs });

  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('complete'));
  screen.unmount();
  await act(async () => undefined);
  expect(cancelLogs).not.toHaveBeenCalled();
});

it('polls the query already running instead of starting a second one', async () => {
  const searchLogs = jest.fn(async () => answer('running'));
  const pollLogs = jest.fn(async () => answer('complete'));
  const screen = harness({ searchLogs, pollLogs, cancelLogs: async () => undefined });

  await waitFor(() => expect(searchLogs).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('complete'), { timeout: 8000 });

  // One search, and the answer came from polling it.
  expect(searchLogs).toHaveBeenCalledTimes(1);
  expect(pollLogs).toHaveBeenCalled();
});
