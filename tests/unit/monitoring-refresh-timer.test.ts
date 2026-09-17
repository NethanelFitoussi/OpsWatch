import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_REFRESH_MS, createRefreshTimer, mountRefreshTimer, type VisibilityTarget } from '@/lib/monitoring/shared/refresh-timer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Just enough of `document` for the mount helper: a visibility state and its event. */
function fakeDocument(): VisibilityTarget & { setVisibility(state: 'visible' | 'hidden'): void; readonly listenerCount: number } {
  const listeners = new Set<() => void>();
  return {
    visibilityState: 'visible',
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    setVisibility(state) {
      this.visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('refresh timer', () => {
  it('ticks every 120 seconds while visible and not paused', () => {
    expect(AUTO_REFRESH_MS).toBe(120_000);
    const onTick = vi.fn();
    createRefreshTimer({ onTick, visible: true, paused: false });
    vi.advanceTimersByTime(119_999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('stops while the tab is hidden and restarts a full interval when visible again', () => {
    const onTick = vi.fn();
    const timer = createRefreshTimer({ onTick, visible: true, paused: false });
    vi.advanceTimersByTime(60_000);
    timer.setVisible(false);
    vi.advanceTimersByTime(300_000);
    expect(onTick).not.toHaveBeenCalled();
    timer.setVisible(true);
    vi.advanceTimersByTime(119_999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('mounts against a document, follows its visibility and unsubscribes when disposed', () => {
    const onTick = vi.fn();
    const doc = fakeDocument();
    const mounted = mountRefreshTimer({ onTick, isPaused: () => false, target: doc });
    doc.setVisibility('hidden');
    vi.advanceTimersByTime(600_000);
    expect(onTick).not.toHaveBeenCalled();
    doc.setVisibility('visible');
    vi.advanceTimersByTime(120_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    mounted.dispose();
    expect(doc.listenerCount).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('reads the current paused state at every mount, so a re-created timer stays paused', () => {
    const onTick = vi.fn();
    const doc = fakeDocument();
    let paused = false;
    const mount = () => mountRefreshTimer({ onTick, isPaused: () => paused, target: doc });

    const first = mount();
    paused = true;
    first.timer.setPaused(true);
    first.dispose();
    // The page is still paused: re-running the mount (a re-run effect) must not resume it.
    const second = mount();
    vi.advanceTimersByTime(600_000);
    expect(onTick).not.toHaveBeenCalled();
    paused = false;
    second.timer.setPaused(false);
    vi.advanceTimersByTime(120_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    second.dispose();
  });

  it('pauses, resumes and stops for good when disposed', () => {
    const onTick = vi.fn();
    const timer = createRefreshTimer({ onTick, visible: true, paused: true });
    vi.advanceTimersByTime(240_000);
    expect(onTick).not.toHaveBeenCalled();
    timer.setPaused(false);
    vi.advanceTimersByTime(120_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    timer.dispose();
    timer.setPaused(false);
    vi.advanceTimersByTime(600_000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });
});
