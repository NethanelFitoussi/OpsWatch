/**
 * The offline cache holds an operational inventory (service, problem and incident names), so it is written where
 * neither platform includes it in device backups, and what older versions left in backed-up storage is removed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheStorage, forgetBackedUpCache, MAX_CACHE_BYTES } from '../cache-storage';
import { PREF_KEYS } from '../storage';

beforeEach(async () => {
  await AsyncStorage.clear();
  await cacheStorage.removeItem(PREF_KEYS.queryCache);
});

it('round-trips a value and forgets it on request', async () => {
  expect(await cacheStorage.getItem(PREF_KEYS.queryCache)).toBeNull();
  await cacheStorage.setItem(PREF_KEYS.queryCache, '{"snapshot":1}');
  expect(await cacheStorage.getItem(PREF_KEYS.queryCache)).toBe('{"snapshot":1}');
  await cacheStorage.removeItem(PREF_KEYS.queryCache);
  expect(await cacheStorage.getItem(PREF_KEYS.queryCache)).toBeNull();
});

it('does not write the cache into backed-up storage', async () => {
  await cacheStorage.setItem(PREF_KEYS.queryCache, '{"snapshot":2}');
  expect(await AsyncStorage.getItem(PREF_KEYS.queryCache)).toBeNull();
});

it('removes a cache an older version left in backed-up storage', async () => {
  await AsyncStorage.setItem(PREF_KEYS.queryCache, '{"from":"an older version"}');
  await forgetBackedUpCache(PREF_KEYS.queryCache);
  expect(await AsyncStorage.getItem(PREF_KEYS.queryCache)).toBeNull();
});

it('treats an unreadable cache as a cold start rather than failing', async () => {
  // Keys become file names, so anything is accepted without throwing.
  await expect(cacheStorage.setItem('weird key/../..', 'x')).resolves.toBeUndefined();
  await expect(cacheStorage.getItem('never-written')).resolves.toBeNull();
});

/**
 * A snapshot over the ceiling is dropped, and the stale one with it. Writing it and failing halfway would leave a
 * truncated file that parses as nothing, and keeping the previous snapshot would serve data the app has decided it
 * can no longer maintain — on a screen whose whole job is to say how old what you are looking at is.
 */
it('drops an oversized snapshot, and the stale one it would have replaced', async () => {
  await cacheStorage.setItem(PREF_KEYS.queryCache, '{"snapshot":"small"}');
  expect(await cacheStorage.getItem(PREF_KEYS.queryCache)).toBe('{"snapshot":"small"}');

  await cacheStorage.setItem(PREF_KEYS.queryCache, 'x'.repeat(MAX_CACHE_BYTES + 1));
  expect(await cacheStorage.getItem(PREF_KEYS.queryCache)).toBeNull();
});

it('keeps a snapshot exactly at the ceiling', async () => {
  const atTheLimit = 'x'.repeat(MAX_CACHE_BYTES);
  await cacheStorage.setItem(PREF_KEYS.queryCache, atTheLimit);
  expect(await cacheStorage.getItem(PREF_KEYS.queryCache)).toBe(atTheLimit);
});
