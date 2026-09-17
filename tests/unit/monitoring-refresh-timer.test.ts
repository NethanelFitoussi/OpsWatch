import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_REFRESH_MS, createRefreshTimer } from '@/lib/monitoring/shared/refresh-timer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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
