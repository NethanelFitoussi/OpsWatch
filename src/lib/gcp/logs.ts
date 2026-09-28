import 'server-only';
import { accessTokenFor } from './federation';
import type { GcpTarget } from './target';

/**
 * Recent log entries from one Google Cloud project.
 *
 * **Optional, and the only part of a Google connection that reads content rather than figures.**
 * Everything else OpsWatch reads from Google is a count, a status or a number; a log line is whatever
 * somebody's code wrote, which may be anything. So this is behind a third role the operator grants
 * separately and may decline, the connection works completely without it, and the page says what
 * granting it allows before it is asked for.
 *
 * `roles/logging.viewer` deliberately, **not** `roles/logging.privateLogViewer`: the former excludes
 * Data Access logs, which are the ones recording who read what. The narrower role is the one that
 * answers "what was my application saying" without also handing over an audit trail of people.
 *
 * Nothing read here is stored, and nothing is sent to an AI provider. It is fetched when the page is
 * drawn and rendered; there is no collector behind it and no row written.
 *
 * Verified against the current reference rather than from memory:
 *
 *   - `POST https://logging.googleapis.com/v2/entries:list`, with a **body** — not query parameters
 *   - `resourceNames: ["projects/<id>"]`, at most 100 per request
 *   - `filter` is the Logging query language: `AND` upper case, values double-quoted, timestamps
 *     RFC 3339 and severities compared as quoted enum names
 *   - `orderBy: "timestamp desc"` for the most recent; `pageSize` defaults to 50
 *   - the scope is `https://www.googleapis.com/auth/logging.read`, inside `roles/logging.viewer`
 */

const API = 'https://logging.googleapis.com/v2/entries:list';
/** One page. This is "what is it saying now", not a log search: OpsWatch has no budget for Google. */
export const LOG_PAGE_SIZE = 50;
/** How far back a page looks. Bounded here so no caller can ask Google to scan a project's history. */
export const LOG_WINDOW_MS = 60 * 60_000;

/** The severities Google defines, in its own order. A floor is chosen from this and nothing else. */
export const GCP_SEVERITIES = ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'] as const;
export type GcpSeverity = (typeof GCP_SEVERITIES)[number];

export type GcpLogEntry = {
  id: string;
  at: number | null;
  severity: string;
  /** Which log it came from — `stdout`, `cloudaudit.googleapis.com/activity` — as Google named it. */
  logName: string;
  resourceType: string | null;
  resourceName: string | null;
  /** The line itself. Truncated here, because a single entry can be megabytes. */
  text: string;
};

export type GcpLogsFailure = 'denied' | 'unreachable' | 'no_token' | 'error';
export type GcpLogsResult = { ok: true; entries: GcpLogEntry[]; truncated: boolean } | { ok: false; reason: GcpLogsFailure; detail?: string };

/** Long enough to recognise a line, short enough that a page cannot be made enormous by one entry. */
const MAX_TEXT = 2_000;

const RESOURCE_NAME_LABELS = ['instance_name', 'instance_id', 'service_name', 'revision_name', 'function_name', 'bucket_name'];

const nameOf = (labels: Record<string, string> | undefined): string | null => {
  if (labels === undefined) return null;
  for (const label of RESOURCE_NAME_LABELS) {
    const value = labels[label];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
};

/** RFC 3339 to the second, which is what the query language compares against. */
const rfc3339 = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The filter, built from a chosen severity and a bounded window and nothing else.
 *
 * **No operator text reaches it.** Google's query language can address any field of any log, so a
 * free-text box wired straight into it is a way to ask a project questions OpsWatch never intended to
 * offer. The severity is checked against Google's own enum; the window is computed here.
 */
export function logFilter(minSeverity: GcpSeverity, startMs: number, endMs: number): string {
  const severity = (GCP_SEVERITIES as readonly string[]).includes(minSeverity) ? minSeverity : 'WARNING';
  return [`timestamp >= "${rfc3339(startMs)}"`, `timestamp <= "${rfc3339(endMs)}"`, `severity >= "${severity}"`].join(' AND ');
}

type RawEntry = {
  insertId?: string;
  timestamp?: string;
  severity?: string;
  logName?: string;
  resource?: { type?: string; labels?: Record<string, string> };
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  protoPayload?: Record<string, unknown>;
};

/** What the entry actually says, whichever of Google's three payload shapes carried it. */
function textOf(entry: RawEntry): string {
  if (typeof entry.textPayload === 'string') return entry.textPayload.slice(0, MAX_TEXT);
  const structured = entry.jsonPayload ?? entry.protoPayload;
  if (structured === undefined) return '';
  // A structured payload often has a `message`; when it does not, the object itself is the line.
  const message = (structured as { message?: unknown }).message;
  if (typeof message === 'string') return message.slice(0, MAX_TEXT);
  try {
    return JSON.stringify(structured).slice(0, MAX_TEXT);
  } catch {
    return '';
  }
}

export async function recentLogEntries(input: {
  target: GcpTarget;
  minSeverity: GcpSeverity;
  nowMs: number;
  windowMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<GcpLogsResult> {
  const call = input.fetchImpl ?? fetch;
  const token = await accessTokenFor({
    connectionId: input.target.connectionId,
    target: input.target.federation,
    key: input.target.key,
    baseUrl: input.target.baseUrl,
    nowMs: input.nowMs,
    fetchImpl: call,
  });
  if (!token.ok) return { ok: false, reason: token.reason === 'unreachable' ? 'unreachable' : 'no_token', detail: token.detail };

  const startMs = input.nowMs - (input.windowMs ?? LOG_WINDOW_MS);
  let response: Response;
  try {
    response = await call(API, {
      method: 'POST',
      headers: { authorization: `Bearer ${token.data.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceNames: [`projects/${input.target.projectId}`],
        filter: logFilter(input.minSeverity, startMs, input.nowMs),
        orderBy: 'timestamp desc',
        pageSize: LOG_PAGE_SIZE,
      }),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!response.ok) {
    const denied = response.status === 401 || response.status === 403;
    return { ok: false, reason: denied ? 'denied' : 'error' };
  }

  const body = (await response.json()) as { entries?: RawEntry[]; nextPageToken?: string };
  const entries: GcpLogEntry[] = [];
  for (const entry of body.entries ?? []) {
    const at = Date.parse(entry.timestamp ?? '');
    entries.push({
      // `insertId` is Google's own per-entry id. Without one there is still a line to show, so the
      // index stands in rather than the entry being dropped.
      id: typeof entry.insertId === 'string' && entry.insertId !== '' ? entry.insertId : `entry-${entries.length}`,
      at: Number.isNaN(at) ? null : at,
      // Google's own word. An entry with no severity is `DEFAULT` in its vocabulary, not "info".
      severity: entry.severity ?? 'DEFAULT',
      logName: typeof entry.logName === 'string' ? (entry.logName.split('/').pop() ?? entry.logName) : '',
      resourceType: entry.resource?.type ?? null,
      resourceName: nameOf(entry.resource?.labels),
      text: textOf(entry),
    });
  }

  // One page only, and said so: an operator seeing fifty lines should know there may be more.
  return { ok: true, entries, truncated: typeof body.nextPageToken === 'string' && body.nextPageToken !== '' };
}
