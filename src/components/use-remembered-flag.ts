'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * An on/off choice of one browser, such as a collapsed menu, remembered across reloads.
 *
 * One store per key rather than a `useState` per component: the toggle button and the menu it controls
 * are separate components, and a state each would let them disagree. Private windows, blocked site data
 * and server rendering all make `localStorage` unavailable or throwing, so every access is guarded and
 * the caller falls back to its default: the choice is a convenience, never state the page depends on.
 */
type Store = { value: boolean; read: boolean; listeners: Set<() => void> };

const stores = new Map<string, Store>();

function storeOf(key: string, fallback = false): Store {
  const existing = stores.get(key);
  if (existing) return existing;
  const created: Store = { value: fallback, read: false, listeners: new Set() };
  stores.set(key, created);
  return created;
}

function set(key: string, value: boolean): void {
  const store = storeOf(key);
  store.value = value;
  for (const listener of store.listeners) listener();
}

/**
 * @param fallback what the flag is before anybody has chosen, and where site data is unavailable.
 *
 * A default of `true` is what lets a menu start collapsed while still remembering an operator who opened
 * it: an absent key means "never chosen", which is different from a stored `false`.
 */
export function useRememberedFlag(key: string, fallback = false): { value: boolean; toggle: () => void } {
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = storeOf(key, fallback);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    [key, fallback],
  );
  // The server renders "off", so the first client render must too: the stored choice is read below,
  // after hydration, and reaches every subscriber through the store rather than through a setState.
  const value = useSyncExternalStore(
    subscribe,
    () => storeOf(key, fallback).value,
    () => fallback,
  );

  useEffect(() => {
    const store = storeOf(key, fallback);
    if (store.read) return;
    store.read = true;
    try {
      // Absent means nobody has chosen, which is the fallback — not `false`. A menu that starts closed
      // must still be able to remember an operator who opened it.
      const stored = window.localStorage.getItem(key);
      set(key, stored === null ? fallback : stored === 'true');
    } catch {
      // Site data is blocked: nothing was remembered, and the fallback is already what is rendered.
    }
  }, [key, fallback]);

  const toggle = useCallback(() => {
    const next = !storeOf(key, fallback).value;
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // Site data is blocked: the choice applies now but is not remembered.
    }
    set(key, next);
  }, [key, fallback]);

  return { value, toggle };
}
