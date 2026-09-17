export const AUTO_REFRESH_MS = 120_000;

export type RefreshTimer = { setPaused(paused: boolean): void; setVisible(visible: boolean): void; dispose(): void };

/** Runs `onTick` every interval only while visible, not paused and not disposed. Pure: no DOM access. */
export function createRefreshTimer(options: { onTick: () => void; visible: boolean; paused: boolean; intervalMs?: number }): RefreshTimer {
  const intervalMs = options.intervalMs ?? AUTO_REFRESH_MS;
  let visible = options.visible;
  let paused = options.paused;
  let disposed = false;
  let handle: ReturnType<typeof setInterval> | undefined;

  const sync = () => {
    const shouldRun = visible && !paused && !disposed;
    if (shouldRun && handle === undefined) handle = setInterval(options.onTick, intervalMs);
    if (!shouldRun && handle !== undefined) {
      clearInterval(handle);
      handle = undefined;
    }
  };
  sync();
  return {
    setPaused(value) {
      paused = value;
      sync();
    },
    setVisible(value) {
      visible = value;
      sync();
    },
    dispose() {
      disposed = true;
      sync();
    },
  };
}
