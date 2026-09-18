import { translate } from '@/i18n';
import { classifySsl, sortFailuresFirst, sslMessage, sslNeedsAttention, sslTone, statusCounts, syntheticStatusMeta, targetHost } from '../helpers';

const DAY = 24 * 3_600_000;
const now = 100 * DAY;

describe('synthetic helpers', () => {
  it('maps statuses: up healthy, degraded warning, down critical, unknown', () => {
    expect(syntheticStatusMeta('up').tone).toBe('healthy');
    expect(syntheticStatusMeta('degraded').tone).toBe('warning');
    expect(syntheticStatusMeta('down').tone).toBe('critical');
    expect(syntheticStatusMeta('unknown').tone).toBe('unknown');
  });

  it('sorts failures first, then by name', () => {
    const sorted = sortFailuresFirst([
      { name: 'b', status: 'up' as const },
      { name: 'z', status: 'degraded' as const },
      { name: 'a', status: 'up' as const },
      { name: 'y', status: 'down' as const },
      { name: 'x', status: 'unknown' as const },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['y', 'z', 'x', 'a', 'b']);
  });

  it('counts statuses', () => {
    expect(statusCounts([{ status: 'up' }, { status: 'up' }, { status: 'down' }])).toEqual({ up: 2, degraded: 0, down: 1, unknown: 0 });
  });

  it('extracts the target host', () => {
    expect(targetHost('https://api.example.com/v1/cart/price')).toBe('api.example.com');
    expect(targetHost('tcp:db:5432')).toBe('tcp:db:5432');
  });

  it('classifies certificate expiry: warning under 30 days, critical under 7', () => {
    const ssl = (days: number, valid: boolean | null = true) => ({ valid, expiresAt: now + days * DAY });
    expect(classifySsl(ssl(64), now)).toEqual({ level: 'ok', days: 64 });
    expect(classifySsl(ssl(30), now).level).toBe('ok');
    expect(classifySsl(ssl(29), now).level).toBe('warning');
    expect(classifySsl(ssl(12), now)).toEqual({ level: 'warning', days: 12 });
    expect(classifySsl(ssl(6), now).level).toBe('critical');
    expect(classifySsl(ssl(-1), now).level).toBe('expired');
    expect(classifySsl(ssl(64, false), now).level).toBe('invalid');
    expect(classifySsl(null, now)).toEqual({ level: 'unknown', days: null });
    expect(classifySsl({ valid: null, expiresAt: null }, now).level).toBe('unknown');
  });

  it('flags only certificates that need attention', () => {
    expect(sslNeedsAttention({ level: 'ok', days: 64 })).toBe(false);
    expect(sslNeedsAttention({ level: 'unknown', days: null })).toBe(false);
    expect(sslNeedsAttention({ level: 'warning', days: 12 })).toBe(true);
    expect(sslTone('critical')).toBe('critical');
    expect(sslTone('warning')).toBe('warning');
  });

  it('words the expiry', () => {
    const say = (state: Parameters<typeof sslMessage>[0]) => {
      const m = sslMessage(state);
      return translate('en', m.key, m.params);
    };
    expect(say({ level: 'warning', days: 12 })).toBe('Certificate expires in 12 days');
    expect(say({ level: 'critical', days: 1 })).toBe('Certificate expires in 1 day');
    expect(say({ level: 'critical', days: 0 })).toBe('Certificate expires within a day');
    expect(say({ level: 'expired', days: -2 })).toBe('Certificate expired');
  });
});
