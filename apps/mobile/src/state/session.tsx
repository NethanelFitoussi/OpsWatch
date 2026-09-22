/**
 * Server and session state machine:
 *
 *   loading → no-server → signed-out → signed-in
 *                 ↑            ↑   ↓        │
 *                 └ forget ────┴── expire / sign out
 *
 * The token lives in secure storage under a key derived from the server URL, and in a ref read by the HTTP client at
 * call time. Any 401 from an authenticated call expires the session (see QueryProvider).
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createHttpClient, type OpsWatchClient } from '@/api/client';
import { API_VERSION, type Feature, type ServerInfo, type User } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { createDemoClient } from '@/demo/demo-client';
import { DEMO_CREDENTIALS } from '@/demo/fixtures';
import { log } from '@/lib/log';
import { createPkcePair, readAuthRedirect } from '@/lib/pkce';
import { pendingLink } from './pending-link';
import { useSettings } from './settings';
import { prefs, PREF_KEYS, secureStore, sessionKey } from './storage';

export const DEMO_SERVER_URL = 'demo://opswatch';

export type ServerConfig = { url: string; demo: boolean; insecure: boolean; info: ServerInfo | null };
type StoredServer = ServerConfig & { user?: User };

export type SessionState =
  | { status: 'loading' }
  | { status: 'no-server' }
  | { status: 'signed-out'; server: ServerConfig; reason: 'expired' | 'signed-out' | null }
  | { status: 'signed-in'; server: ServerConfig; user: User };

/**
 * Runs when a session ends, after the app is already signed out locally. `revoker` is a client still holding the old
 * token, for best-effort server-side cleanup (unregistering this device); it is absent when there was no token.
 */
type SessionEndListener = (reason: 'expired' | 'signed-out' | 'server-changed', revoker: OpsWatchClient | null) => void | Promise<void>;

