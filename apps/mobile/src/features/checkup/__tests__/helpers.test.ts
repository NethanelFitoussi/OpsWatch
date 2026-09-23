/**
 * The rule this screen exists for: a findings list means nothing without knowing how much of the catalogue ran.
 */
import type { CheckFinding } from '@/api/contract';
import { checkMessageKey, checkValues, isCompleteRun, isKnownCheck, MAX_VALUE_LENGTH, sortFindings } from '../helpers';

const finding = (id: string, severity: CheckFinding['severity']): CheckFinding => ({ id, severity, subject: null, values: {} });

describe('coverage', () => {
  it('is complete only when every check ran', () => {
    expect(isCompleteRun({ ran: 12, notRun: 0, total: 12 })).toBe(true);
    expect(isCompleteRun({ ran: 10, notRun: 2, total: 12 })).toBe(false);
    // A catalogue with nothing in it is trivially complete rather than a division by zero.
    expect(isCompleteRun({ ran: 0, notRun: 0, total: 0 })).toBe(true);
  });

  /** Defensive: a server that reports fewer runs than its own total has not covered the catalogue, whatever it says. */
  it('does not call a run complete when the numbers do not add up', () => {
    expect(isCompleteRun({ ran: 5, notRun: 0, total: 12 })).toBe(false);
  });
});

describe('findings', () => {
  it('puts the worst first, and stays in the same order between refreshes', () => {
    const sorted = sortFindings([finding('b', 'info'), finding('a', 'critical'), finding('c', 'warning'), finding('a2', 'critical')]);
    expect(sorted.map((f) => f.id)).toEqual(['a', 'a2', 'c', 'b']);
  });
});

describe('a check from a newer server', () => {
  it('is named as unrecognised rather than shown as a raw id or dropped', () => {
    expect(isKnownCheck('collector_never_ran')).toBe(true);
    expect(isKnownCheck('some_check_added_next_year')).toBe(false);
    expect(checkMessageKey('some_check_added_next_year')).toBe('checkup.check.unknown');
    // The id still reaches the sentence, so the message can name it.
    expect(checkValues({}, 'some_check_added_next_year').id).toBe('some_check_added_next_year');
  });
});

describe('values', () => {
  it('stringifies whatever the server sent, and bounds it', () => {
    const values = checkValues({ count: 3, services: 'a'.repeat(5_000) }, 'permissions_denied');
    expect(values.count).toBe('3');
    expect(values.services!.length).toBeLessThanOrEqual(MAX_VALUE_LENGTH + 1);
    expect(values.services!.endsWith('…')).toBe(true);
  });
});
