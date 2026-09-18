/**
 * Broadcasts "the server rejected our session" from wherever it is detected (the query cache) to the session layer,
 * without either depending on the other.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export const authEvents = {
  emitUnauthorized(): void {
    listeners.forEach((listener) => listener());
  },
  onUnauthorized(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
