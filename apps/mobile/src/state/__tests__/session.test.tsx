/**
 * The session lifecycle: sign in, restore, expire on a rejected token, sign out, change server. What matters here is
 * that the token reaches secure storage and leaves it again, and that listeners run while it is still usable.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
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
  const value = useSession();
  // Published after render, so the tests can drive the provider without reassigning during render.
  useEffect(() => {
    session = value;
  });
  return <Text testID="status">{value.state.status}</Text>;
}

let lastGetToken: (() => string | null) | null = null;
function renderSession(client: OpsWatchClient) {
  const createClient = (_server: ServerConfig, getToken: () => string | null) => {
    lastGetToken = getToken;
    return client;
  };
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

it('signs out locally first, then revokes server-side with the old token', async () => {
  // A hanging network must never keep the app signed in: the token is gone before any request is made.
  const calls: string[] = [];
  let releaseLogout = () => {};
  const client = fakeClient({
    logout: async () => {
      calls.push(`logout:${lastGetToken?.() ?? 'no-token'}`);
      await new Promise<void>((resolve) => {
        releaseLogout = resolve;
      });
    },
  });
  const screen = renderSession(client);
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-server'));
  await act(async () => session.connect({ url: SERVER, insecure: false, info }));
  await act(async () => session.signIn('admin@example.com', 'password'));
  const stop = session.onSessionEnd((reason) => {
    calls.push(`listener:${reason}`);
  });

  await act(async () => session.signOut());

  // Signed out immediately, even though logout has not answered.
  expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
  expect(await storedToken()).toBeNull();
  await waitFor(() => expect(calls).toEqual(['listener:signed-out', 'logout:token-from-the-server-0123456789']));
  releaseLogout();
  stop();
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
