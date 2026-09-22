/**
 * Two stores with different guarantees:
 * - `secureStore`: the session token only. iOS Keychain / Android Keystore through expo-secure-store, readable only
 *   while the device is unlocked and never migrated to another device. On web (a QA target only) it is kept in memory
 *   and never written to localStorage.
 * - `prefs`: non-sensitive preferences in AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { log } from '@/lib/log';

const memory = new Map<string, string>();
const isWeb = Platform.OS === 'web';
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureStore = {
  async get(key: string): Promise<string | null> {
    if (isWeb) return memory.get(key) ?? null;
    try {
      return await SecureStore.getItemAsync(key, SECURE_OPTIONS);
    } catch (error) {
      // A Keystore entry can become unreadable (for example after the lock screen was removed): treat it as absent.
      log.warn('Secure storage read failed', error);
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (isWeb) {
      memory.set(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, SECURE_OPTIONS);
  },
  async remove(key: string): Promise<void> {
    if (isWeb) {
      memory.delete(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
    } catch (error) {
      log.warn('Secure storage delete failed', error);
    }
  },
};

export const prefs = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      log.warn('Preference write failed', error);
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Nothing to do: a missing preference is the default.
    }
  },
};

export const PREF_KEYS = {
  server: 'opswatch.server.v1',
  settings: 'opswatch.settings.v1',
  queryCache: 'opswatch.query-cache.v1',
  deviceRegistration: 'opswatch.device-registration.v1',
} as const;

/** 32-bit FNV-1a, hex. Only used to derive a Keychain key name per server: not a security function. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The Keychain/Keystore entry of one server's token. SecureStore keys may only contain alphanumerics, `.`, `-` and
 * `_`, so the URL is sanitised rather than hashed: a 32-bit hash could collide, and a collision would hand one
 * server's token to another. The hash is kept only as a suffix, to keep the key short for very long URLs.
 */
export function sessionKey(serverUrl: string): string {
  const normalized = serverUrl.toLowerCase();
  const safe = normalized.replace(/[^a-z0-9._-]/g, '_').slice(0, 96);
  return `opswatch.session.${safe}.${fnv1a(normalized)}`;
}
