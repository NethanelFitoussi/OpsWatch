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

/** The part of `document` the mount helper reads, so mounting can be tested without a DOM. */
export type VisibilityTarget = {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

/**
 * Creates a refresh timer wired to a document's visibility, and returns it with its teardown.
 * `isPaused` is read at creation, never captured: a re-created timer (a re-run effect) must not
 * resume a page the user paused.
 */
export function mountRefreshTimer(options: {
  onTick: () => void;
  isPaused: () => boolean;
  target: VisibilityTarget;
  intervalMs?: number;
}): { timer: RefreshTimer; dispose(): void } {
  const { target } = options;
  const timer = createRefreshTimer({
    onTick: options.onTick,
    visible: target.visibilityState === 'visible',
    paused: options.isPaused(),
    intervalMs: options.intervalMs,
  });
  const onVisibility = () => timer.setVisible(target.visibilityState === 'visible');
  target.addEventListener('visibilitychange', onVisibility);
  return {
    timer,
    dispose() {
      target.removeEventListener('visibilitychange', onVisibility);
      timer.dispose();
    },
  };
}
