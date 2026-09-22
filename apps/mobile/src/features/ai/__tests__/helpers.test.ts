import { canAsk, clampQuestion, MAX_QUESTION_LENGTH, parseAskContext, parseInitialQuestion, SUGGESTED_QUESTIONS } from '../helpers';

describe('parseAskContext', () => {
  it('accepts a known type with a safe id', () => {
    expect(parseAskContext({ contextType: 'problem', contextId: 'prb-checkout-5xx' })).toEqual({ type: 'problem', id: 'prb-checkout-5xx' });
    expect(parseAskContext({ contextType: ['error'], contextId: ['err-1'] })).toEqual({ type: 'error', id: 'err-1' });
  });

  it('rejects unknown types, unsafe ids and partial contexts', () => {
    expect(parseAskContext({ contextType: 'user', contextId: 'x' })).toBeNull();
    expect(parseAskContext({ contextType: 'problem', contextId: '../../etc' })).toBeNull();
    expect(parseAskContext({ contextType: 'problem', contextId: 'a b' })).toBeNull();
    expect(parseAskContext({ contextType: 'problem' })).toBeNull();
    expect(parseAskContext({ contextId: 'prb-1' })).toBeNull();
    expect(parseAskContext({})).toBeNull();
  });
});

describe('questions', () => {
  it('prefills from a string parameter, capped at the limit', () => {
    expect(parseInitialQuestion('  Why?')).toBe('Why?');
    expect(parseInitialQuestion(undefined)).toBe('');
    expect(parseInitialQuestion(42)).toBe('');
    expect(parseInitialQuestion('x'.repeat(900))).toHaveLength(MAX_QUESTION_LENGTH);
  });

  it('clamps and validates', () => {
    expect(clampQuestion('abc')).toBe('abc');
    expect(clampQuestion('y'.repeat(MAX_QUESTION_LENGTH + 1))).toHaveLength(MAX_QUESTION_LENGTH);
    expect(canAsk('  ', false)).toBe(false);
    expect(canAsk('Why?', true)).toBe(false);
    expect(canAsk('Why?', false)).toBe(true);
  });

  it('offers the seven suggested questions', () => {
    expect(SUGGESTED_QUESTIONS).toHaveLength(7);
  });
});
