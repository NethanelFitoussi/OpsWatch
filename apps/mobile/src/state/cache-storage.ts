/**
 * Where the offline query cache lives on disk.
 *
 * It holds service, problem and incident names — an operational inventory. AsyncStorage keeps its data in a place
 * both platforms sweep into device backups (iCloud or iTunes on iOS, Google Drive on Android), so this cache is
 * written to the OS cache directory instead, which neither platform backs up. The trade is that the system may
 * delete it when storage runs low, which is exactly the right trade for data whose worst case is "load it again".
 *
 * On web (a QA target only) there is no such directory, so it falls back to AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { log } from '@/lib/log';

const isWeb = Platform.OS === 'web';
const FOLDER = 'opswatch-cache';

/** One file per key; the key is sanitised because it becomes a file name. */
function fileFor(key: string): File {
  const directory = new Directory(Paths.cache, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true });
  return new File(directory, `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
}

export type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/**
 * A ceiling on one snapshot. Beyond it the write is skipped rather than attempted: a failed write is silent, and an
 * offline cache that has quietly stopped working is worse than one that is missing a very large list.
 */
export const MAX_CACHE_BYTES = 2_000_000;

export const cacheStorage: AsyncStorageLike = {
  async getItem(key) {
    if (isWeb) return AsyncStorage.getItem(key);
    try {
      const file = fileFor(key);
      return file.exists ? await file.text() : null;
    } catch (error) {
      // A cache that cannot be read is simply a cold start.
      log.debug('Cache read failed', error);
      return null;
    }
  },
  async setItem(key, value) {
    if (value.length > MAX_CACHE_BYTES) {
      log.debug('Offline cache snapshot too large to keep', `${value.length} bytes`);
      await cacheStorage.removeItem(key);
      return;
    }
    if (isWeb) return AsyncStorage.setItem(key, value);
    try {
      fileFor(key).write(value);
    } catch (error) {
      log.debug('Cache write failed', error);
    }
  },
  async removeItem(key) {
    if (isWeb) return AsyncStorage.removeItem(key);
    try {
      const file = fileFor(key);
      if (file.exists) file.delete();
    } catch (error) {
      log.debug('Cache delete failed', error);
    }
  },
};

/**
 * Removes the cache written by older versions of the app, which lived in AsyncStorage and therefore in device
 * backups. Runs once per launch and costs nothing when there is nothing to remove.
 */
export async function forgetBackedUpCache(key: string): Promise<void> {
  if (isWeb) return;
  try {
    if ((await AsyncStorage.getItem(key)) !== null) {
      await AsyncStorage.removeItem(key);
      log.debug('Removed the offline cache left in backed-up storage by an earlier version');
    }
  } catch {
    // Nothing to clean up, or storage is unavailable: neither is worth reporting.
  }
}
