/**
 * TanStack Query setup.
 *
 * - A 401 anywhere expires the session.
 * - Only glanceable, read-only queries are persisted for offline use (see PERSISTED_ROOTS); logs, stack traces,
 *   evidence and AI answers never touch the disk.
 * - The persisted cache is keyed by server and user (`buster`) and wiped whenever a session ends. The persister is
 *   therefore mounted only once the session is known: mounting it earlier would compare the stored cache against a
 *   placeholder key and throw the whole offline cache away on every cold start.
 * - What reaches the disk is bounded, in age (CACHE_MAX_AGE_MS) and in number (MAX_PERSISTED_QUERIES): filter
 *   combinations are unlimited, the cache on a user's phone must not be.
 * - Refetch on app focus and on reconnect, via the focus and online managers wired below.
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryCache, QueryClient, QueryClientProvider, MutationCache, type Query } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { authEvents } from './auth-events';
import { isApiError } from './errors';
import { PREF_KEYS } from '@/state/storage';
import { useSession, type SessionState } from '@/state/session';

/** First element of the query keys that may be written to disk. */
export const PERSISTED_ROOTS = new Set(['health', 'brief', 'problems', 'services', 'incidents', 'environments']);
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Every filter combination is its own query; only the most recently used lists are worth keeping on disk. */
export const MAX_PERSISTED_QUERIES = 24;

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const [root, kind] = query.queryKey;
  // Lists only: `['problems', 'list', …]` is persisted, `['problems', 'detail', …]` (evidence, metrics) is not.
  return typeof root === 'string' && PERSISTED_ROOTS.has(root) && kind === 'list' && query.state.status === 'success';
}

/**
 * The subset of the cache that may be written: allowed by `shouldPersistQuery`, fetched recently enough to still be
 * worth showing when the app reopens, and among the most recent `MAX_PERSISTED_QUERIES`. `maxAge` on the persister
 * only discards the snapshot as a whole, so an old query inside a snapshot that keeps being rewritten would
 * otherwise live for ever.
 */
export function persistableQueryHashes(queries: readonly Pick<Query, 'queryKey' | 'queryHash' | 'state'>[], now = Date.now()): Set<string> {
  return new Set(
    queries
      .filter((query) => shouldPersistQuery(query) && now - query.state.dataUpdatedAt < CACHE_MAX_AGE_MS)
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
      .slice(0, MAX_PERSISTED_QUERIES)
      .map((query) => query.queryHash),
  );
}

/**
 * `shouldDehydrateQuery` is asked one query at a time, but the age and count limits are a property of the whole
 * cache. A dehydration pass is synchronous, so the answer is computed once and reused for the rest of that pass.
 */
function createDehydrateFilter(client: QueryClient): (query: Query) => boolean {
  let pass: { at: number; hashes: Set<string> } | null = null;
  return (query) => {
    const now = Date.now();
    if (!pass || now !== pass.at) pass = { at: now, hashes: persistableQueryHashes(client.getQueryCache().getAll(), now) };
    return pass.hashes.has(query.queryHash);
  };
}

/** Which session a persisted cache belongs to. One server's production data must never show under another's. */
export function cacheBuster(state: SessionState): string {
  return state.status === 'signed-in' ? `${state.server.url}|${state.user.email}` : 'none';
}

export function createQueryClient(onUnauthorized: () => void): QueryClient {
  const handle = (error: unknown) => {
    if (isApiError(error) && error.kind === 'unauthorized') onUnauthorized();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: CACHE_MAX_AGE_MS,
        // The HTTP layer already retries transient failures; React Query does not multiply them.
        retry: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        networkMode: 'offlineFirst',
      },
      mutations: { retry: false, networkMode: 'online' },
    },
  });
}

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: PREF_KEYS.queryCache, throttleTime: 2000 });

export function QueryProvider({ children }: { children: ReactNode }) {
  const { expire, onSessionEnd, state } = useSession();
  const [client] = useState(() => createQueryClient(authEvents.emitUnauthorized));
  const [shouldDehydrateQuery] = useState(() => createDehydrateFilter(client));

  useEffect(() => authEvents.onUnauthorized(expire), [expire]);

  useEffect(
    () =>
      onSessionEnd(async () => {
        await client.cancelQueries();
        client.clear();
        await persister.removeClient();
      }),
    [client, onSessionEnd],
  );

  useEffect(() => {
    onlineManager.setEventListener((setOnline) =>
      NetInfo.addEventListener((net) => setOnline(net.isConnected !== false && net.isInternetReachable !== false)),
    );
    // On the web, React Query's own visibility handling already answers "is the app in front of the user".
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
    return () => {
      subscription.remove();
    };
  }, []);

  // Until the stored session has been read, the cache key is not known yet. Restoring against a placeholder key
  // would delete the offline cache, so nothing is restored or written during that first moment.
  if (state.status === 'loading') return <QueryClientProvider client={client}>{children}</QueryClientProvider>;

  const buster = cacheBuster(state);

  return (
    // Remounting on a new key re-reads the cache for the session that is now signed in, and — because the persist
    // subscription captures its options once — makes sure what is written afterwards is filed under that session.
    <PersistQueryClientProvider
      key={buster}
      client={client}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE_MS,
        buster,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