type SessionContextValue = {
  state: SessionState;
  client: OpsWatchClient;
  connect: (server: Omit<ServerConfig, 'demo'>) => Promise<void>;
  startDemo: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  forgetServer: () => Promise<void>;
  expire: () => void;
  refreshServerInfo: () => Promise<void>;
  /** Registers cleanup (cache wipe, push unregistration) run whenever a session ends. Returns an unsubscribe. */
  onSessionEnd: (listener: SessionEndListener) => () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The session token in memory. One per app (there is one SessionProvider); the HTTP client reads it at call time, so
 * a new or cleared token applies to the very next request. The durable copy lives in secure storage.
 */
const sessionToken = (() => {
  let value: string | null = null;
  return {
    get: (): string | null => value,
    set: (next: string | null): void => {
      value = next;
    },
  };
})();

/** A client that fails every call, used before a server is chosen. */
const noServerClient: OpsWatchClient = new Proxy({} as OpsWatchClient, {
  get: (_target, prop) => (prop === 'mode' ? 'http' : () => Promise.reject(new ApiError('network', { message: 'No server configured' }))),
});

export type SessionProviderProps = {
  children: ReactNode;
  locale: string;
  /** Test seam: replaces client construction. */
  createClient?: (server: ServerConfig, getToken: () => string | null) => OpsWatchClient;
};

function defaultCreateClient(locale: string) {
  return (server: ServerConfig, getToken: () => string | null): OpsWatchClient =>
    server.demo ? createDemoClient() : createHttpClient({ baseUrl: server.url, getToken, locale });
}

/**
 * Applies the demo capability switches to a demo session's advertised features. A real server is never touched: its
 * `GET /server` answer is the only thing that decides what the app offers.
 */
export function withDemoCapabilities(state: SessionState, overrides: Partial<Record<Feature, boolean>>): SessionState {
  if (state.status !== 'signed-in' || !state.server.demo || !state.server.info) return state;
  const entries = Object.entries(overrides).filter(([, value]) => value === false);
  if (!entries.length) return state;
  const features = { ...state.server.info.features };
  for (const [feature] of entries) features[feature as Feature] = false;
  return { ...state, server: { ...state.server, info: { ...state.server.info, features } } };
}

export function SessionProvider({ children, locale, createClient }: SessionProviderProps) {
  const { settings } = useSettings();
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const listeners = useRef(new Set<SessionEndListener>());
  const build = useMemo(() => createClient ?? defaultCreateClient(locale), [createClient, locale]);

  const server = state.status === 'signed-in' || state.status === 'signed-out' ? state.server : null;
  const client = useMemo(() => (server ? build(server, sessionToken.get) : noServerClient), [server, build]);

  const notifyEnd = useCallback(async (reason: Parameters<SessionEndListener>[0], revoker: OpsWatchClient | null) => {
    await Promise.all([...listeners.current].map(async (listener) => {
      try {
        await listener(reason, revoker);
      } catch (error) {
        log.warn('Session end listener failed', error);
      }
    }));
  }, []);

  // Startup: restore the server and, when a token exists, the signed-in state. The token is validated by the first
  // authenticated request; a 401 then expires the session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await prefs.get<StoredServer | null>(PREF_KEYS.server, null);
      if (cancelled) return;
      if (!stored) {
        setState({ status: 'no-server' });
        return;
      }
      const { user, ...serverConfig } = stored;
      if (serverConfig.demo) {
        setState({ status: 'signed-in', server: serverConfig, user: user ?? { email: DEMO_CREDENTIALS.email } });
        return;
      }
      const token = await secureStore.get(sessionKey(serverConfig.url));
      if (cancelled) return;
      sessionToken.set(token);
      setState(token && user ? { status: 'signed-in', server: serverConfig, user } : { status: 'signed-out', server: serverConfig, reason: null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistServer = useCallback(async (config: ServerConfig, user?: User) => {
    const stored: StoredServer = { ...config, user };
    await prefs.set(PREF_KEYS.server, stored);
  }, []);

  const connect = useCallback<SessionContextValue['connect']>(
    async (config) => {
      const next: ServerConfig = { ...config, demo: false };
      sessionToken.set(await secureStore.get(sessionKey(next.url)));
      if (sessionToken.get()) {
        // A token from an earlier visit to this server is not trusted blindly: it must still work.
        try {
          const user = await build(next, sessionToken.get).me();
          await persistServer(next, user);
          setState({ status: 'signed-in', server: next, user });
          return;
        } catch {
          await secureStore.remove(sessionKey(next.url));
          sessionToken.set(null);
        }
      }
      await persistServer(next);
      setState({ status: 'signed-out', server: next, reason: null });
    },
    [build, persistServer],
  );

  const startDemo = useCallback(async () => {
    const demo: ServerConfig = { url: DEMO_SERVER_URL, demo: true, insecure: false, info: null };
    const info = await build(demo, () => null).getServerInfo();
    const config = { ...demo, info };
    const user = { email: DEMO_CREDENTIALS.email, name: 'Demo user' };
    await persistServer(config, user);
    setState({ status: 'signed-in', server: config, user });
  }, [build, persistServer]);

  const completeSignIn = useCallback(
    async (config: ServerConfig, token: string, user: User) => {
      await secureStore.set(sessionKey(config.url), token);
      sessionToken.set(token);
      await persistServer(config, user);
      setState({ status: 'signed-in', server: config, user });
    },
    [persistServer],
  );

  const signIn = useCallback<SessionContextValue['signIn']>(
    async (email, password) => {
      if (!server) throw new ApiError('network', { message: 'No server configured' });
      const session = await client.login(email.trim(), password);
      await completeSignIn(server, session.token, session.user);
    },
    [client, server, completeSignIn],
  );

  const signInWithGoogle = useCallback(async () => {
    if (!server) throw new ApiError('network', { message: 'No server configured' });
    const { verifier, challenge, state: oauthState } = await createPkcePair();
    const redirectUri = Linking.createURL('auth/callback');
    const result = await WebBrowser.openAuthSessionAsync(client.googleStartUrl(redirectUri, challenge, oauthState), redirectUri, {
      preferEphemeralSession: true,
    });
    if (result.type !== 'success') throw new ApiError('cancelled');
    const redirect = readAuthRedirect(result.url, oauthState);
    if ('error' in redirect) throw new ApiError(redirect.error === 'denied' ? 'forbidden' : 'validation', { code: redirect.error });
    const session = await client.exchangeGoogleCode(redirect.code, verifier, redirectUri);
    await completeSignIn(server, session.token, session.user);
  }, [client, server, completeSignIn]);

  /**
   * Ends the session. The app is signed out locally first — token out of memory and out of the Keychain, state
   * changed — so a hanging network can never leave it showing production data with a live token. Server-side
   * revocation and device unregistration then run as best effort, through a client still holding the old token.
   */
  const endSession = useCallback(
    async (reason: 'expired' | 'signed-out') => {
      if (!server) return;
      const token = sessionToken.get();
      const revoker = token && !server.demo ? build(server, () => token) : null;

      sessionToken.set(null);
      await secureStore.remove(sessionKey(server.url));
      await persistServer(server);
      if (server.demo) {
        await prefs.remove(PREF_KEYS.server);
        setState({ status: 'no-server' });
      } else {
        setState({ status: 'signed-out', server, reason });
      }

      // Not awaited by the caller: signing out must feel immediate and must work offline.
      void (async () => {
        await notifyEnd(reason, revoker);
        // An expired token is already worthless, so only an explicit sign-out asks the server to forget it.
        if (reason === 'signed-out' && revoker) {
          await revoker.logout().catch((error: unknown) => log.debug('Server-side logout failed', error));
        }
      })();
    },
    [server, build, persistServer, notifyEnd],
  );

  const signOut = useCallback(async () => {
    pendingLink.clear();
    await endSession('signed-out');
  }, [endSession]);

  const expiring = useRef(false);
  const expire = useCallback(() => {
    if (expiring.current || state.status !== 'signed-in' || state.server.demo) return;
    expiring.current = true;
    // A destination captured before the session ended must not be replayed into a later, possibly different session.
    pendingLink.clear();
    void endSession('expired').finally(() => {
      expiring.current = false;
    });
  }, [state, endSession]);

  const forgetServer = useCallback(async () => {
    if (state.status === 'signed-in') await signOut();
    if (server) await secureStore.remove(sessionKey(server.url));
    sessionToken.set(null);
    pendingLink.clear();
    await prefs.remove(PREF_KEYS.server);
    await notifyEnd('server-changed', null);
    setState({ status: 'no-server' });
  }, [state.status, server, signOut, notifyEnd]);

  const refreshServerInfo = useCallback(async () => {
    if (!server) return;
    try {
      const info = await client.getServerInfo();
      if (info.apiVersion !== API_VERSION) log.warn('Server mobile API version differs', { server: info.apiVersion, app: API_VERSION });
      const next = { ...server, info };
      setState((current) => (current.status === 'signed-in' || current.status === 'signed-out' ? { ...current, server: next } : current));
      await persistServer(next, state.status === 'signed-in' ? state.user : undefined);
    } catch (error) {
      // Offline or server down: keep the capabilities learned last time.
      log.debug('Server info refresh failed', error);
    }
  }, [server, client, persistServer, state]);

  const onSessionEnd = useCallback((listener: SessionEndListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  // In demo mode the user can switch capabilities off to see the app degrade; everywhere else the server decides.
  const visibleState = useMemo(() => withDemoCapabilities(state, settings.demoCapabilities), [state, settings.demoCapabilities]);

  const value = useMemo<SessionContextValue>(
    () => ({ state: visibleState, client, connect, startDemo, signIn, signInWithGoogle, signOut, forgetServer, expire, refreshServerInfo, onSessionEnd }),
    [visibleState, client, connect, startDemo, signIn, signInWithGoogle, signOut, forgetServer, expire, refreshServerInfo, onSessionEnd],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/**
 * The signed-in server's capabilities. A server that has not said what it provides counts as not providing it: the
 * app never offers a feature it cannot confirm. `useFeatureStatus` (src/ui/states.tsx) tells the two cases apart for
 * the explanatory screen.
 */
export function useFeature(feature: keyof ServerInfo['features']): boolean {
  const { state } = useSession();
  if (state.status !== 'signed-in' && state.status !== 'signed-out') return false;
  return state.server.info?.features[feature] ?? false;
}
