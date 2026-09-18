import { describe, expect, it } from 'vitest';
import { bandSentence, bandsFor, cpuBand, toneForValue, volumeBand } from '@/lib/monitoring/shared/bands';
import en from '../../messages/en.json';

const cpu = { warning: 85, critical: 95, direction: 'above' } as const;
const memory = { warning: 5, direction: 'below' } as const;

/** The real catalogue behind the minimal `t` the component passes in, so a renamed key fails the test. */
const t = (key: string, values: Record<string, string>): string => {
  const message = `Monitoring.client.${key}`.split('.').reduce<unknown>((node, step) => (node as Record<string, unknown>)?.[step], en);
  if (typeof message !== 'string') throw new Error(`missing message Monitoring.client.${key}`);
  return message.replaceAll(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
};

describe('bandsFor', () => {
  it('builds healthy, warning and critical bands for an upward threshold', () => {
    expect(bandsFor(cpu, 100)).toEqual([
      { from: 0, to: 85, tone: 'success' },
      { from: 85, to: 95, tone: 'warning' },
      { from: 95, to: 100, tone: 'danger' },
    ]);
  });
  it('leaves the top band open when there is no maximum', () => {
    expect(bandsFor({ warning: 1, direction: 'above' }, null)).toEqual([
      { from: 0, to: 1, tone: 'success' },
      { from: 1, to: null, tone: 'warning' },
    ]);
  });
  it('inverts the bands for a downward threshold', () => {
    expect(bandsFor(memory, 100)).toEqual([
      { from: 0, to: 5, tone: 'warning' },
      { from: 5, to: 100, tone: 'success' },
    ]);
  });
});

describe('toneForValue', () => {
  it('is exclusive at the threshold, matching breachActive', () => {
    expect(toneForValue(84.9, cpu)).toBe('success');
    expect(toneForValue(85, cpu)).toBe('success');
    expect(toneForValue(85.1, cpu)).toBe('warning');
    expect(toneForValue(96, cpu)).toBe('danger');
    expect(toneForValue(4, memory)).toBe('warning');
    expect(toneForValue(6, memory)).toBe('success');
    expect(toneForValue(null, cpu)).toBeNull();
  });
});

describe('bandSentence', () => {
  it('words a rising set with a critical band', () => {
    expect(bandSentence(bandsFor(cpu, 100), 'percent', 'en', t)).toBe('Bands: healthy up to 85%, warning up to 95%, critical above.');
  });
  it('words a rising set without a critical band, whose last band is open-ended', () => {
    expect(bandSentence(bandsFor({ warning: 1, direction: 'above' }, null), 'count', 'en', t)).toBe('Bands: healthy up to 1, warning above.');
  });
  it('words a falling set, where healthy is the top band', () => {
    expect(bandSentence(bandsFor(memory, 100), 'percent', 'en', t)).toBe('Bands: warning below 5%, healthy above.');
    // Open-ended above, as a free-memory chart with no known maximum is.
    expect(bandSentence(bandsFor({ warning: 5 * 1024 ** 3, direction: 'below' }, null), 'bytes', 'en', t)).toBe(
      'Bands: warning below 5 GB, healthy above.',
    );
  });
  it('says nothing when no band is healthy, rather than a sentence that reads backwards', () => {
    expect(bandSentence([], 'percent', 'en', t)).toBeNull();
    expect(bandSentence([{ from: 0, to: 50, tone: 'warning' }], 'percent', 'en', t)).toBeNull();
    // Healthy from zero and open-ended: the whole axis is healthy, so there is no threshold to name.
    expect(bandSentence([{ from: 0, to: null, tone: 'success' }], 'percent', 'en', t)).toBeNull();
  });
});

describe('cpuBand and volumeBand', () => {
  it('bands CPU on 10, 50 and 85 per cent', () => {
    expect([null, 0, 9.9, 10, 49, 60, 90].map(cpuBand)).toEqual(['unknown', 'idle', 'idle', 'low', 'low', 'medium', 'high']);
  });
  it('bands volume on 1 MiB, 1 GiB and 10 GiB', () => {
    expect([null, 0, 1_048_575, 1_048_576, 1_073_741_823, 1_073_741_824, 10_737_418_240].map(volumeBand))
      .toEqual(['unknown', 'tiny', 'tiny', 'small', 'small', 'large', 'huge']);
  });
});
