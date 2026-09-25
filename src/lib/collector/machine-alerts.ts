import 'server-only';
import type { Db } from '../db/client';
import type { Candidate } from '../detect/alert';
import { hostFindings } from '../monitoring/shared/host-findings';
import { hostsInEnvironment } from '../store/hosts';

/**
 * Turning what an agent measured on a machine into something that alerts.
 *
 * The findings have existed since hosts were added, and nothing acted on them: a disk could fill on the
 * box running the owner's Redis and the only way to learn about it was to open the Machines page. This
 * is the part that tells somebody. It is the same arithmetic the page draws — `hostFindings` is pure and
 * is called by both — so the alert and the page can never disagree about what is wrong.
 *
 * **Only machines placed in this environment.** A host is matched to an AWS account and region when that
 * account's instances are listed, and the alert cycle runs per environment. A machine OpsWatch has not
 * placed is in no environment, raises nothing here, and the Machines page says so rather than implying
 * coverage that does not exist. Alerting on an unplaced machine needs a rule that is not about one AWS
 * environment, which `alert_rules` cannot hold today.
 *
 * Candidates only: whether any of this fires is the rules' decision, through the same dedupe, the same
 * cooldown and the same acknowledgement as everything else. A second alerting system beside the first is
 * how a product ends up with two answers to "why was I not told".
 */

export type MachineContext = { connectionId: string; scope: string };

/**
 * What each finding is called in an alert.
 *
 * Under `Insights.messages` with everything else an alert can say, rather than reusing the Machines
 * page's own wording: that page can write "nothing on this page is current" because the reader is
 * looking at it, and a webhook's reader is not. Written out one by one so a catalogue check can find
 * them by reading this file.
 */
const TITLE: Record<string, string> = {
  stopped_reporting: 'Insights.messages.machine_stopped_reporting',
  disk_full: 'Insights.messages.machine_disk_full',
  disk_nearly_full: 'Insights.messages.machine_disk_nearly_full',
  memory_nearly_exhausted: 'Insights.messages.machine_memory_nearly_exhausted',
};

export function machineCandidates(db: Db, context: MachineContext, nowMs: number): Candidate[] {
  const candidates: Candidate[] = [];
  for (const host of hostsInEnvironment(db, context.connectionId, context.scope, nowMs)) {
    for (const finding of hostFindings(host)) {
      candidates.push({
        /*
         * One alert per machine, kind and subject. The host's id rather than its name, so renaming a
         * machine does not read as a new problem starting; and the subject, so a second disk filling on
         * the same box is its own alert rather than being swallowed by the first.
         */
        subjectKey: `host:${host.id}:${finding.kind}:${finding.subject}`,
        kind: finding.kind,
        severity: finding.level,
        // There is no problem row behind this, and there is deliberately not one: `problems` is keyed to
        // an AWS environment by a column that cannot be null. The alert points at the machine instead.
        problemId: null,
        hostId: host.id,
        // Written out rather than built from the kind, so a catalogue check can find it by reading the
        // source. A key assembled at run time is one nothing notices is missing until it is on screen.
        titleKey: TITLE[finding.kind],
        values: {
          name: host.name,
          subject: finding.subject,
          // A finding without a figure — a machine that stopped reporting — says so rather than "0%".
          percent: finding.percent === null ? '' : finding.percent.toFixed(0),
        },
      });
    }
  }
  return candidates;
}
