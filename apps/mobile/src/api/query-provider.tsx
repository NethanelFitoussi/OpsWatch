/**
 * TanStack Query setup.
 *
 * - A 401 anywhere expires the session.
 * - Only glanceable, read-only queries are persisted for offline use (see PERSISTED_ROOTS); logs, stack traces,
 *   evidence and AI answers never touch the disk.
 * - The persisted cache is keyed by server and user (`buster`) and wiped whenever a session ends.
 * - Refetch on app focus and on reconnect, via the focus and online managers wired below.
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryCache, QueryClient, MutationCache, type Query } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { isApiError } from './errors';
import { PREF_KEYS } from '@/state/storage';
import { useSession } from '@/state/session';

/** First element of the query keys that may be written to disk. */
export const PERSISTED_ROOTS = new Set(['health', 'brief', 'problems', 'services', 'incidents', 'environments']);
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const [root, kind] = query.queryKey;
  // Lists only: `['problems', 'list', …]` is persisted, `['problems', 'detail', …]` (evidence, metrics) is not.
  return typeof root === 'string' && PERSISTED_ROOTS.has(root) && kind === 'list' && query.state.status === 'success';
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
  const expireRef = useRef(expire);
  expireRef.current = expire;
  const client = useMemo(() => createQueryClient(() => expireRef.current()), []);

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
    const unsubscribeNet = onlineManager.setEventListener((setOnline) =>
      NetInfo.addEventListener((net) => setOnline(net.isConnected !== false && net.isInternetReachable !== false)),
    );
    if (Platform.OS === 'web') return unsubscribeNet;
    const subscription = AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
    return () => {
      subscription.remove();
    };
  }, []);

  const buster = state.status === 'signed-in' ? `${state.server.url}|${state.user.email}` : 'none';

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE_MS,
        buster,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
