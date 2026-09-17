export type RateLimiter = {
  attempt(key: string, now?: number): boolean;
  reset(key: string): void;
  size(): number;
};

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 10_000;

  return {
    attempt(key, now = Date.now()) {
      if (hits.size >= maxKeys) {
        for (const [k, times] of hits) {
          if (times.every((t) => now - t >= options.windowMs)) hits.delete(k);
        }
      }
      const recent = (hits.get(key) ?? []).filter((t) => now - t < options.windowMs);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    reset(key) {
      hits.delete(key);
    },
    size() {
      return hits.size;
    },
  };
}
