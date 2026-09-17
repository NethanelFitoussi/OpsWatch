import type { ClientQueryResults, LogsApi, LogsClientError } from './logs-api';
import { LOGS_CLIENT_TIMEOUT_MS, LOGS_POLL_INTERVAL_MS, TERMINAL_QUERY_STATUSES } from './logs-queries';

export type PollOutcome =
  | { kind: 'complete'; results: ClientQueryResults }
  | { kind: 'ended'; status: string; results: ClientQueryResults }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'error'; error: LogsClientError };

const COMPLETE = 'Complete';
const ENDED = new Set<string>(TERMINAL_QUERY_STATUSES.filter((status) => status !== COMPLETE));

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Starts a Logs Insights query and polls it every second until it ends, the user leaves or 60 seconds pass.
 * Every exit that leaves a query running on AWS asks the server to stop it; a failing stop is ignored.
 */
export async function runLogsQuery(options: {
  api: LogsApi;
  input: Parameters<LogsApi['start']>[0];
  signal: AbortSignal;
  onProgress: (results: ClientQueryResults, elapsedMs: number) => void;
  onStarted?: (queryId: string) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<PollOutcome> {
  const { api, signal, onProgress } = options;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? LOGS_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? LOGS_CLIENT_TIMEOUT_MS;
  const stop = (queryId: string) => api.stop(queryId).catch(() => undefined);

  const started = await api.start(options.input);
  if (!started.ok) return { kind: 'error', error: started.error };
  const { queryId } = started.data;
  options.onStarted?.(queryId);
  const startedAt = now();

  for (;;) {
    if (signal.aborted) {
      await stop(queryId);
      return { kind: 'aborted' };
    }
    const polled = await api.poll(queryId);
    if (!polled.ok) return { kind: 'error', error: polled.error };
    onProgress(polled.data, now() - startedAt);
    if (polled.data.status === COMPLETE) return { kind: 'complete', results: polled.data };
    if (ENDED.has(polled.data.status)) return { kind: 'ended', status: polled.data.status, results: polled.data };
    if (now() - startedAt >= timeoutMs) {
      await stop(queryId);
      return { kind: 'timeout' };
    }
    await sleep(intervalMs, signal);
    if (now() - startedAt >= timeoutMs && !signal.aborted) {
      await stop(queryId);
      return { kind: 'timeout' };
    }
  }
}
