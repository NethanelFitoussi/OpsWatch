import { translate } from '@/i18n';
import { budgetText, burnRateExplanation, formatBurnRate, isBudgetExhausted, percentOrNull, sloStatusMeta } from '../helpers';

const say = (m: { key: Parameters<typeof translate>[1]; params?: Record<string, string> }) => translate('en', m.key, m.params);

describe('SLO helpers', () => {
  it('maps statuses', () => {
    expect(sloStatusMeta('healthy').tone).toBe('healthy');
    expect(sloStatusMeta('at_risk')).toMatchObject({ tone: 'warning', label: 'slos.status.at_risk' });
    expect(sloStatusMeta('breached').tone).toBe('critical');
    expect(sloStatusMeta('unknown').tone).toBe('unknown');
  });

  it('formats percentages and keeps null as null', () => {
    expect(percentOrNull(0.999)).toBe('99.9 %');
    expect(percentOrNull(0.9962)).toBe('99.62 %');
    expect(percentOrNull(null)).toBeNull();
  });

  it('words the budget, negative meaning exhausted', () => {
    expect(isBudgetExhausted(-2.8)).toBe(true);
    expect(isBudgetExhausted(0)).toBe(true);
    expect(isBudgetExhausted(0.12)).toBe(false);
    expect(isBudgetExhausted(null)).toBe(false);
    expect(say(budgetText(-2.8))).toBe('Budget exhausted');
    expect(say(budgetText(0.64))).toBe('64 % of the error budget left');
    expect(say(budgetText(null))).toBe('No data');
  });

  it('formats and explains the burn rate', () => {
    expect(formatBurnRate(14.2)).toBe('×14.2');
    expect(formatBurnRate(null)).toBeNull();
    expect(say(burnRateExplanation(14))).toBe('×14 means the budget would last 1/14 of the window.');
    expect(say(burnRateExplanation(0.4))).toContain('lasts the whole window');
    expect(say(burnRateExplanation(null))).toContain('not enough data');
  });
});
