import 'server-only';

export const QUERY_BINDING_TTL_MS = 10 * 60_000;
export const MAX_QUERY_BINDINGS = 1000;

/** What a Logs Insights query id is allowed to be polled with: one connection, one region, one signed-in session. */
export type QueryBinding = { connectionId: string; region: string; sessionId: string };
export type QueryBindings = {
  bind(queryId: string, binding: QueryBinding): void;
  matches(queryId: string, binding: QueryBinding): boolean;
  forget(queryId: string): void;
};

export function createQueryBindings({
  // `Date.now()` rather than the `Date.now` reference: the clock is read at call time.
  now = () => Date.now(),
  ttlMs = QUERY_BINDING_TTL_MS,
  maxEntries = MAX_QUERY_BINDINGS,
}: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}): QueryBindings {
  const entries = new Map<string, QueryBinding & { expiresAt: number }>();
  return {
    bind(queryId, binding) {
      const t = now();
      for (const [id, entry] of entries) if (entry.expiresAt <= t) entries.delete(id);
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
      entries.set(queryId, { ...binding, expiresAt: t + ttlMs });
    },
    matches(queryId, binding) {
      const entry = entries.get(queryId);
      return (
        entry !== undefined &&
        entry.expiresAt > now() &&
        entry.connectionId === binding.connectionId &&
        entry.region === binding.region &&
        entry.sessionId === binding.sessionId
      );
    },
    forget(queryId) {
      entries.delete(queryId);
    },
  };
}

/** Per process: a query started on one OpsWatch instance can only be polled on that instance. */
export const queryBindings: QueryBindings = createQueryBindings();
