import { translate } from '@/i18n';
import { ERROR_STATUS_FILTERS, errorFilterLabelKey, errorFiltersFor, errorStatusIcon, errorStatusLabelKey, errorStatusTone, formatCount } from '../helpers';

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
