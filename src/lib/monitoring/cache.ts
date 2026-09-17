import 'server-only';
import { isFailure, type MonitoringResult } from './result';

export const METRICS_TTL_MS = 60_000;
export const DESCRIBE_TTL_MS = 60_000;
export const PI_TTL_MS = 5 * 60_000;
export const MAX_CACHE_ENTRIES = 500;

type Entry = { value: Promise<unknown>; expiresAt: number };

export type TtlCache = {
  /** A pending or unexpired value, marked as most recently used. */
  get<T>(key: string): Promise<T> | undefined;
  /** Stores a pending value. It expires `ttlMs` after it resolves; a failed result or a rejection removes it. */
  set<T>(key: string, value: Promise<T>, ttlMs: number): void;
  readonly size: number;
  clear(): void;
};

export function createTtlCache({ maxEntries = MAX_CACHE_ENTRIES, now = Date.now }: { maxEntries?: number; now?: () => number } = {}): TtlCache {
  const entries = new Map<string, Entry>();
  return {
    get<T>(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expiresAt <= now()) return undefined;
      entries.set(key, entry);
      return entry.value as Promise<T>;
    },
    set<T>(key: string, value: Promise<T>, ttlMs: number) {
      const entry: Entry = { value, expiresAt: Number.POSITIVE_INFINITY };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value as string);
      }
      value.then(
        (result) => {
          if (entries.get(key) !== entry) return;
          if (isFailure(result)) entries.delete(key);
          else entry.expiresAt = now() + ttlMs;
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

/** Never put credentials in `params`: keys are plain JSON. */
export function cacheKey(scope: { connectionId: string; region: string }, call: string, params: unknown): string {
  return JSON.stringify([scope.connectionId, scope.region, call, normalize(params)]);
}

export function cached<T>(cache: TtlCache, key: string, ttlMs: number, load: () => Promise<MonitoringResult<T>>): Promise<MonitoringResult<T>> {
  const hit = cache.get<MonitoringResult<T>>(key);
  if (hit) return hit;
  const value = load();
  cache.set(key, value, ttlMs);
  return value;
}

/** One cache per server process, shared by every viewer and card. */
export const monitoringCache: TtlCache = createTtlCache();
