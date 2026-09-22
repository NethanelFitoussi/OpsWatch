// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React 19's act() needs this flag, or effects run outside of it and the test races the timer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
// Mocked at the next-intl boundary (as `target-group-panel.test.ts` mocks `next-intl/server`), so the
// test does not need a real intl provider: the translator echoes its key and interpolated values.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => (values ? `${key}:${JSON.stringify(values)}` : key),
}));

const { AutoRefresh } = await import('@/components/monitoring/auto-refresh');

let container: HTMLDivElement;
let root: Root;

function mount(intervalMs: number) {
  act(() => {
    root.render(createElement(AutoRefresh, { intervalMs }));
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('AutoRefresh', () => {
  it('mounts no timer and shows no pause button when the interval is off', () => {
    mount(0);
    expect(container.textContent).toBe('refresh.off');
    expect(container.querySelector('button')).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reads a whole-minute interval as minutes', () => {
    mount(120_000);
    expect(container.textContent).toContain('refresh.every:{"minutes":2}');
  });

  it('reads a sub-minute interval as seconds', () => {
    mount(30_000);
    expect(container.textContent).toContain('refresh.everySeconds:{"seconds":30}');
  });

  it('pauses and resumes the tick on the pause button', () => {
    mount(120_000);
    act(() => vi.advanceTimersByTime(120_000));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => container.querySelector('button')!.click());
    expect(container.textContent).toContain('refresh.paused');
    act(() => vi.advanceTimersByTime(240_000));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => container.querySelector('button')!.click());
    act(() => vi.advanceTimersByTime(120_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('stops ticking while the tab is hidden and resumes a full interval once visible again', () => {
    mount(120_000);
    act(() => vi.advanceTimersByTime(60_000));
    setHidden(true);
    act(() => vi.advanceTimersByTime(600_000));
    expect(refresh).not.toHaveBeenCalled();

    setHidden(false);
    act(() => vi.advanceTimersByTime(119_999));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
