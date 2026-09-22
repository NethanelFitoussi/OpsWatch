/**
 * Pure helpers of the Deployments screens: status presentation and the timing sentence that links a problem to a
 * deployment. The link is a correlation in time and is never phrased as a cause.
 */
import type { DeploymentSummary } from '@/api/contract';
import type { MessageKey, Params } from '@/i18n';
import { formatDuration, shortSha } from '@/lib/format';
import type { IconName } from '@/ui/layout';
import type { Tone } from '@/ui/theme';

export type DeploymentStatus = DeploymentSummary['status'];

export const DEPLOYMENT_STATUS_META: Record<DeploymentStatus, { tone: Tone; icon: IconName; label: MessageKey }> = {
  completed: { tone: 'healthy', icon: 'checkmark-circle', label: 'deployments.status.completed' },
  in_progress: { tone: 'info', icon: 'sync-circle', label: 'deployments.status.in_progress' },
  failed: { tone: 'critical', icon: 'close-circle', label: 'deployments.status.failed' },
  rolled_back: { tone: 'warning', icon: 'arrow-undo-circle', label: 'deployments.status.rolled_back' },
  unknown: { tone: 'unknown', icon: 'help-circle', label: 'deployments.status.unknown' },
};

/**
 * The timing fact for a problem that started around a deployment: "Started 3 min after this deployment".
 * A negative delay (clock skew, backfilled data) is stated as "before", never hidden.
 */
export function timingSentence(minutesAfterDeployment: number): { key: MessageKey; params: Params } {
  const delay = formatDuration(Math.abs(minutesAfterDeployment) * 60_000);
  if (minutesAfterDeployment < 0) return { key: 'deployments.startedBefore', params: { delay } };
  return { key: 'deployments.startedAfter', params: { delay } };
}

/** A deployment that did not end well: worth flagging on the screen, not just wording in a badge. */
export function isDeploymentUnsuccessful(status: DeploymentStatus): boolean {
  return status === 'failed' || status === 'rolled_back';
}

/** "8f3c2a9 · Batch currency lookups" (the first line of the message only). */
export function commitLine(commit: DeploymentSummary['commit']): string | undefined {
  if (!commit) return undefined;
  const title = commit.message?.split('\n')[0]?.trim();
  return title ? `${shortSha(commit.sha)} · ${title}` : shortSha(commit.sha);
}
