/**
 * Pure helpers for the Errors screens: status labels, tones and icons, filter mapping, counts that keep `null`
 * distinct from zero, and the text the stack-trace "Copy" puts on the clipboard.
 */
import type { ErrorFilters } from '@/api/client';
import type { ErrorDetail, ErrorSummary, StackFrame } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import { formatCompact } from '@/lib/format';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type ErrorStatus = ErrorSummary['status'];
export type ErrorStatusFilter = 'all' | ErrorStatus;

/** Chip order on the list screen. "All" first, then the states that need attention. */
export const ERROR_STATUS_FILTERS: readonly ErrorStatusFilter[] = ['all', 'new', 'regression', 'recurring', 'resolved'];

export function errorStatusLabelKey(status: ErrorStatus): MessageKey {
  return `errors.status.${status}`;
}

export function errorFilterLabelKey(filter: ErrorStatusFilter): MessageKey {
  return filter === 'all' ? 'filter.all' : `errors.filter.${filter}`;
}

/** One short sentence saying what the status means, so "Regression" is never read as "New". */
export function errorStatusMeaningKey(status: ErrorStatus): MessageKey {
  return `errors.meaning.${status}`;
}

/**
 * Whether the list row spells the status out. A regression and a first sighting change what the on-call person does
 * next; "Recurring" and "Resolved" say enough on their own and would only add noise to every row.
 */
export function errorStatusNeedsExplaining(status: ErrorStatus): boolean {
  return status === 'regression' || status === 'new';
}

const STATUS_TONES: Record<ErrorStatus, Tone> = {
  regression: 'critical',
  new: 'warning',
  recurring: 'info',
  resolved: 'healthy',
};

const STATUS_ICONS: Record<ErrorStatus, IconName> = {
  regression: 'arrow-undo-circle',
  new: 'add-circle',
  recurring: 'repeat',
  resolved: 'checkmark-circle',
};

export function errorStatusTone(status: ErrorStatus): Tone {
  return STATUS_TONES[status];
}

export function errorStatusIcon(status: ErrorStatus): IconName {
  return STATUS_ICONS[status];
}

/** Builds the query filters from the chip selection and the optional `?service=` route parameter. */
export function errorFiltersFor(filter: ErrorStatusFilter, service?: string | null, since?: number | null): ErrorFilters {
  const out: ErrorFilters = {};
  if (filter !== 'all') out.status = filter;
  if (service) out.service = service;
  if (since !== null && since !== undefined) out.since = since;
  return out;
}

/** A count for display, or `null` when the server could not measure it (rendered as "No data", never 0). */
export function formatCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return formatCompact(value);
}

/** `file:line:column`, with whatever the server actually sent. */
export function frameLocation(frame: StackFrame): string {
  if (!frame.file) return '';
  return `${frame.file}${frame.line !== undefined ? `:${frame.line}` : ''}${frame.column !== undefined ? `:${frame.column}` : ''}`;
}

/** One `    at fn (file:line:col)` line, the shape every language's stack traces and every ticket already use. */
function frameCopyLine(frame: StackFrame): string {
  const where = frameLocation(frame) || frame.module || '';
  return `    at ${frame.function ?? '<anonymous>'}${where ? ` (${where})` : ''}`;
}

type CopyableError = Pick<ErrorDetail, 'message' | 'frames' | 'rawStack'> & Pick<Partial<ErrorDetail>, 'type'>;

/** The error's headline: "TypeError: message", without repeating the type when the message already carries it. */
export function errorHeadline(error: Pick<CopyableError, 'message' | 'type'>): string {
  return error.type && !error.message.startsWith(error.type) ? `${error.type}: ${error.message}` : error.message;
}

/**
 * What the stack-trace Copy button puts on the clipboard: the error line followed by the trace, so pasting into a
 * ticket gives a self-contained stack. Uses the server's raw stack when it sent one (nothing is reformatted away),
 * otherwise rebuilds the same shape from the parsed frames — which is the only copyable form for the many error
 * groups the contract carries `frames` but no `rawStack` for.
 */
export function stackCopyText(error: CopyableError): string {
  const head = errorHeadline(error);
  // Only blank lines are trimmed: the indentation of a raw stack's first frame is part of the format.
  const raw = error.rawStack?.trimEnd().replace(/^\n+/, '');
  if (raw) return raw.startsWith(head) || raw.startsWith(error.message) ? raw : `${head}\n${raw}`;
  if (!error.frames.length) return head;
  return [head, ...error.frames.map(frameCopyLine)].join('\n');
}

/** Whether there is a trace at all: drives both the viewer and the copy affordance. */
export function hasStack(error: Pick<CopyableError, 'frames' | 'rawStack'>): boolean {
  return error.frames.length > 0 || !!error.rawStack;
}
