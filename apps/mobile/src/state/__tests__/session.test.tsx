/**
 * The session lifecycle: sign in, restore, expire on a rejected token, sign out, change server. What matters here is
 * that the token reaches secure storage and leaves it again, and that listeners run while it is still usable.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { OpsWatchClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { buildDemoDataset } from '@/demo/fixtures';
import { SessionProvider, useSession, type ServerConfig } from '../session';
import { PREF_KEYS, sessionKey } from '../storage';

const SERVER = 'https://ops.example.com';
const info = buildDemoDataset(1_750_000_000_000).server;
const user = { email: 'admin@example.com' };

function fakeClient(overrides: Partial<OpsWatchClient> = {}): OpsWatchClient {
  return {
    mode: 'http',
    login: async () => ({ token: 'token-from-the-server-0123456789', expiresAt: Date.now() + 1000, user }),
    logout: async () => undefined,
    me: async () => user,
    getServerInfo: async () => info,
    ...overrides,
  } as unknown as OpsWatchClient;
}

let session: ReturnType<typeof useSession>;
function Probe() {
  session = useSession();
  return <Text testID="status">{session.state.status}</Text>;
}

function renderSession(client: OpsWatchClient) {
  const createClient = (_server: ServerConfig, _getToken: () => string | null) => client;
  return render(
    <SessionProvider locale="en" createClient={createClient}>
      <Probe />
    </SessionProvider>,
  );
}

const storedToken = () => SecureStore.getItemAsync(sessionKey(SERVER));

beforeEach(async () => {
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync(sessionKey(SERVER));
});

it('starts with no server, then keeps the chosen one', async () => {
  const screen = renderSession(fakeClient());
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-server'));
  await act(async () => session.connect({ url: SERVER, insecure: false, info }));
  expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
  expect(JSON.parse((await AsyncStorage.getItem(PREF_KEYS.server))!)).toMatchObject({ url: SERVER, demo: false });
});

it('puts the token in secure storage on sign-in and takes it out on sign-out', async () => {
  const screen = renderSession(fakeClient());
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-server'));
  await act(async () => session.connect({ url: SERVER, insecure: false, info }));
  await act(async () => session.signIn('admin@example.com', 'password'));
  expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
  expect(await storedToken()).toBe('token-from-the-server-0123456789');
  // The durable copy holds the user but never the token.
  expect(await AsyncStorage.getItem(PREF_KEYS.server)).not.toContain('token-from-the-server');

  await act(async () => session.signOut());
  expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
  expect(await storedToken()).toBeNull();
});

it('runs session-end listeners while the token still works, and revokes it server-side', async () => {
  const order: string[] = [];
  const client = fakeClient({
    logout: async () => {
      order.push(`logout:${(await storedToken()) ? 'token-present' : 'token-gone'}`);
    },
  });
  const screen = renderSession(client);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-server'));
  await act(async () => session.connect({ url: SERVER, insecure: false, info }));
  await act(async () => session.signIn('admin@example.com', 'password'));
  const stop = session.onSessionEnd(async () => {
    order.push(`listener:${(await storedToken()) ? 'token-present' : 'token-gone'}`);
  });

  await act(async () => session.signOut());
  stop();
  expect(order).toEqual(['listener:token-present', 'logout:token-present']);
});

it('expires the session when the server rejects the token, and says so', async () => {
  const screen = renderSession(fakeClient());
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-server'));
  await act(async () => session.connect({ url: SERVER, insecure: false, info }));
  await act(async () => session.signIn('admin@example.com', 'password'));

  await act(async () => {
    session.expire();
  });
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
  expect(session.state.status === 'signed-out' && session.state.reason).toBe('expired');
  expect(await storedToken()).toBeNull();
});

it('does not trust a stored token that the server no longer accepts', async () => {
  await SecureStore.setItemAsync(sessionKey(SERVER), 'stale-token-0123456789');
  const client = fakeClient({
    me: async () => {
      throw new ApiError('unauthorized', { status: 401 });
    },
  });
  const screen = renderSession(client);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-server'));
  await act(async () => session.connect({ url: SERVER, insecure: false, info }));
  expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
  expect(await storedToken()).toBeNull();
});

it('forgets everything when the server changes', async () => {
  const reasons: string[] = [];
  const screen = renderSession(fakeClient());
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-server'));
  await act(async () => session.connect({ url: SERVER, insecure: false, info }));
  await act(async () => session.signIn('admin@example.com', 'password'));
  session.onSessionEnd((reason) => {
    reasons.push(reason);
  });

  await act(async () => session.forgetServer());
  expect(screen.getByTestId('status')).toHaveTextContent('no-server');
  expect(await storedToken()).toBeNull();
  expect(await AsyncStorage.getItem(PREF_KEYS.server)).toBeNull();
  expect(reasons).toContain('server-changed');
});
