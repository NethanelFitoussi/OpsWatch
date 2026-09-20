import { describe, expect, it } from 'vitest';
import { PROBLEM_KEY_LENGTH, SUBJECT_KINDS, problemKey, type SubjectKind } from '@/lib/detect/key';
import { SUBJECT_TYPES } from '@/lib/db/schema';

const parts = { connectionId: 'c1', scope: 'us-east-1', kind: 'ecs_cpu_high', subjectId: 'prod/web' };

describe('the problem key', () => {
  it('is 32 lowercase hex characters', () => {
    const key = problemKey(parts);
    expect(key).toHaveLength(PROBLEM_KEY_LENGTH);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is the same every time, so a restart does not split one problem into two', () => {
    // Hard-coded rather than compared to itself: this pins the digest across processes and releases, which is
    // what makes a key survive a rebuild. A change here means every open problem in the field is re-keyed.
    // Computed independently of the implementation:
    //   printf '2:c1|9:us-east-1|12:ecs_cpu_high|8:prod/web' | sha256sum
    expect(problemKey(parts)).toBe(problemKey({ ...parts }));
    expect(problemKey(parts)).toBe('e36c817b67e2daa69eeabb20780158c8');
  });

  it('changes when any one of the four parts changes, and only then', () => {
    const keys = new Set([
      problemKey(parts),
      problemKey({ ...parts, connectionId: 'c2' }),
      problemKey({ ...parts, scope: 'eu-west-1' }),
      problemKey({ ...parts, kind: 'ecs_memory_high' }),
      problemKey({ ...parts, subjectId: 'prod/api' }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('cannot be confused by a separator in a part', () => {
    // 'a|b' + 'c' and 'a' + 'b|c' must not collide, or two unrelated subjects would share one problem row.
    // §4.3 writes the key as a plain '|' join, which collides on exactly this input; the parts are therefore
    // length-prefixed before hashing. See the deviation recorded in docs/RECOVERY.md.
    expect(problemKey({ ...parts, kind: 'a|b', subjectId: 'c' })).not.toBe(
      problemKey({ ...parts, kind: 'a', subjectId: 'b|c' }),
    );
  });

  it('takes nothing but the four parts — not a value, a timestamp or a message', () => {
    // §4.3: "Nothing else enters the key", which is what keeps one problem one row for its whole life.
    const withNoise = { ...parts } as Record<string, unknown>;
    withNoise.value = 96.2;
    withNoise.at = Date.now();
    withNoise.message = 'CPU is high';
    expect(problemKey(withNoise as typeof parts)).toBe(problemKey(parts));
  });

  it('knows the same subject kinds the store does, without importing the store to find out', () => {
    // `detect` is pure and may not import the schema; this is what stops the two lists drifting apart.
    expect([...SUBJECT_KINDS]).toEqual([...SUBJECT_TYPES]);
  });
});

describe('subject kinds', () => {
  it.each(SUBJECT_KINDS)('keys a %s subject distinctly from the same id of another kind', (kind: SubjectKind) => {
    // The kind is not in the key - the detector id is - so two kinds sharing an id must be told apart by the
    // detector that produced them. This pins that a caller cannot get away with reusing one detector id across
    // kinds and expecting distinct problems.
    const key = problemKey({ ...parts, kind: `detector_for_${kind}`, subjectId: 'shared-id' });
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toBe(problemKey({ ...parts, kind: 'detector_for_other', subjectId: 'shared-id' }));
  });
});
