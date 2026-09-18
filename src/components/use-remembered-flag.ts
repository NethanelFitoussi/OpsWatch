'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * An on/off choice of one browser, such as a collapsed menu, remembered across reloads.
 *
 * One store per key rather than a `useState` per component: the toggle button and the menu it controls
 * are separate components, and a state each would let them disagree. Private windows, blocked site data
 * and server rendering all make `localStorage` unavailable or throwing, so every access is guarded and
 * the caller falls back to "off": the choice is a convenience, never state the page depends on.
 */
type Store = { value: boolean; read: boolean; listeners: Set<() => void> };

const stores = new Map<string, Store>();

function storeOf(key: string): Store {
  const existing = stores.get(key);
  if (existing) return existing;
  const created: Store = { value: false, read: false, listeners: new Set() };
  stores.set(key, created);
  return created;
}

function set(key: string, value: boolean): void {
  const store = storeOf(key);
  store.value = value;
  for (const listener of store.listeners) listener();
}

export function useRememberedFlag(key: string): { value: boolean; toggle: () => void } {
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = storeOf(key);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    [key],
  );
  // The server renders "off", so the first client render must too: the stored choice is read below,
  // after hydration, and reaches every subscriber through the store rather than through a setState.
  const value = useSyncExternalStore(
    subscribe,
    () => storeOf(key).value,
    () => false,
  );

  useEffect(() => {
    const store = storeOf(key);
    if (store.read) return;
    store.read = true;
    try {
      set(key, window.localStorage.getItem(key) === 'true');
    } catch {
      // Site data is blocked: nothing was remembered, and "off" is already what is rendered.
    }
  }, [key]);

  const toggle = useCallback(() => {
    const next = !storeOf(key).value;
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // Site data is blocked: the choice applies now but is not remembered.
    }
    set(key, next);
  }, [key]);

  return { value, toggle };
}
