import type { StackFrame } from '@/api/contract';
import { translate } from '@/i18n';
import {
  ERROR_STATUS_FILTERS,
  errorFilterLabelKey,
  errorFiltersFor,
  errorStatusIcon,
  errorStatusLabelKey,
  errorStatusMeaningKey,
  errorStatusNeedsExplaining,
  errorStatusTone,
  formatCount,
  hasStack,
  stackCopyText,
} from '../helpers';

describe('error status labels', () => {
  it('maps every contract status to a word in both languages', () => {
    expect(translate('en', errorStatusLabelKey('regression'))).toBe('Regression');
    expect(translate('en', errorStatusLabelKey('new'))).toBe('New');
    expect(translate('fr', errorStatusLabelKey('resolved'))).toBe('Résolue');
  });

  it('labels the filter chips, with "All" from the common namespace', () => {
    expect(ERROR_STATUS_FILTERS.map((f) => translate('en', errorFilterLabelKey(f)))).toEqual(['All', 'New', 'Regressions', 'Recurring', 'Resolved']);
  });

  it('gives each status a tone and an icon, so status never depends on colour alone', () => {
    expect(errorStatusTone('regression')).toBe('critical');
    expect(errorStatusTone('resolved')).toBe('healthy');
    for (const status of ['new', 'recurring', 'regression', 'resolved'] as const) expect(errorStatusIcon(status)).toBeTruthy();
  });
});

describe('errorFiltersFor', () => {
  it('omits the status for "all" and passes the service through', () => {
    expect(errorFiltersFor('all')).toEqual({});
    expect(errorFiltersFor('regression')).toEqual({ status: 'regression' });
    expect(errorFiltersFor('new', 'svc-checkout-api')).toEqual({ status: 'new', service: 'svc-checkout-api' });
    expect(errorFiltersFor('all', null)).toEqual({});
  });
});

describe('formatCount', () => {
  it('keeps null distinct from zero', () => {
    expect(formatCount(null)).toBeNull();
    expect(formatCount(undefined)).toBeNull();
    expect(formatCount(0)).toBe('0');
    expect(formatCount(2417)).toBe('2,417');
  });
});

describe('status meanings', () => {
  it('tells a regression apart from a new error, in both languages', () => {
    expect(translate('en', errorStatusMeaningKey('regression'))).toBe('Was resolved, and is happening again.');
    expect(translate('en', errorStatusMeaningKey('new'))).toBe('Seen here for the first time.');
    expect(translate('fr', errorStatusMeaningKey('regression'))).toBe('Elle était résolue et se reproduit.');
    for (const status of ['new', 'recurring', 'regression', 'resolved'] as const) {
      expect(translate('fr', errorStatusMeaningKey(status))).not.toBe(errorStatusMeaningKey(status));
    }
  });

  it('spells out only the states that change what happens next', () => {
    expect(errorStatusNeedsExplaining('regression')).toBe(true);
    expect(errorStatusNeedsExplaining('new')).toBe(true);
    expect(errorStatusNeedsExplaining('recurring')).toBe(false);
    expect(errorStatusNeedsExplaining('resolved')).toBe(false);
  });
});

describe('stackCopyText', () => {
  const frame = (over: Partial<StackFrame> = {}): StackFrame => ({ function: 'Consumer.ack', file: 'src/queue/consumer.ts', line: 120, column: 9, inApp: true, ...over });

  it('rebuilds a pasteable trace from the frames when the server sent no raw stack', () => {
    expect(stackCopyText({ message: 'QueueAckError: visibility timeout expired', type: 'QueueAckError', frames: [frame()] })).toBe(
      'QueueAckError: visibility timeout expired\n    at Consumer.ack (src/queue/consumer.ts:120:9)',
    );
  });

  it('keeps the server raw stack exactly as it came, without repeating the error line', () => {
    const rawStack = 'TypeError: boom\n    at priceCart (/app/src/pricing.ts:45:18)';
    expect(stackCopyText({ message: 'TypeError: boom', type: 'TypeError', frames: [], rawStack })).toBe(rawStack);
  });

  it('adds the error line when the raw stack does not start with it', () => {
    expect(stackCopyText({ message: 'boom', type: 'TypeError', frames: [], rawStack: '    at a (b.ts:1:1)' })).toBe('TypeError: boom\n    at a (b.ts:1:1)');
  });

  it('never repeats the type the message already carries, and copes with partial frames', () => {
    expect(stackCopyText({ message: 'TypeError: boom', type: 'TypeError', frames: [] })).toBe('TypeError: boom');
    expect(stackCopyText({ message: 'boom', frames: [frame({ function: undefined, file: undefined, module: 'express' })] })).toBe('boom\n    at <anonymous> (express)');
    expect(stackCopyText({ message: 'boom', frames: [frame({ file: undefined, line: undefined, column: undefined })] })).toBe('boom\n    at Consumer.ack');
  });

  it('knows when there is nothing to copy', () => {
    expect(hasStack({ frames: [], rawStack: undefined })).toBe(false);
    expect(hasStack({ frames: [frame()] })).toBe(true);
    expect(hasStack({ frames: [], rawStack: 'x' })).toBe(true);
  });
});
