import { LOGS_TIME_RANGES, type LogsTimeRange } from './logs-queries';
import { LOG_LEVELS, ROW_LIMITS, SEARCH_TEXT_MAX, type LogLevel } from './logs-search';

/**
 * Reading what a model proposed for the search box.
 *
 * **The model does not write the query.** It fills in the same five fields the search box has — text,
 * level, range, line count, log groups — and OpsWatch builds the Logs Insights query from them with
 * `buildSearchQuery`, which escapes the text it is given. So whatever the model says, the query that could
 * run is one OpsWatch constructed out of bounded values, and there is no path by which a model can append
 * a command, widen a range, reach a log group nobody selected or make a query cost more than the page
 * already allows.
 *
 * Everything outside that shape is **refused, never repaired**. A proposal OpsWatch half-understood is a
 * proposal nobody can check, and the whole point of showing the interpretation is that it can be checked.
 *
 * Pure: a string in, a proposal or a refusal out. No clock, no network, no database.
 */

/**
 * The same bound the server applies to a request, repeated where the textarea lives.
 *
 * Declared here rather than imported from `lib/ai/log-query.ts`, which is `server-only`: a client bundle
 * cannot import that module, and a hard-coded `300` in the component would be a bound nobody could find.
 */
export const MAX_REQUEST_LENGTH_CLIENT = 300;

export type ProposedSearch = {
  text: string;
  level: LogLevel | null;
  range: LogsTimeRange;
  limit: number;
  /** A subset of the log groups the operator had already selected. Never anything else. */
  groups: string[];
};

export type ProposalError =
  | 'not_json'
  | 'unknown_shape'
  | 'text_too_long'
  | 'unknown_level'
  | 'unknown_range'
  | 'unknown_limit'
  | 'unknown_group'
  | 'no_groups';

export type Proposal = { ok: true; value: ProposedSearch } | { ok: false; error: ProposalError };

/** The reply, with a code fence removed. A fence is a formatting habit, not a difference in meaning. */
export function unfence(reply: string): string {
  const trimmed = reply.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced === null ? trimmed : fenced[1];
}

/**
 * The fields, checked one at a time against what this page can actually do.
 *
 * `allowed.groups` is the selection the operator made **before** asking. A model naming a log group that
 * is not in it is refused rather than having its suggestion honoured: "search these logs" is a decision an
 * operator makes, and it is the decision that bounds what the query costs.
 */
export function parseProposal(reply: string, allowed: { groups: readonly string[] }): Proposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(reply));
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, error: 'unknown_shape' };
  const body = parsed as Record<string, unknown>;

  // A field OpsWatch does not know about is not ignored. `query`, `logGroupNames`, `startTime` — anything
  // extra means the model answered a different question, and acting on the half that parsed would be
  // acting on a proposal nobody checked.
  const known = ['text', 'level', 'range', 'limit', 'groups'];
  if (Object.keys(body).some((key) => !known.includes(key))) return { ok: false, error: 'unknown_shape' };

  const text = body.text ?? '';
  if (typeof text !== 'string') return { ok: false, error: 'unknown_shape' };
  if (text.length > SEARCH_TEXT_MAX) return { ok: false, error: 'text_too_long' };

  const level = body.level ?? null;
  if (level !== null && (typeof level !== 'string' || !(LOG_LEVELS as readonly string[]).includes(level))) {
    return { ok: false, error: 'unknown_level' };
  }

  if (typeof body.range !== 'string' || !(LOGS_TIME_RANGES as readonly string[]).includes(body.range)) {
    return { ok: false, error: 'unknown_range' };
  }

  if (typeof body.limit !== 'number' || !(ROW_LIMITS as readonly number[]).includes(body.limit)) {
    return { ok: false, error: 'unknown_limit' };
  }

  if (!Array.isArray(body.groups) || body.groups.some((group) => typeof group !== 'string')) {
    return { ok: false, error: 'unknown_shape' };
  }
  const groups = [...new Set(body.groups as string[])];
  if (groups.some((group) => !allowed.groups.includes(group))) return { ok: false, error: 'unknown_group' };
  if (groups.length === 0) return { ok: false, error: 'no_groups' };

  return {
    ok: true,
    value: { text: text.trim(), level: level as LogLevel | null, range: body.range as LogsTimeRange, limit: body.limit, groups },
  };
}

/**
 * The prompt, built from the request and the selected log group names — and nothing else.
 *
 * No log lines, no database rows, no credentials, no connection or account identifiers. Log content is
 * attacker-controlled by definition (it is whatever some process wrote, including whatever an attacker
 * made it write), so the safe answer to "could a log line hijack the model" is that a log line never
 * reaches it.
 *
 * The request itself is untrusted too — an operator can paste anything into it — which is why it is
 * labelled and quoted rather than concatenated into the instructions, and why nothing the model says is
 * acted on without `parseProposal`.
 */
export function buildProposalPrompt(request: string, groups: readonly string[]): string {
  return [
    'Log groups the operator has selected (you may use these and no others):',
    ...groups.map((group) => `- ${group}`),
    '',
    'The operator asked, between the markers:',
    '<<<REQUEST',
    request.trim(),
    'REQUEST>>>',
  ].join('\n');
}
