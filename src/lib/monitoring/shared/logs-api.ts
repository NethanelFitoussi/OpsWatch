import { LOGS_STOP_TIMEOUT_MS } from './logs-queries';

/** The Logs Insights routes as the browser sees them: only ids, never credentials. */
export type LogsClientError = { code: string; action?: string; awsCode?: string };

export type ClientQueryResults = {
  status: string;
  fields: string[];
  rows: Record<string, string>[];
  statistics: { recordsMatched: number; recordsScanned: number; bytesScanned: number };
};

type ApiOutcome<T> = { ok: true; data: T } | { ok: false; error: LogsClientError };

export type LogsApi = {
  start(input: { logGroups: string[]; query: string; startSeconds: number; endSeconds: number }): Promise<ApiOutcome<{ queryId: string }>>;
  poll(queryId: string): Promise<ApiOutcome<ClientQueryResults>>;
  stop(queryId: string): Promise<void>;
};

const base = (connectionId: string, region: string) =>
  `/api/connections/${encodeURIComponent(connectionId)}/regions/${encodeURIComponent(region)}/logs/query`;

async function outcome<T>(send: () => Promise<Response>): Promise<ApiOutcome<T>> {
  let response: Response;
  try {
    response = await send();
  } catch {
    // A dropped connection reads like any other failed request; nothing about it is shown verbatim.
    return { ok: false, error: { code: 'request_failed' } };
  }
  if (response.ok) {
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, error: { code: 'request_failed' } };
    }
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; action?: string; code?: string };
  return { ok: false, error: { code: body.error ?? 'request_failed', action: body.action, awsCode: body.code } };
}

export function createLogsApi(connectionId: string, region: string): LogsApi {
  const url = base(connectionId, region);
  return {
    start: (input) =>
      outcome(() => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })),
    poll: (queryId) => outcome(() => fetch(`${url}/${encodeURIComponent(queryId)}`, { cache: 'no-store' })),
    // keepalive lets the stop request finish when the user leaves the page; the timeout signal keeps it from
    // hanging forever when it never gets a response, which would otherwise leave the poller stuck awaiting it.
    stop: async (queryId) => {
      try {
        await fetch(`${url}/${encodeURIComponent(queryId)}`, { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(LOGS_STOP_TIMEOUT_MS) });
      } catch {
        // A timed-out or otherwise failed stop is ignored, same as a stop the server itself could not complete.
      }
    },
  };
}
