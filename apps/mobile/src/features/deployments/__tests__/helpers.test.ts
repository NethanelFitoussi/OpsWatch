import { translate } from '@/i18n';
import { commitLine, DEPLOYMENT_STATUS_META, timingSentence } from '../helpers';

describe('timingSentence', () => {
  it('states a delay after the deployment as a timing fact', () => {
    const s = timingSentence(3);
    expect(translate('en', s.key, s.params)).toBe('Started 3 min after this deployment');
    const long = timingSentence(95);
    expect(translate('en', long.key, long.params)).toBe('Started 1 h 35 min after this deployment');
  });

  it('states a negative delay as "before"', () => {
    const s = timingSentence(-4);
    expect(translate('en', s.key, s.params)).toBe('Started 4 min before this deployment');
  });

  it('never claims causation, in any language', () => {
    for (const locale of ['en', 'fr'] as const) {
      for (const minutes of [0, 3, 90, -2]) {
        const s = timingSentence(minutes);
        expect(translate(locale, s.key, s.params)).not.toMatch(/caus/i);
      }
      expect(translate(locale, 'deployments.correlationNote')).not.toMatch(/caused/i);
    }
  });
});

describe('commitLine', () => {
  it('shows the short sha and the first line of the message', () => {
    expect(commitLine({ sha: '8f3c2a91d4e5b6c7', message: 'Batch lookups\n\nLonger body' })).toBe('8f3c2a9 · Batch lookups');
    expect(commitLine({ sha: '8f3c2a91d4e5b6c7' })).toBe('8f3c2a9');
    expect(commitLine(undefined)).toBeUndefined();
  });
});

describe('DEPLOYMENT_STATUS_META', () => {
  it('uses warning and critical tones for rolled back and failed', () => {
    expect(DEPLOYMENT_STATUS_META.rolled_back.tone).toBe('warning');
    expect(DEPLOYMENT_STATUS_META.failed.tone).toBe('critical');
    expect(DEPLOYMENT_STATUS_META.completed.tone).toBe('healthy');
  });
});
