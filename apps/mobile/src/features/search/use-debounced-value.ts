import { useCallback, useEffect, useState } from 'react';

/**
 * The latest `value`, updated only once it has stopped changing for `delayMs`, plus `flush` to adopt it at once.
 * Pressing the search key should not cost another debounce interval.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): [T, () => void] {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  // `value` is this render's value, which is exactly what "adopt it now" means.
  const flush = useCallback(() => setDebounced(value), [value]);
  return [debounced, flush];
}
