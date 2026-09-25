'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toggleGroup, withGroups } from '@/lib/monitoring/shared/logs-selection';

type LogsSelection = {
  /** The log groups the editor queries, in the order they were ticked. */
  selected: string[];
  /** The cap the query API enforces: the picker stops there instead of letting the server silently drop groups. */
  max: number;
  toggle: (name: string, checked: boolean) => void;
  /** Unticks everything at once. A selection of twenty is otherwise twenty clicks to undo. */
  clear: () => void;
  /** Sets the whole selection, for "select everything I can see" in the source picker. */
  replace: (names: string[]) => void;
};

const LogsSelectionContext = createContext<LogsSelection | null>(null);

export function useLogsSelection(): LogsSelection {
  const selection = useContext(LogsSelectionContext);
  if (selection === null) throw new Error('useLogsSelection is only usable inside LogsSelectionProvider');
  return selection;
}

/**
 * One selection, written by the picker and read by the editor, so a ticked group reaches the editor in the
 * same interaction. The URL still carries it (the page stays shareable and a reload restores it), but a tick
 * rewrites the URL through the History API: re-rendering the server tree on every checkbox would cost a round
 * trip, and an AWS call, for state the browser already holds.
 */
export function LogsSelectionProvider({ initial, max, children }: { initial: string[]; max: number; children: ReactNode }) {
  const initialKey = initial.join('\n');
  const [selected, setSelected] = useState(initial);
  const applied = useRef(initialKey);

  // A navigation (a link carrying ?group=, an AWS search, back and forward) decides the selection again.
  useEffect(() => {
    if (initialKey === applied.current) return;
    applied.current = initialKey;
    setSelected(initialKey === '' ? [] : initialKey.split('\n'));
  }, [initialKey]);

  const value = useMemo<LogsSelection>(() => {
    const apply = (next: string[]) => {
      setSelected(next);
      applied.current = next.join('\n');
      const search = withGroups(window.location.search, next);
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
    };
    return {
      selected,
      max,
      toggle: (name, checked) => apply(toggleGroup(selected, name, checked, max)),
      clear: () => apply([]),
      // Bounded by the same cap a tick is: a bulk select must not be a way past the query API's limit.
      replace: (names) => apply([...new Set(names)].slice(0, max)),
    };
  }, [max, selected]);

  return <LogsSelectionContext value={value}>{children}</LogsSelectionContext>;
}
