import 'server-only';
import { sha256Hex } from '../crypto';

/**
 * How OpsWatch decides that two sightings are the same problem (§4.3).
 *
 * Everything under `src/lib/detect/` is pure: no AWS, no clock, no database. In particular nothing here may
 * import `@/lib/db/schema` — the store converts between this vocabulary and the row — which is why the subject
 * kinds are declared here rather than imported. `tests/unit/detect-key.test.ts` asserts the two lists match.
 */
export const PROBLEM_KEY_LENGTH = 32;

/** What a problem can be *about*. Mirrors `SUBJECT_TYPES` in the schema; the test keeps them in step. */
export const SUBJECT_KINDS = ['service', 'resource', 'cluster', 'error_group', 'synthetic', 'integration'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export type ProblemKeyParts = {
  connectionId: string;
  scope: string;
  /** The detector id: `ecs_cpu_high`, `error_group_new`, `synthetic_down`, … */
  kind: string;
  /** A service id, a resource id, an error group fingerprint or a synthetic id. */
  subjectId: string;
};

/**
 * The dedupe key: `sha256(connectionId | scope | kind | subjectId)`, truncated to 32 hex characters.
 *
 * **Nothing else enters it** — not the measured value, not the timestamp, not the message. That is the whole
 * point: a service whose CPU is 91 % now and 96 % in ten minutes is one problem that got worse, not two, and
 * it keeps one row for its whole life. The four parts are also stored in plain columns, so a human can read
 * why two things grouped without reversing a digest.
 *
 * The parts are length-prefixed rather than merely joined, so a separator inside a part cannot make two
 * different subjects collide.
 */
export function problemKey(parts: ProblemKeyParts): string {
  const fields = [parts.connectionId, parts.scope, parts.kind, parts.subjectId];
  return sha256Hex(fields.map((field) => `${field.length}:${field}`).join('|')).slice(0, PROBLEM_KEY_LENGTH);
}
