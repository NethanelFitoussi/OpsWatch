/**
 * The value slots in a stored message that are themselves message keys.
 *
 * A detector runs in a job with no locale, so it cannot write "CPU reservation on ECS cluster prod" into
 * a problem — it would freeze one language into the database. Writing the AWS identifier instead is what
 * produced `Alarm ApplicationInsights/…/AWS/ECS/CPUReservation/… is in ALARM state.` on every report.
 *
 * So the detector stores the *ids* — `metricKey: 'cpuReservation'`, `subjectKind: 'ecs-cluster'`,
 * `subjectName: 'prod'` — and this turns them into words at the moment something is rendered, in the
 * locale of whoever is reading. The stored row stays language-neutral and the sentence stays human.
 *
 * Client-safe on purpose: the same expansion has to happen in the browser and on the server.
 */

export type MessageValues = Record<string, string | number>;

/** Looks a key up in a catalogue, or returns null when it is not there. */
export type Lookup = (key: string) => string | null;

/**
 * Expands the id slots into the text slots the message templates actually use.
 *
 * Nothing is invented: a slot whose id has no message is left out, and a template that needs it is not
 * the template the detector chose. The original values are kept, so a message that wants the identifier
 * can still have it.
 */
export function expandValues(values: MessageValues, lookup: Lookup): MessageValues {
  const out: MessageValues = { ...values };
  const metric = typeof values.metricKey === 'string' ? lookup(`Monitoring.alarms.metricNames.${values.metricKey}`) : null;
  if (metric !== null) out.metric = metric;

  const name = typeof values.subjectName === 'string' ? values.subjectName : null;
  if (name !== null) {
    // "ECS cluster prod", not "prod" and not "ClusterName=prod". An unrecognised kind contributes
    // nothing rather than a guess, and the name stands on its own.
    const kind = typeof values.subjectKind === 'string' && values.subjectKind !== 'unknown'
      ? lookup(`Monitoring.alarms.kinds.${values.subjectKind}`)
      : null;
    out.subject = kind === null ? name : `${kind} ${name}`;
  }
  return out;
}
