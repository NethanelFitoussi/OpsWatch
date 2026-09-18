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
import { API_VERSION, type ServerInfo, type User } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { createDemoClient } from '@/demo/demo-client';
import { DEMO_CREDENTIALS } from '@/demo/fixtures';
import { log } from '@/lib/log';
import { createPkcePair, readAuthRedirect } from '@/lib/pkce';
import { pendingLink } from './pending-link';
import { prefs, PREF_KEYS, secureStore, sessionKey } from './storage';

export const DEMO_SERVER_URL = 'demo://opswatch';

export type ServerConfig = { url: string; demo: boolean; insecure: boolean; info: ServerInfo | null };
type StoredServer = ServerConfig & { user?: User };

export type SessionState =
  | { status: 'loading' }
  | { status: 'no-server' }
  | { status: 'signed-out'; server: ServerConfig; reason: 'expired' | 'signed-out' | null }
  | { status: 'signed-in'; server: ServerConfig; user: User };

type SessionEndListener = (reason: 'expired' | 'signed-out' | 'server-changed') => void | Promise<void>;

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

export function SessionProvider({ children, locale, createClient }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const tokenRef = useRef<string | null>(null);
  const listeners = useRef(new Set<SessionEndListener>());
  const build = useMemo(() => createClient ?? defaultCreateClient(locale), [createClient, locale]);

  const server = state.status === 'signed-in' || state.status === 'signed-out' ? state.server : null;
  const client = useMemo(() => (server ? build(server, () => tokenRef.current) : noServerClient), [server, build]);

  const notifyEnd = useCallback(async (reason: Parameters<SessionEndListener>[0]) => {
    await Promise.all([...listeners.current].map(async (listener) => {
      try {
        await listener(reason);
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
      tokenRef.current = token;
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
      tokenRef.current = await secureStore.get(sessionKey(next.url));
      if (tokenRef.current) {
        // A token from an earlier visit to this server is not trusted blindly: it must still work.
        try {
          const user = await build(next, () => tokenRef.current).me();
          await persistServer(next, user);
          setState({ status: 'signed-in', server: next, user });
          return;
        } catch {
          await secureStore.remove(sessionKey(next.url));
          tokenRef.current = null;
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
      tokenRef.current = token;
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
   * Ends the session. Listeners (device unregistration, cache wipe) run first, while the token is still usable; the
   * server-side session is revoked next (sign-out only); the token is dropped last.
   */
  const endSession = useCallback(
    async (reason: 'expired' | 'signed-out') => {
      if (!server) return;
      await notifyEnd(reason);
      if (reason === 'signed-out' && !server.demo) {
        // Best effort: signing out locally must work offline too.
        await client.logout().catch((error: unknown) => log.debug('Server-side logout failed', error));
      }
      await secureStore.remove(sessionKey(server.url));
      tokenRef.current = null;
      await persistServer(server);
      if (server.demo) {
        await prefs.remove(PREF_KEYS.server);
        setState({ status: 'no-server' });
        return;
      }
      setState({ status: 'signed-out', server, reason });
    },
    [server, client, persistServer, notifyEnd],
  );

  const signOut = useCallback(async () => {
    pendingLink.clear();
    await endSession('signed-out');
  }, [endSession]);

  const expiring = useRef(false);
  const expire = useCallback(() => {
    if (expiring.current || state.status !== 'signed-in' || state.server.demo) return;
    expiring.current = true;
    void endSession('expired').finally(() => {
      expiring.current = false;
    });
  }, [state, endSession]);

  const forgetServer = useCallback(async () => {
    if (state.status === 'signed-in') await signOut();
    if (server) await secureStore.remove(sessionKey(server.url));
    tokenRef.current = null;
    pendingLink.clear();
    await prefs.remove(PREF_KEYS.server);
    await notifyEnd('server-changed');
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

  const value = useMemo<SessionContextValue>(
    () => ({ state, client, connect, startDemo, signIn, signInWithGoogle, signOut, forgetServer, expire, refreshServerInfo, onSessionEnd }),
    [state, client, connect, startDemo, signIn, signInWithGoogle, signOut, forgetServer, expire, refreshServerInfo, onSessionEnd],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** The signed-in server's capabilities. Unknown (no info yet) counts as unavailable. */
export function useFeature(feature: keyof ServerInfo['features']): boolean {
  const { state } = useSession();
  if (state.status !== 'signed-in' && state.status !== 'signed-out') return false;
  return state.server.info?.features[feature] ?? false;
}
