/**
 * Pure helpers for the incident screens: status presentation, duration text and timeline ordering.
 */
import type { IncidentSummary } from '@/api/contract';
import type { MessageKey } from '@/i18n';
import { formatDuration } from '@/lib/format';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type IncidentStatus = IncidentSummary['status'];

const STATUS_META: Record<IncidentStatus, { tone: Tone; icon: IconName; label: MessageKey }> = {
  open: { tone: 'critical', icon: 'flame', label: 'incidents.status.open' },
  investigating: { tone: 'warning', icon: 'search', label: 'incidents.status.investigating' },
  mitigated: { tone: 'info', icon: 'shield-half-outline', label: 'incidents.status.mitigated' },
  resolved: { tone: 'healthy', icon: 'checkmark-circle', label: 'incidents.status.resolved' },
};

export function incidentStatusMeta(status: IncidentStatus) {
  return STATUS_META[status];
}

export function isOngoing(incident: Pick<IncidentSummary, 'status' | 'resolvedAt'>): boolean {
  return incident.resolvedAt === null && incident.status !== 'resolved';
}

/**
 * Duration as a translatable message: ongoing incidents read "for 40 min", resolved ones "lasted 15 min". A resolved
 * incident without an end time has no measurable duration.
 */
export function incidentDurationText(
  incident: Pick<IncidentSummary, 'status' | 'startedAt' | 'resolvedAt'>,
  now: number,
): { key: MessageKey; params?: Record<string, string> } {
  if (isOngoing(incident)) return { key: 'incidents.durationOngoing', params: { duration: formatDuration(now - incident.startedAt) } };
  if (incident.resolvedAt === null) return { key: 'incidents.durationUnknown' };
  return { key: 'incidents.durationTotal', params: { duration: formatDuration(incident.resolvedAt - incident.startedAt) } };
}

const TIMELINE_TYPES: Record<string, MessageKey> = {
  opened: 'incidents.timeline.opened',
  status: 'incidents.timeline.status',
  note: 'incidents.timeline.note',
  resolved: 'incidents.timeline.resolved',
  alert: 'incidents.timeline.alert',
  deployment: 'incidents.timeline.deployment',
  action: 'incidents.timeline.action',
};

/** Known timeline entry types get a translated word; unknown ones from a newer server are shown as sent. */
export function timelineTypeKey(type: string): MessageKey | null {
  return TIMELINE_TYPES[type] ?? null;
}

/** Oldest first. */
export function chronological<T extends { at: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.at - b.at);
}

export function serviceNames(incident: Pick<IncidentSummary, 'affectedServices'>): string {
  return incident.affectedServices.map((s) => s.label ?? s.id).join(', ');
}
