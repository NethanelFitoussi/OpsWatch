/**
 * Pure helpers of Home and the Morning Brief: the "do I act?" verdict, how the briefing groups what changed, and what
 * OpsWatch could not read. No React here so everything is unit-testable.
 */
import type { Change, Family, Health, HealthStatus } from '@/api/contract';
import type { MessageKey } from '@/i18n';

/** "Do I need to act?" derived from counts only, so it is the same everywhere. */
export function actionVerdict(counts: Health['counts']): { key: MessageKey; params?: Record<string, number> } {
  if (counts.critical > 0) return { key: counts.critical === 1 ? 'home.needAction.yes.one' : 'home.needAction.yes.other', params: { count: counts.critical } };
  if (counts.warning > 0) return { key: 'home.needAction.maybe' };
  return { key: 'home.needAction.no' };
}

/** Briefing order: what appeared, what grew, what shrank, what closed, what did not move. */
export const CHANGE_GROUPS = ['new', 'up', 'down', 'resolved', 'stable'] as const;

const GROUP_TITLES: Record<Change['direction'], MessageKey> = {
  new: 'brief.group.new',
  up: 'brief.group.up',
  down: 'brief.group.down',
  resolved: 'brief.group.resolved',
  stable: 'brief.group.stable',
};

export type ChangeGroup = { direction: Change['direction']; title: MessageKey; changes: Change[] };

/**
 * Changes grouped by the direction the server reported, in briefing order; empty groups are dropped and the server's
 * order inside a group is kept. Groups are named after the movement, never after a judgement OpsWatch cannot make.
 */
export function groupChanges(changes: Change[]): ChangeGroup[] {
  return CHANGE_GROUPS.map((direction) => ({
    direction,
    title: GROUP_TITLES[direction],
    changes: changes.filter((change) => change.direction === direction),
  })).filter((group) => group.changes.length > 0);
}

/** A family OpsWatch could not read is never shown as healthy, whatever status the server attached to it. */
export function familyStatus(family: Pick<Family, 'status' | 'unavailable'>): HealthStatus {
  return family.unavailable ? 'unknown' : family.status;
}

/** Families the server could not read. Their labels feed the "partial view" caveat next to the verdict. */
export function unreadableFamilies(families: Family[]): Family[] {
  return families.filter((family) => !!family.unavailable);
}

/** "denied (AccessDenied)": the human reason first, the machine code only as a detail. */
export function unavailableReason(unavailable: NonNullable<Family['unavailable']>): string {
  const { reason, code } = unavailable;
  if (!code || code === reason) return reason;
  return `${reason} (${code})`;
}
