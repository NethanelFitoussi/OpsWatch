import { formatAge, formatDuration, formatMetric, formatPercentFraction, formatRelative, logPreview, NO_DATA, prettyLog, setFormatLocale } from '../format';

describe('formatMetric', () => {
  it('never renders null as zero', () => {
    expect(formatMetric(null, 'percent')).toBe(NO_DATA);
    expect(formatMetric(undefined, 'ms')).toBe(NO_DATA);
    expect(formatMetric(Number.NaN, 'count')).toBe(NO_DATA);
  });
  it('formats units', () => {
    expect(formatMetric(6.8, 'percent')).toBe('6.8 %');
    expect(formatMetric(1240, 'ms')).toBe('1.24 s');
    expect(formatMetric(180, 'ms')).toBe('180 ms');
    expect(formatMetric(1850, 'per_minute')).toBe('1,850/min');
    expect(formatMetric(0, 'count')).toBe('0');
  });
});

describe('formatPercentFraction', () => {
  it('keeps two decimals near 100 %', () => {
    expect(formatPercentFraction(0.9962)).toBe('99.62 %');
    expect(formatPercentFraction(1)).toBe('100 %');
    expect(formatPercentFraction(null)).toBe(NO_DATA);
  });
});

describe('formatRelative', () => {
  const now = 1_000_000_000_000;
  it('rounds down so data never looks fresher than it is', () => {
    expect(formatRelative(now - 10_000, now)).toBe('just now');
    expect(formatRelative(now - 119_000, now)).toBe('1 min ago');
    // The gap between "just now" (under 45 s) and a whole minute used to read "0 min ago".
    expect(formatRelative(now - 45_000, now)).toBe('1 min ago');
    expect(formatRelative(now - 59_999, now)).toBe('1 min ago');
    expect(formatRelative(now - 44_999, now)).toBe('just now');
    expect(formatRelative(now + 50_000, now)).toBe('in 1 min');
    expect(formatRelative(now - 3 * 3_600_000 - 59 * 60_000, now)).toBe('3 h ago');
    expect(formatRelative(now + 12 * 86_400_000, now)).toBe('in 12 d');
  });
});

describe('formatDuration', () => {
  it('uses the two largest units', () => {
    expect(formatDuration(90 * 60_000)).toBe('1 h 30 min');
    expect(formatDuration(45_000)).toBe('45 s');
  });
});

describe('log helpers', () => {
  it('pretty-prints JSON lines and previews their message', () => {
    const line = '{"level":"error","msg":"boom","n":1}';
    expect(prettyLog(line).isJson).toBe(true);
    expect(prettyLog(line).pretty).toContain('\n');
    expect(logPreview(line)).toBe('boom');
    expect(prettyLog('plain text').isJson).toBe(false);
  });
});

describe('French formatting', () => {
  afterEach(() => setFormatLocale('en'));
  it('uses French units and number grouping', () => {
    setFormatLocale('fr');
    expect(formatDuration(26 * 3_600_000)).toBe('1 j 2 h');
    expect(formatRelative(0, 3 * 86_400_000)).toBe('3 j ago');
    expect(formatMetric(1850, 'per_minute')).toMatch(/^1\s850\/min$/);
  });
});

describe('formatAge', () => {
  const now = 1_000_000_000_000;

  it('reads the same as formatRelative for anything already past', () => {
    for (const ago of [0, 10_000, 44_999, 45_000, 119_000, 3 * 3_600_000, 5 * 86_400_000]) {
      expect(formatAge(now - ago, now)).toBe(formatRelative(now - ago, now));
    }
  });

  /**
   * A phone whose clock is a minute slow makes every server timestamp look like the future. "Checked in 1 min" is not
   * a thing that can happen, and it appears on the one line whose job is to say how current the data is.
   */
  /**
   * The clamp is for timestamps that describe something already done. A schedule is not one of those: clamping it
   * rendered "next run just now" for a job due in three minutes, which a store screenshot caught.
   */
  it('leaves formatRelative free to describe something that has not happened yet', () => {
    expect(formatRelative(now + 3 * 60_000, now)).toBe('in 3 min');
    expect(formatAge(now + 3 * 60_000, now)).toBe('just now');
  });

  it('never renders the future, however far ahead the timestamp is', () => {
    expect(formatAge(now + 1, now)).toBe('just now');
    expect(formatAge(now + 60_000, now)).toBe('just now');
    expect(formatAge(now + 12 * 86_400_000, now)).toBe('just now');
    expect(formatRelative(now + 12 * 86_400_000, now)).toBe('in 12 d');
  });
});
