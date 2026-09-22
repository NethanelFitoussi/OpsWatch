/**
 * A cold start with no reachable server.
 *
 * This is the scenario the offline cache exists for: the phone is opened on a train, in a basement, or on a flaky
 * connection, and the app is expected to show the last thing it knew — clearly labelled as not live — rather than a
 * blank screen with a retry button.
 *
 * Every other test around the cache asserts which queries are *selected* for writing. None of them followed the
 * snapshot back in through a real cold start, which is how a cache that persisted perfectly and restored not at all
 * went unnoticed until someone opened the app on a device with the server unplugged.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hashKey } from '@tanstack/react-query';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { keys } from '../queries';
import { CACHE_MAX_AGE_MS } from '../query-provider';
import { buildDemoDataset } from '@/demo/fixtures';
import { cacheStorage } from '@/state/cache-storage';
import { PREF_KEYS, secureStore, sessionKey } from '@/state/storage';

jest.setTimeout(30_000);

const SERVER = 'https://ops.example.com';
const USER = { email: 'someone@example.com', name: 'Someone' };

const serverInfo = {
  product: 'opswatch',
  version: '1.0.0',
  apiVersion: 1,
  name: 'Example OpsWatch',
  demo: false,
  auth: { password: true, google: false },
  features: { health: true, brief: true, problems: true, errors: true, services: true, infrastructure: true, logs: true, alerts: true, incidents: true, synthetics: true, slos: true, deployments: true, repository: true, investigations: true, search: true, favorites: true, environments: true, ai: false, push: false },
};

/**
 * What the server said last time the app could reach it. Taken from the demo dataset rather than written by hand, so
 * it is a shape the contract really produces: a fixture missing a field the screen reads would fail this test for the
 * wrong reason.
 */
const cachedHealth = buildDemoDataset().health;

async function seedSignedInSession(): Promise<void> {
  await AsyncStorage.setItem(
    PREF_KEYS.server,
    JSON.stringify({ url: SERVER, demo: false, insecure: false, info: serverInfo, user: USER }),
  );
  await secureStore.set(sessionKey(SERVER), 'a-token-from-the-last-session');
}

/** The snapshot a previous run would have left behind, in the shape the persister writes. */
async function seedPersistedCache(): Promise<void> {
  const queryKey = keys.health({ env: undefined });
  await cacheStorage.setItem(
    PREF_KEYS.queryCache,
    JSON.stringify({
      buster: `${SERVER}|${USER.email}`,
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [
          {
            queryKey,
            queryHash: hashKey(queryKey),
            state: {
              data: cachedHealth,
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now() - 60_000,
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle',
            },
          },
        ],
      },
    }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await cacheStorage.removeItem(PREF_KEYS.queryCache);
  // Nothing answers: this is the whole point of the test.
  global.fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
});

it('shows the last health it knew, marked as not live, instead of an error page', async () => {
  await seedSignedInSession();
  await seedPersistedCache();

  renderRouter('./app', { initialUrl: '/' });

  expect(await screen.findByTestId('status-title', {}, { timeout: 10_000 })).toHaveTextContent('Degraded');
  expect(screen.getByTestId('status-title')).toBeTruthy();
  // Never silently: the staleness banner is what keeps cached data from being read as live.
  expect(await screen.findByTestId('stale-banner', {}, { timeout: 10_000 })).toBeTruthy();
});

it('does not read back a snapshot belonging to another session', async () => {
  await seedSignedInSession();
  await seedPersistedCache();
  // The same cache, but written by a different user on the same server.
  const raw = JSON.parse((await cacheStorage.getItem(PREF_KEYS.queryCache)) ?? '{}');
  raw.buster = `${SERVER}|someone-else@example.com`;
  await cacheStorage.setItem(PREF_KEYS.queryCache, JSON.stringify(raw));

  renderRouter('./app', { initialUrl: '/' });

  await waitFor(() => expect(screen.queryByTestId('status-title')).toBeNull(), { timeout: 10_000 });
});

it('ignores a snapshot older than the cache lifetime', async () => {
  await seedSignedInSession();
  await seedPersistedCache();
  const raw = JSON.parse((await cacheStorage.getItem(PREF_KEYS.queryCache)) ?? '{}');
  raw.timestamp = Date.now() - CACHE_MAX_AGE_MS - 60_000;
  await cacheStorage.setItem(PREF_KEYS.queryCache, JSON.stringify(raw));

  renderRouter('./app', { initialUrl: '/' });

  await waitFor(() => expect(screen.queryByTestId('status-title')).toBeNull(), { timeout: 10_000 });
});
