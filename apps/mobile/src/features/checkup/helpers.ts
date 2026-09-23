/**
 * Checkup: findings about how an environment is **set up**, as opposed to something breaking right now.
 *
 * The distinction is the reason this is a separate screen rather than more rows on Problems. A finding stays until
 * somebody changes a setting; a problem resolves itself when the trouble stops. Merging them would make both
 * meaningless.
 *
 * The rule this screen exists to honour is §2.6, which the contract carries onto the wire: a findings list is a
 * measurement only if you also know how much of the catalogue ran. "Nothing to report" out of twelve checks means
 * something; out of twelve checks where seven were refused it means almost nothing, and saying it without the
 * second half is the kind of quiet lie the whole app is built to avoid. So coverage is never optional here, and
 * the checks that could not run are shown rather than dropped.
 */
import type { CheckFinding, Checkup, CheckNotRun } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type CheckSeverity = CheckFinding['severity'];

const SEVERITY_META: Record<CheckSeverity, { tone: Tone; icon: IconName; label: MessageKey }> = {
  critical: { tone: 'critical', icon: 'alert-circle', label: 'severity.critical' },
  warning: { tone: 'warning', icon: 'warning', label: 'severity.warning' },
  info: { tone: 'info', icon: 'information-circle', label: 'severity.info' },
};

export function severityMeta(severity: CheckSeverity) {
  return SEVERITY_META[severity];
}

const RANK: Record<CheckSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Worst first, then by check id so the order is stable between refreshes. The server already sorts; re-sorting keeps
 * the screen honest if a future server does not, and costs nothing.
 */
export function sortFindings(findings: readonly CheckFinding[]): CheckFinding[] {
  return [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.id.localeCompare(b.id));
}

/**
 * The message key for a check, or the fallback for one this app has never heard of.
 *
 * A server newer than the app can emit a check id that is not in the catalogue. Rendering the raw id would show
 * someone `logs_budget_exhausted`; rendering nothing would hide a finding. Naming it as unrecognised is the honest
 * third option, and keeps the count on screen equal to the count the server sent.
 */
const KNOWN_CHECKS = new Set([
  'permissions_untested',
  'permissions_denied',
  'permissions_errored',
  'account_mismatch',
  'family_unreadable',
  'errors_not_collected',
  'history_off',
  'logs_budget',
  'logs_budget_exhausted',
  'collector_never_ran',
  'collector_job_failing',
  'template_outdated',
]);

export function isKnownCheck(id: string): boolean {
  return KNOWN_CHECKS.has(id);
}

export function checkMessageKey(id: string): MessageKey {
  return (isKnownCheck(id) ? `checkup.check.${id}` : 'checkup.check.unknown') as MessageKey;
}

/**
 * The *name* of a check, for one that could not run.
 *
 * A not-run entry carries no values, so describing it with the finding's sentence leaves that sentence's
 * placeholders unfilled — "the stack is version {version}" reached a device before this existed. A reader there
 * needs to know which check did not happen, not what it would have said.
 */
export function checkNameKey(id: string): MessageKey {
  return (isKnownCheck(id) ? `checkup.name.${id}` : 'checkup.name.unknown') as MessageKey;
}

/**
 * Values are placeholders the server supplies for the client's own sentence. They arrive as a record of unknown
 * shape, so they are stringified here — and bounded, because nothing stops a server sending a very long one.
 */
export const MAX_VALUE_LENGTH = 120;

export function checkValues(values: Record<string, string | number>, id: string): Record<string, string> {
  const out: Record<string, string> = { id };
  for (const [key, value] of Object.entries(values)) {
    const text = String(value);
    out[key] = text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
  }
  return out;
}

export function notRunReasonKey(reason: CheckNotRun['reason']): MessageKey {
  return `checkup.reason.${reason}` as MessageKey;
}

/** Whether the run covered the whole catalogue. An empty findings list only means "clean" when this is true. */
export function isCompleteRun(coverage: Checkup['coverage']): boolean {
  return coverage.notRun === 0 && coverage.ran === coverage.total;
}

/** A placeholder the substitution did not fill, as it would appear on screen. */
const UNFILLED = /\{[a-zA-Z]+\}/;

/**
 * Renders a check's sentence, or falls back to its name when the sentence cannot be filled in.
 *
 * Every value in a check's message comes from the server, and nothing guarantees a server sends the ones a given
 * sentence needs — a newer server, an older one, a bug, or simply a check that could not run and therefore has no
 * values at all. When that happens the substitution leaves `{version}` on screen, which is worse than saying less:
 * it looks broken and it tells the reader nothing.
 *
 * So the sentence is rendered, then checked. If anything is still unfilled, the check's name is used instead. The
 * finding stays on screen and keeps its severity; only the detail it could not state is dropped.
 */
export function renderCheck(
  id: string,
  values: Record<string, string | number>,
  t: (key: MessageKey, params?: Record<string, string>) => string,
): string {
  const params = checkValues(values, id);
  const sentence = t(checkMessageKey(id), params);
  return UNFILLED.test(sentence) ? t(checkNameKey(id), params) : sentence;
}
